import { stableStringify } from '../../data/canonical-json';
import {
  SyncAuthenticationError,
  SyncConflictError,
  SyncIntegrityError,
} from '../errors';
import { mergePullEnvelope } from '../merge';
import { assertSegmentChain, verifySyncSegment } from '../segments';
import type {
  SyncCursor,
  SyncMutationEnvelope,
  SyncPullResult,
  SyncSegmentEnvelope,
  SyncTransport,
  SyncUploadResult,
} from '../types';
import {
  assertDeviceId,
  assertSegmentEnvelopeShape,
  normalizeCursor,
} from '../validation';

import type { GetFirebaseRuntime } from './runtime';

type StoredDevice = Readonly<{
  schemaVersion: 1;
  ownerUid: string;
  deviceId: string;
}>;

type StoredSegment = Readonly<{
  schemaVersion: 1;
  ownerUid: string;
  segmentId: string;
  deviceId: string;
  firstSeq: number;
  lastSeq: number;
  operationCount: number;
  previousSegmentHash: string | null;
  contentHash: string;
  payloadJson: string;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStoredSegment(
  ownerUid: string,
  segment: SyncSegmentEnvelope,
): StoredSegment {
  return {
    schemaVersion: 1,
    ownerUid,
    segmentId: segment.segmentId,
    deviceId: segment.deviceId,
    firstSeq: segment.firstSeq,
    lastSeq: segment.lastSeq,
    operationCount: segment.operationCount,
    previousSegmentHash: segment.previousSegmentHash,
    contentHash: segment.contentHash,
    payloadJson: stableStringify(segment.operations),
  };
}

function storedSegmentsMatch(
  left: StoredSegment,
  right: Record<string, unknown>,
): boolean {
  const keys = Object.keys(left) as (keyof StoredSegment)[];
  return (
    Object.keys(right).length === keys.length &&
    keys.every((key) => left[key] === right[key])
  );
}

function fromStoredSegment(
  value: unknown,
  expectedOwnerUid: string,
): SyncSegmentEnvelope {
  if (!isObject(value))
    throw new SyncIntegrityError('Remote segment is not an object.');
  if (value.ownerUid !== expectedOwnerUid) {
    throw new SyncIntegrityError(
      'Remote segment owner does not match the authenticated user.',
    );
  }
  if (typeof value.payloadJson !== 'string') {
    throw new SyncIntegrityError(
      'Remote segment payload is not a JSON string.',
    );
  }

  let operations: unknown;
  try {
    operations = JSON.parse(value.payloadJson);
  } catch (error) {
    throw new SyncIntegrityError(
      `Remote segment payload is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}.`,
    );
  }
  if (!Array.isArray(operations))
    throw new SyncIntegrityError('Remote segment payload must be an array.');
  if (stableStringify(operations) !== value.payloadJson) {
    throw new SyncIntegrityError(
      'Remote segment payload is not canonical JSON.',
    );
  }

  const segment = {
    schemaVersion: value.schemaVersion,
    segmentId: value.segmentId,
    deviceId: value.deviceId,
    firstSeq: value.firstSeq,
    lastSeq: value.lastSeq,
    operationCount: value.operationCount,
    previousSegmentHash: value.previousSegmentHash,
    contentHash: value.contentHash,
    operations: operations as SyncMutationEnvelope[],
  };
  assertSegmentEnvelopeShape(segment);
  return segment;
}

function assertStoredDevice(
  value: unknown,
  ownerUid: string,
  documentId: string,
): void {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.ownerUid !== ownerUid ||
    value.deviceId !== documentId
  ) {
    throw new SyncIntegrityError(
      `Invalid remote device registry entry ${documentId}.`,
    );
  }
  assertDeviceId(documentId, 'remote deviceId');
}

export class FirestoreSyncTransport implements SyncTransport {
  readonly providerId = 'firebase-firestore';

  constructor(
    private readonly getRuntime: GetFirebaseRuntime,
    private readonly expectedOwnerUid?: string,
  ) {}

  private async getOwnerUid(): Promise<string> {
    const { auth } = await this.getRuntime();
    await auth.authStateReady();
    const uid = auth.currentUser?.uid;
    if (!uid)
      throw new SyncAuthenticationError('Sign in before using remote sync.');
    if (this.expectedOwnerUid && uid !== this.expectedOwnerUid) {
      throw new SyncAuthenticationError(
        'The signed-in Firebase user is not the configured owner.',
      );
    }
    return uid;
  }

  private async ensureDevice(
    ownerUid: string,
    deviceId: string,
  ): Promise<void> {
    assertDeviceId(deviceId);
    const runtime = await this.getRuntime();
    const reference = runtime.firestoreApi.doc(
      runtime.firestore,
      'users',
      ownerUid,
      'devices',
      deviceId,
    );
    const expected: StoredDevice = { schemaVersion: 1, ownerUid, deviceId };

    await runtime.firestoreApi.runTransaction(
      runtime.firestore,
      async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists()) {
          const value = snapshot.data();
          if (
            !isObject(value) ||
            value.schemaVersion !== expected.schemaVersion ||
            value.ownerUid !== ownerUid ||
            value.deviceId !== deviceId
          ) {
            throw new SyncConflictError(
              `Device registry conflict for ${deviceId}.`,
            );
          }
          return;
        }
        transaction.set(reference, expected);
      },
    );
  }

  private async createSegment(
    ownerUid: string,
    segment: SyncSegmentEnvelope,
  ): Promise<'created' | 'already-present'> {
    const runtime = await this.getRuntime();
    const reference = runtime.firestoreApi.doc(
      runtime.firestore,
      'users',
      ownerUid,
      'devices',
      segment.deviceId,
      'segments',
      segment.segmentId,
    );
    const stored = toStoredSegment(ownerUid, segment);

    return runtime.firestoreApi.runTransaction(
      runtime.firestore,
      async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists()) {
          if (!storedSegmentsMatch(stored, snapshot.data())) {
            throw new SyncConflictError(
              `Immutable remote segment ${segment.deviceId}/${segment.segmentId} has different content.`,
            );
          }
          return 'already-present' as const;
        }
        transaction.set(reference, stored);
        return 'created' as const;
      },
    );
  }

  async uploadSegments(
    segments: readonly SyncSegmentEnvelope[],
  ): Promise<SyncUploadResult> {
    if (segments.length === 0) return { created: 0, alreadyPresent: 0 };
    assertSegmentChain(segments);
    await Promise.all(segments.map((segment) => verifySyncSegment(segment)));
    const ownerUid = await this.getOwnerUid();
    const deviceIds = [...new Set(segments.map((segment) => segment.deviceId))];
    await Promise.all(
      deviceIds.map((deviceId) => this.ensureDevice(ownerUid, deviceId)),
    );

    let created = 0;
    let alreadyPresent = 0;
    const ordered = [...segments].sort(
      (left, right) =>
        left.deviceId.localeCompare(right.deviceId) ||
        left.firstSeq - right.firstSeq,
    );
    for (const segment of ordered) {
      const result = await this.createSegment(ownerUid, segment);
      if (result === 'created') created += 1;
      else alreadyPresent += 1;
    }
    return { created, alreadyPresent };
  }

  async pull(
    cursor: SyncCursor,
    options: Readonly<{ maxSegmentsPerDevice?: number }> = {},
  ): Promise<SyncPullResult> {
    const vector = normalizeCursor(cursor);
    const maximum = options.maxSegmentsPerDevice ?? 100;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 500) {
      throw new SyncIntegrityError(
        'maxSegmentsPerDevice must be an integer from 1 through 500.',
      );
    }

    const ownerUid = await this.getOwnerUid();
    const runtime = await this.getRuntime();
    const devicesReference = runtime.firestoreApi.collection(
      runtime.firestore,
      'users',
      ownerUid,
      'devices',
    );
    const devicesSnapshot =
      await runtime.firestoreApi.getDocs(devicesReference);
    const deviceIds = devicesSnapshot.docs.map((deviceSnapshot) => {
      assertStoredDevice(deviceSnapshot.data(), ownerUid, deviceSnapshot.id);
      return deviceSnapshot.id;
    });

    const incoming: SyncSegmentEnvelope[] = [];
    const hasMoreByDevice: Record<string, boolean> = {};
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        const segmentsReference = runtime.firestoreApi.collection(
          runtime.firestore,
          'users',
          ownerUid,
          'devices',
          deviceId,
          'segments',
        );
        const request = runtime.firestoreApi.query(
          segmentsReference,
          runtime.firestoreApi.where('lastSeq', '>', vector[deviceId] ?? 0),
          runtime.firestoreApi.orderBy('lastSeq', 'asc'),
          runtime.firestoreApi.limit(maximum + 1),
        );
        const snapshot = await runtime.firestoreApi.getDocs(request);
        hasMoreByDevice[deviceId] = snapshot.docs.length > maximum;

        const fetched = snapshot.docs
          .slice(0, maximum)
          .map((documentSnapshot) => {
            const segment = fromStoredSegment(
              documentSnapshot.data(),
              ownerUid,
            );
            if (
              segment.deviceId !== deviceId ||
              segment.segmentId !== documentSnapshot.id
            ) {
              throw new SyncIntegrityError(
                'Remote segment path does not match its envelope.',
              );
            }
            return segment;
          });
        await Promise.all(fetched.map((segment) => verifySyncSegment(segment)));
        incoming.push(...fetched);
      }),
    );

    return mergePullEnvelope(cursor, incoming, hasMoreByDevice);
  }
}
