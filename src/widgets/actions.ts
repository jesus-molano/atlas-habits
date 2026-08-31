import {
  createCompleteOccurrenceEnvelope,
  type CommandEnvelope,
  type CommandTargetKind,
  commandTargetKinds,
} from '../platform/commands';

import type { WidgetCompletableItem } from './model';

export const WIDGET_ACTIONS = {
  complete: 'ATLAS_WIDGET_COMPLETE',
} as const;

export interface WidgetCompletionActionData {
  readonly [key: string]: unknown;
  readonly targetKind: CommandTargetKind;
  readonly targetId: string;
  readonly occurrenceId: string;
}

export function createWidgetCompletionActionData(
  item: WidgetCompletableItem,
): WidgetCompletionActionData {
  return {
    targetKind: item.targetKind,
    targetId: item.targetId,
    occurrenceId: item.occurrenceId,
  };
}

/** Pure translation used by the Android headless widget handler. */
export function widgetClickToCommand(
  clickAction: string | undefined,
  clickActionData: unknown,
  issuedAt: Date,
): CommandEnvelope | null {
  if (
    clickAction !== WIDGET_ACTIONS.complete ||
    !isWidgetCompletionActionData(clickActionData)
  ) {
    return null;
  }

  return createCompleteOccurrenceEnvelope({
    ...clickActionData,
    source: 'widget',
    issuedAt,
  });
}

function isWidgetCompletionActionData(
  value: unknown,
): value is WidgetCompletionActionData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    typeof data.targetKind === 'string' &&
    (commandTargetKinds as readonly string[]).includes(data.targetKind) &&
    isNonEmptyString(data.targetId) &&
    isNonEmptyString(data.occurrenceId)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
