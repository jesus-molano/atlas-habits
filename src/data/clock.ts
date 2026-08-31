import type { SQLiteDatabase } from 'expo-sqlite';

import type { SqlExecutor } from './transaction';

const HLC_PATTERN = /^(\d{13,})-([0-9a-f]{8})-(.+)$/;

export type LogicalClock = {
  wallTime: number;
  counter: number;
  deviceId: string;
};

export function formatHlc(clock: LogicalClock): string {
  if (!Number.isSafeInteger(clock.wallTime) || clock.wallTime < 0) {
    throw new Error('The HLC wall time must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(clock.counter) ||
    clock.counter < 0 ||
    clock.counter > 0xffffffff
  ) {
    throw new Error('The HLC counter is outside its supported range.');
  }
  if (!clock.deviceId) throw new Error('The HLC device ID is required.');

  return `${clock.wallTime.toString().padStart(13, '0')}-${clock.counter
    .toString(16)
    .padStart(8, '0')}-${clock.deviceId}`;
}

export function parseHlc(value: string): LogicalClock {
  const match = HLC_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid hybrid logical clock: ${value}`);

  const wallTime = Number(match[1]);
  const counter = Number.parseInt(match[2], 16);
  if (!Number.isSafeInteger(wallTime) || !Number.isSafeInteger(counter)) {
    throw new Error(`Invalid hybrid logical clock: ${value}`);
  }

  return { wallTime, counter, deviceId: match[3] };
}

export function tickLogicalClock(
  local: Pick<LogicalClock, 'wallTime' | 'counter'> | null,
  wallNow: number,
  observed: Pick<LogicalClock, 'wallTime' | 'counter'> | null = null,
): Pick<LogicalClock, 'wallTime' | 'counter'> {
  const localWall = local?.wallTime ?? 0;
  const observedWall = observed?.wallTime ?? 0;
  const wallTime = Math.max(wallNow, localWall, observedWall);

  if (wallTime === localWall && wallTime === observedWall) {
    return {
      wallTime,
      counter: Math.max(local?.counter ?? 0, observed?.counter ?? 0) + 1,
    };
  }
  if (wallTime === localWall) {
    return { wallTime, counter: (local?.counter ?? 0) + 1 };
  }
  if (wallTime === observedWall) {
    return { wallTime, counter: (observed?.counter ?? 0) + 1 };
  }
  return { wallTime, counter: 0 };
}

type DeviceClockRow = { wall_time: number; counter: number };

export async function nextHlc(
  executor: SqlExecutor | SQLiteDatabase,
  deviceId: string,
  wallNow = Date.now(),
  observedHlc?: string | null,
): Promise<string> {
  const stored = await executor.getFirstAsync<DeviceClockRow>(
    'SELECT wall_time, counter FROM device_clocks WHERE device_id = ?',
    [deviceId],
  );
  const observed = observedHlc ? parseHlc(observedHlc) : null;
  const next = tickLogicalClock(
    stored ? { wallTime: stored.wall_time, counter: stored.counter } : null,
    wallNow,
    observed,
  );

  await executor.runAsync(
    `INSERT INTO device_clocks (device_id, wall_time, counter, sequence, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       wall_time = excluded.wall_time,
       counter = excluded.counter,
       updated_at = excluded.updated_at`,
    [deviceId, next.wallTime, next.counter, wallNow],
  );

  return formatHlc({ ...next, deviceId });
}

export async function nextDeviceSequence(
  executor: SqlExecutor | SQLiteDatabase,
  deviceId: string,
  updatedAt = Date.now(),
): Promise<number> {
  const row = await executor.getFirstAsync<{ sequence: number }>(
    `UPDATE device_clocks
     SET sequence = sequence + 1, updated_at = ?
     WHERE device_id = ?
     RETURNING sequence`,
    [updatedAt, deviceId],
  );
  if (!row) throw new Error(`No logical clock exists for device ${deviceId}.`);
  return row.sequence;
}
