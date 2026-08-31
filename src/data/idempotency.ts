import type { SQLiteDatabase } from 'expo-sqlite';

import { parseStoredJson, stableStringify } from './canonical-json';
import { withWriteTransaction, type SqlExecutor } from './transaction';
import type { CommandExecution } from './types';

type ReceiptRow = {
  command_name: string;
  request_fingerprint: string;
  result_json: string;
};

export type IdempotentCommand<TPayload> = {
  id: string;
  name: string;
  payload: TPayload;
  issuedAt?: number;
};

export class CommandReceiptConflictError extends Error {
  constructor(commandId: string) {
    super(`Command ${commandId} was already used with different input.`);
    this.name = 'CommandReceiptConflictError';
  }
}

export async function executeIdempotentCommand<TPayload, TResult>(
  database: SQLiteDatabase,
  command: IdempotentCommand<TPayload>,
  apply: (transaction: SqlExecutor) => Promise<TResult>,
): Promise<CommandExecution<TResult>> {
  if (!command.id.trim()) throw new Error('A command ID is required.');
  if (!command.name.trim()) throw new Error('A command name is required.');
  const fingerprint = stableStringify(command.payload);

  return withWriteTransaction(database, async (transaction) => {
    const receipt = await transaction.getFirstAsync<ReceiptRow>(
      `SELECT command_name, request_fingerprint, result_json
       FROM command_receipts
       WHERE command_id = ?`,
      [command.id],
    );

    if (receipt) {
      if (
        receipt.command_name !== command.name ||
        receipt.request_fingerprint !== fingerprint
      ) {
        throw new CommandReceiptConflictError(command.id);
      }
      return {
        value: parseStoredJson<TResult>(
          receipt.result_json,
          `receipt for ${command.id}`,
        ),
        replayed: true,
      };
    }

    const value = await apply(transaction);
    await transaction.runAsync(
      `INSERT INTO command_receipts
        (command_id, command_name, request_fingerprint, result_json, applied_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        command.id,
        command.name,
        fingerprint,
        stableStringify(value),
        command.issuedAt ?? Date.now(),
      ],
    );

    return { value, replayed: false };
  });
}
