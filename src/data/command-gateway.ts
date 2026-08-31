import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './database';
import { ActionRepository } from './repositories/action-repository';
import { ItemRepository } from './repositories/item-repository';
import { ProgressRepository } from './repositories/progress-repository';
import { QueryRepository } from './repositories/query-repository';
import { ScheduleRepository } from './repositories/schedule-repository';

/**
 * Single write entry point for UI, notifications and widgets. Every exposed
 * command is persisted with an idempotency receipt and an oplog entry.
 */
export class CommandGateway {
  readonly items: ItemRepository;
  readonly actions: ActionRepository;
  readonly progress: ProgressRepository;
  readonly queries: QueryRepository;
  readonly schedules: ScheduleRepository;

  constructor(database: SQLiteDatabase) {
    this.actions = new ActionRepository(database);
    this.items = new ItemRepository(database);
    this.progress = new ProgressRepository(database);
    this.queries = new QueryRepository(database);
    this.schedules = new ScheduleRepository(database);
  }
}

let gatewayPromise: Promise<CommandGateway> | null = null;

export function getCommandGateway(): Promise<CommandGateway> {
  gatewayPromise ??= getDatabase().then(
    (database) => new CommandGateway(database),
  );
  return gatewayPromise;
}
