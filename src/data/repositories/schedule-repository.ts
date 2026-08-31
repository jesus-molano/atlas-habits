import type { SQLiteDatabase } from 'expo-sqlite';

import { stableStringify } from '../canonical-json';
import { executeIdempotentCommand } from '../idempotency';
import { recordMutation } from '../oplog';
import type { SqlExecutor } from '../transaction';
import type {
  CommandExecution,
  ScheduleGoalInput,
  ScheduleSlotInput,
  ScheduleVersionInput,
} from '../types';
import { createUuid } from '../uuid';

type AddScheduleVersionCommand = {
  commandId: string;
  deviceId: string;
  issuedAt?: number;
  payload: {
    scheduleId: string;
    version: ScheduleVersionInput;
    createdAt?: number;
  };
};

type ScheduleHeadRow = {
  version_id: string;
  item_id: string;
  workspace_id: string;
  version_number: number;
  effective_from: string;
};

export type AddedScheduleVersion = {
  scheduleId: string;
  versionId: string;
  versionNumber: number;
  slots: (ScheduleSlotInput & { id: string })[];
  goals: (ScheduleGoalInput & { id: string; slotId: string | null })[];
};

async function insertChildren(
  transaction: SqlExecutor,
  versionId: string,
  version: ScheduleVersionInput,
): Promise<Pick<AddedScheduleVersion, 'slots' | 'goals'>> {
  const slots = (version.slots ?? []).map((slot) => ({
    ...slot,
    id: slot.id ?? createUuid(),
  }));
  const slotsByKey = new Map(slots.map((slot) => [slot.key, slot.id]));
  for (const slot of slots) {
    await transaction.runAsync(
      `INSERT INTO schedule_slots
        (id, schedule_version_id, slot_key, label, local_time, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        slot.id,
        versionId,
        slot.key,
        slot.label ?? null,
        slot.localTime ?? null,
        slot.sortOrder ?? 0,
      ],
    );
  }

  const goals = (version.goals ?? []).map((goal) => {
    const slotId =
      goal.slotId ??
      (goal.slotKey ? slotsByKey.get(goal.slotKey) : null) ??
      null;
    if (goal.slotKey && !slotId)
      throw new Error(`Unknown schedule slot: ${goal.slotKey}`);
    return { ...goal, id: goal.id ?? createUuid(), slotId };
  });
  for (const goal of goals) {
    await transaction.runAsync(
      `INSERT INTO schedule_goals
        (id, schedule_version_id, slot_id, measurement_type, aggregation,
         comparison, target_value, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.id,
        versionId,
        goal.slotId,
        goal.measurementType,
        goal.aggregation ??
          (goal.measurementType === 'boolean' ? 'count' : 'sum'),
        goal.comparison ?? 'at_least',
        goal.targetValue,
        goal.unit ?? null,
      ],
    );
  }
  return { slots, goals };
}

export class ScheduleRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  addVersion(
    command: AddScheduleVersionCommand,
  ): Promise<CommandExecution<AddedScheduleVersion>> {
    return executeIdempotentCommand(
      this.database,
      {
        id: command.commandId,
        name: 'schedule.add_version',
        payload: command.payload,
        issuedAt: command.issuedAt,
      },
      async (transaction) => {
        const head = await transaction.getFirstAsync<ScheduleHeadRow>(
          `SELECT s.item_id, i.workspace_id, sv.id AS version_id,
                  sv.version_number, sv.effective_from
           FROM schedules s
           JOIN items i ON i.id = s.item_id
           JOIN schedule_versions sv ON sv.schedule_id = s.id
           WHERE s.id = ?
           ORDER BY sv.version_number DESC
           LIMIT 1`,
          [command.payload.scheduleId],
        );
        if (!head)
          throw new Error(
            `Schedule ${command.payload.scheduleId} does not exist.`,
          );
        if (command.payload.version.effectiveFrom < head.effective_from) {
          throw new Error(
            'A new schedule version cannot start before the current version.',
          );
        }

        const now = command.payload.createdAt ?? command.issuedAt ?? Date.now();
        if (command.payload.version.effectiveFrom === head.effective_from) {
          // Same-day edits amend the unelapsed head. Once a later civil date is
          // reached, addVersion creates an immutable historical boundary.
          await transaction.runAsync(
            'DELETE FROM schedule_goals WHERE schedule_version_id = ?',
            [head.version_id],
          );
          await transaction.runAsync(
            'DELETE FROM schedule_slots WHERE schedule_version_id = ?',
            [head.version_id],
          );
          await transaction.runAsync(
            `UPDATE schedule_versions
             SET effective_until = ?, rule_type = ?, rule_json = ?, grace_minutes = ?
             WHERE id = ?`,
            [
              command.payload.version.effectiveUntil ?? null,
              command.payload.version.ruleType,
              stableStringify(command.payload.version.rule),
              command.payload.version.graceMinutes ?? 0,
              head.version_id,
            ],
          );
          const children = await insertChildren(
            transaction,
            head.version_id,
            command.payload.version,
          );
          const value: AddedScheduleVersion = {
            scheduleId: command.payload.scheduleId,
            versionId: head.version_id,
            versionNumber: head.version_number,
            ...children,
          };
          await recordMutation(transaction, {
            commandId: command.commandId,
            deviceId: command.deviceId,
            workspaceId: head.workspace_id,
            entityType: 'schedule',
            entityId: command.payload.scheduleId,
            operation: 'upsert',
            payload: {
              itemId: head.item_id,
              ...value,
              version: command.payload.version,
            },
            now,
          });
          return value;
        }

        const versionId = createUuid();
        const versionNumber = head.version_number + 1;
        await transaction.runAsync(
          `UPDATE schedule_versions
           SET effective_until = date(?, '-1 day')
           WHERE schedule_id = ? AND version_number = ?`,
          [
            command.payload.version.effectiveFrom,
            command.payload.scheduleId,
            head.version_number,
          ],
        );
        await transaction.runAsync(
          `INSERT INTO schedule_versions
            (id, schedule_id, version_number, effective_from, effective_until,
             rule_type, rule_json, grace_minutes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            command.payload.scheduleId,
            versionNumber,
            command.payload.version.effectiveFrom,
            command.payload.version.effectiveUntil ?? null,
            command.payload.version.ruleType,
            stableStringify(command.payload.version.rule),
            command.payload.version.graceMinutes ?? 0,
            now,
          ],
        );
        const children = await insertChildren(
          transaction,
          versionId,
          command.payload.version,
        );
        const value: AddedScheduleVersion = {
          scheduleId: command.payload.scheduleId,
          versionId,
          versionNumber,
          ...children,
        };
        await recordMutation(transaction, {
          commandId: command.commandId,
          deviceId: command.deviceId,
          workspaceId: head.workspace_id,
          entityType: 'schedule',
          entityId: command.payload.scheduleId,
          operation: 'upsert',
          payload: {
            itemId: head.item_id,
            ...value,
            version: command.payload.version,
          },
          now,
        });
        return value;
      },
    );
  }
}
