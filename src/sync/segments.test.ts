import { describe, expect, it } from 'vitest';

import { SyncIntegrityError } from './errors';
import {
  buildSyncSegments,
  partitionMutations,
  segmentPayloadBytes,
  utf8ByteLength,
  verifySyncSegment,
} from './segments';
import type { SyncMutationEnvelope } from './types';

async function deterministicTestHash(value: string): Promise<string> {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

function mutation(
  seq: number,
  deviceId = 'device-a',
  payload: SyncMutationEnvelope['payload'] = { title: `Habit ${seq}` },
): SyncMutationEnvelope {
  return {
    schemaVersion: 1,
    mutationId: `${deviceId}-mutation-${seq}`,
    deviceId,
    seq,
    hlc: `000000000000${seq}-00000000-${deviceId}`,
    entityType: 'item',
    entityId: `item-${seq}`,
    operation: 'upsert',
    payload,
  };
}

describe('sync segment partitioning', () => {
  it('partitions contiguous mutations by operation count without reordering them', () => {
    const partitions = partitionMutations(
      [mutation(1), mutation(2), mutation(3), mutation(4), mutation(5)],
      { maxOperations: 2 },
    );

    expect(
      partitions.map((partition) => partition.map((entry) => entry.seq)),
    ).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('uses canonical UTF-8 payload bytes for the size limit', () => {
    const first = mutation(1, 'device-a', { note: 'órbita 🚀'.repeat(20) });
    const second = mutation(2, 'device-a', { note: 'órbita 🚀'.repeat(20) });
    const oneMutationBytes = segmentPayloadBytes([first]);

    const partitions = partitionMutations([first, second], {
      maxPayloadBytes: oneMutationBytes + 8,
    });

    expect(partitions).toHaveLength(2);
    expect(utf8ByteLength('🚀')).toBe(4);
  });

  it('rejects sequence gaps and mutations that cannot fit alone', () => {
    expect(() => partitionMutations([mutation(1), mutation(3)])).toThrow(
      SyncIntegrityError,
    );
    expect(() =>
      partitionMutations(
        [mutation(1, 'device-a', { note: 'x'.repeat(1_000) })],
        {
          maxPayloadBytes: 256,
        },
      ),
    ).toThrow(/exceeds/);
  });
});

describe('sync segment hashes', () => {
  it('builds deterministic sequence IDs and a forward hash chain', async () => {
    const segments = await buildSyncSegments(
      [mutation(1), mutation(2), mutation(3), mutation(4)],
      { limits: { maxOperations: 2 }, hashText: deterministicTestHash },
    );

    expect(segments.map((segment) => segment.segmentId)).toEqual([
      '0000000000000001',
      '0000000000000003',
    ]);
    expect(segments[0].previousSegmentHash).toBeNull();
    expect(segments[1].previousSegmentHash).toBe(segments[0].contentHash);
    await Promise.all(
      segments.map((segment) =>
        verifySyncSegment(segment, deterministicTestHash),
      ),
    );
  });

  it('detects a changed immutable payload', async () => {
    const [segment] = await buildSyncSegments([mutation(1)], {
      hashText: deterministicTestHash,
    });
    const changed = {
      ...segment,
      operations: [{ ...segment.operations[0], payload: { title: 'Changed' } }],
    };

    await expect(
      verifySyncSegment(changed, deterministicTestHash),
    ).rejects.toThrow(/hash mismatch/i);
  });
});
