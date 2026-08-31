import { SyncIntegrityError } from '../errors';
import type { SyncMutationEnvelope } from '../types';

import type { VersionStamp } from './types';

const HLC_PATTERN = /^(\d{13,})-([0-9a-f]{8})-(.+)$/;

export type ParsedHlc = Readonly<{
  wallTime: number;
  counter: number;
  deviceId: string;
}>;

export function parseAndValidateHlc(hlc: string): ParsedHlc {
  const match = HLC_PATTERN.exec(hlc);
  if (!match)
    throw new SyncIntegrityError(`Invalid hybrid logical clock: ${hlc}.`);
  const wallTime = Number(match[1]);
  const counter = Number.parseInt(match[2], 16);
  if (!Number.isSafeInteger(wallTime) || !Number.isSafeInteger(counter)) {
    throw new SyncIntegrityError(`Invalid hybrid logical clock: ${hlc}.`);
  }
  return { wallTime, counter, deviceId: match[3] };
}

export function versionFromMutation(
  mutation: SyncMutationEnvelope,
): VersionStamp {
  const parsed = parseAndValidateHlc(mutation.hlc);
  if (parsed.deviceId !== mutation.deviceId) {
    throw new SyncIntegrityError(
      `Mutation ${mutation.mutationId} has an HLC from another device.`,
    );
  }
  return {
    hlc: mutation.hlc,
    deviceId: mutation.deviceId,
    operation: mutation.operation,
  };
}

/**
 * LWW order by physical and logical HLC parts. On a concurrent HLC tie, a
 * delete wins before the device-id tie-breaker. A later upsert can restore.
 */
export function compareVersions(
  left: VersionStamp,
  right: VersionStamp,
): number {
  const leftClock = parseAndValidateHlc(left.hlc);
  const rightClock = parseAndValidateHlc(right.hlc);
  if (leftClock.wallTime !== rightClock.wallTime) {
    return leftClock.wallTime - rightClock.wallTime;
  }
  if (leftClock.counter !== rightClock.counter) {
    return leftClock.counter - rightClock.counter;
  }
  if (left.operation !== right.operation)
    return left.operation === 'delete' ? 1 : -1;
  const byDevice = left.deviceId.localeCompare(right.deviceId);
  if (byDevice !== 0) return byDevice;
  return left.hlc.localeCompare(right.hlc);
}

export function newestVersion(
  versions: readonly (VersionStamp | null | undefined)[],
): VersionStamp | null {
  let newest: VersionStamp | null = null;
  for (const version of versions) {
    if (version && (!newest || compareVersions(version, newest) > 0))
      newest = version;
  }
  return newest;
}
