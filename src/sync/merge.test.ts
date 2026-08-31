import { describe, expect, it } from 'vitest';

import { SyncConflictError, SyncGapError } from './errors';
import { mergePullEnvelope } from './merge';
import { buildSyncSegments } from './segments';
import type { SyncMutationEnvelope } from './types';

async function deterministicTestHash(value: string): Promise<string> {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (Math.imul(total, 31) + value.charCodeAt(index)) >>> 0;
  }
  return total.toString(16).padStart(8, '0').repeat(8);
}

function mutation(deviceId: string, seq: number): SyncMutationEnvelope {
  return {
    schemaVersion: 1,
    mutationId: `${deviceId}-${seq}`,
    deviceId,
    seq,
    hlc: `000000000000${seq}-00000000-${deviceId}`,
    entityType: 'item',
    entityId: `${deviceId}-item-${seq}`,
    operation: 'upsert',
    payload: { seq },
  };
}

describe('mergePullEnvelope', () => {
  it('deduplicates segments and advances a vector independently per device', async () => {
    const deviceA = await buildSyncSegments(
      [
        mutation('device-a', 1),
        mutation('device-a', 2),
        mutation('device-a', 3),
      ],
      { limits: { maxOperations: 2 }, hashText: deterministicTestHash },
    );
    const deviceB = await buildSyncSegments([mutation('device-b', 1)], {
      hashText: deterministicTestHash,
    });

    const result = mergePullEnvelope(
      { lastSeqByDevice: { 'device-a': 2 } },
      [deviceB[0], deviceA[1], deviceA[0], deviceA[1]],
      { 'device-a': true, 'device-b': false },
    );

    expect(
      result.segments.map(
        (segment) => `${segment.deviceId}:${segment.segmentId}`,
      ),
    ).toEqual([
      `device-a:${deviceA[1].segmentId}`,
      `device-b:${deviceB[0].segmentId}`,
    ]);
    expect(result.cursor.lastSeqByDevice).toEqual({
      'device-a': 3,
      'device-b': 1,
    });
    expect(result.hasMoreByDevice).toEqual({ 'device-a': true });
  });

  it('retains an overlapping segment for idempotent local replay', async () => {
    const [segment] = await buildSyncSegments(
      [mutation('device-a', 1), mutation('device-a', 2)],
      { hashText: deterministicTestHash },
    );
    const result = mergePullEnvelope({ lastSeqByDevice: { 'device-a': 1 } }, [
      segment,
    ]);

    expect(result.segments).toEqual([segment]);
    expect(result.cursor.lastSeqByDevice['device-a']).toBe(2);
  });

  it('rejects gaps instead of advancing beyond missing history', async () => {
    const [segment] = await buildSyncSegments([mutation('device-a', 3)], {
      hashText: deterministicTestHash,
    });

    expect(() => mergePullEnvelope({ lastSeqByDevice: {} }, [segment])).toThrow(
      SyncGapError,
    );
  });

  it('rejects conflicting copies of the same immutable range', async () => {
    const [segment] = await buildSyncSegments([mutation('device-a', 1)], {
      hashText: deterministicTestHash,
    });
    const conflicting = { ...segment, contentHash: 'f'.repeat(64) };

    expect(() =>
      mergePullEnvelope({ lastSeqByDevice: {} }, [segment, conflicting]),
    ).toThrow(SyncConflictError);
  });

  it('rejects a broken hash chain between contiguous segments', async () => {
    const segments = await buildSyncSegments(
      [mutation('device-a', 1), mutation('device-a', 2)],
      { limits: { maxOperations: 1 }, hashText: deterministicTestHash },
    );
    const broken = { ...segments[1], previousSegmentHash: 'a'.repeat(64) };

    expect(() =>
      mergePullEnvelope({ lastSeqByDevice: {} }, [segments[0], broken]),
    ).toThrow(/hash chain/i);
  });
});
