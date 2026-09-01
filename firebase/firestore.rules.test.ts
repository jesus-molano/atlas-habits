/// <reference types="node" />

import { readFileSync } from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const projectId = 'demo-atlas-habits';
const ownerUid = 'owner-user';
const deviceId = 'device-a';

function googleClaims() {
  return { firebase: { sign_in_provider: 'google.com' as const } };
}

function devicePayload(uid = ownerUid) {
  return { schemaVersion: 1, ownerUid: uid, deviceId };
}

function segmentPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    ownerUid,
    segmentId: '0000000000000001-0000000000000001',
    deviceId,
    firstSeq: 1,
    lastSeq: 1,
    operationCount: 1,
    previousSegmentHash: null,
    contentHash: 'a'.repeat(64),
    payloadJson: '[]',
    ...overrides,
  };
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore owner-isolated sync rules',
  () => {
    let environment: RulesTestEnvironment;

    beforeAll(async () => {
      environment = await initializeTestEnvironment({
        projectId,
        firestore: {
          host: '127.0.0.1',
          port: 8080,
          rules: readFileSync('firebase/firestore.rules', 'utf8'),
        },
      });
    });

    afterEach(async () => environment.clearFirestore());
    afterAll(async () => environment.cleanup());

    it('allows a Google owner to create and read its immutable device', async () => {
      const firestore = environment
        .authenticatedContext(ownerUid, googleClaims())
        .firestore();
      const reference = doc(firestore, `users/${ownerUid}/devices/${deviceId}`);

      await assertSucceeds(setDoc(reference, devicePayload()));
      await assertSucceeds(getDoc(reference));
      await assertFails(updateDoc(reference, { schemaVersion: 1 }));
      await assertFails(deleteDoc(reference));
    });

    it('denies non-Google, cross-UID and extra-field device access', async () => {
      const nonGoogle = environment
        .authenticatedContext(ownerUid, {
          firebase: { sign_in_provider: 'password' as const },
        })
        .firestore();
      await assertFails(
        setDoc(
          doc(nonGoogle, `users/${ownerUid}/devices/${deviceId}`),
          devicePayload(),
        ),
      );

      const other = environment
        .authenticatedContext('other-user', googleClaims())
        .firestore();
      await assertFails(
        getDoc(doc(other, `users/${ownerUid}/devices/${deviceId}`)),
      );

      const owner = environment
        .authenticatedContext(ownerUid, googleClaims())
        .firestore();
      await assertFails(
        setDoc(doc(owner, `users/${ownerUid}/devices/${deviceId}`), {
          ...devicePayload(),
          unexpected: true,
        }),
      );
    });

    it('allows a valid owner segment only below an existing device', async () => {
      const firestore = environment
        .authenticatedContext(ownerUid, googleClaims())
        .firestore();
      const device = doc(firestore, `users/${ownerUid}/devices/${deviceId}`);
      const segment = doc(
        firestore,
        `users/${ownerUid}/devices/${deviceId}/segments/0000000000000001-0000000000000001`,
      );

      await assertFails(setDoc(segment, segmentPayload()));
      await assertSucceeds(setDoc(device, devicePayload()));
      await assertSucceeds(setDoc(segment, segmentPayload()));
      await assertSucceeds(getDoc(segment));
      await assertFails(updateDoc(segment, { operationCount: 2 }));
      await assertFails(deleteDoc(segment));
    });

    it('denies malformed ownership and unknown segment fields', async () => {
      const firestore = environment
        .authenticatedContext(ownerUid, googleClaims())
        .firestore();
      await assertSucceeds(
        setDoc(
          doc(firestore, `users/${ownerUid}/devices/${deviceId}`),
          devicePayload(),
        ),
      );
      const segment = doc(
        firestore,
        `users/${ownerUid}/devices/${deviceId}/segments/0000000000000001-0000000000000001`,
      );

      await assertFails(setDoc(segment, segmentPayload({ ownerUid: 'other' })));
      await assertFails(setDoc(segment, segmentPayload({ unexpected: true })));
      await assertFails(
        setDoc(segment, segmentPayload({ contentHash: 'not-a-sha256' })),
      );
    });
  },
);
