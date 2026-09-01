import type { SyncIssue } from '../features/atlas/types';
import {
  SyncAuthenticationError,
  SyncConflictError,
  SyncGapError,
  SyncIntegrityError,
} from '../sync/errors';

export type SyncFailureKind =
  | 'cancelled'
  | 'network'
  | 'google-provider-disabled'
  | 'credentials-configuration'
  | 'firestore-permission'
  | 'firestore-setup'
  | 'account-not-authorized'
  | 'remote-integrity'
  | 'unknown';

export type SyncFailureDescription = Readonly<{
  kind: SyncFailureKind;
  retryable: boolean;
  message: string;
}>;

function remediationFor(kind: SyncFailureKind): SyncIssue['remediation'] {
  if (kind === 'network') return 'network';
  if (
    kind === 'google-provider-disabled' ||
    kind === 'credentials-configuration'
  ) {
    return 'google-config';
  }
  if (kind === 'firestore-permission' || kind === 'firestore-setup') {
    return 'firestore-access';
  }
  if (kind === 'unknown') return 'retry';
  return 'none';
}

function textProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' || typeof property === 'number'
    ? String(property)
    : undefined;
}

function errorSignal(error: unknown): string {
  return [
    textProperty(error, 'code'),
    textProperty(error, 'name'),
    textProperty(error, 'message'),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();
}

function includesAny(signal: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => signal.includes(candidate));
}

export function classifySyncFailure(error: unknown): SyncFailureKind {
  const signal = errorSignal(error);

  if (
    includesAny(signal, [
      'sign_in_cancelled',
      'sign-in-cancelled',
      'popup-closed-by-user',
      'cancelled-popup-request',
      'user_cancelled',
      'user-cancelled',
    ])
  ) {
    return 'cancelled';
  }
  if (
    includesAny(signal, [
      'network_error',
      'network-request-failed',
      'app-offline',
      'firestore/unavailable',
      'firebase/firestore-unavailable',
      'deadline-exceeded',
      'timed out',
      'timeout',
      'offline',
    ]) ||
    ['7', 'unavailable'].includes(textProperty(error, 'code') ?? '')
  ) {
    return 'network';
  }
  if (includesAny(signal, ['operation-not-allowed'])) {
    return 'google-provider-disabled';
  }
  if (
    includesAny(signal, [
      'developer_error',
      'configuration-not-found',
      'invalid-api-key',
      'api key not valid',
      'app-not-authorized',
      'unauthorized-domain',
      'invalid-oauth',
      'invalid-credential',
      'google_web_client_id',
      'google did not return an id token',
    ]) ||
    textProperty(error, 'code') === '10'
  ) {
    return 'credentials-configuration';
  }
  if (
    includesAny(signal, [
      'permission-denied',
      'insufficient permission',
      'insufficient permissions',
    ])
  ) {
    return 'firestore-permission';
  }
  if (
    includesAny(signal, [
      'firestore/failed-precondition',
      'firebase/firestore-failed-precondition',
      'firestore/not-found',
      'database does not exist',
    ]) ||
    ['failed-precondition'].includes(textProperty(error, 'code') ?? '')
  ) {
    return 'firestore-setup';
  }
  if (
    error instanceof SyncAuthenticationError ||
    includesAny(signal, [
      'configured owner',
      'expected owner',
      'not the configured owner',
      'not authorized for sync',
    ])
  ) {
    return 'account-not-authorized';
  }
  if (
    error instanceof SyncIntegrityError ||
    error instanceof SyncConflictError ||
    error instanceof SyncGapError
  ) {
    return 'remote-integrity';
  }
  return 'unknown';
}

export function googleAccessFailure(error: unknown): SyncFailureDescription {
  const kind = classifySyncFailure(error);
  switch (kind) {
    case 'cancelled':
      return {
        kind,
        retryable: false,
        message:
          'Se canceló el acceso con Google. Tus datos siguen guardados en este dispositivo.',
      };
    case 'network':
      return {
        kind,
        retryable: true,
        message:
          'No hay conexión suficiente para acceder con Google. Tus datos siguen guardados en este dispositivo; inténtalo de nuevo cuando tengas red.',
      };
    case 'google-provider-disabled':
      return {
        kind,
        retryable: false,
        message:
          'El acceso con Google no está habilitado en Firebase Authentication. Actívalo y vuelve a intentarlo. Tus datos locales no se han modificado.',
      };
    case 'credentials-configuration':
      return {
        kind,
        retryable: false,
        message:
          'La configuración de Google de esta versión no coincide con Firebase. Revisa el cliente web, el paquete y las huellas SHA. Tus datos locales siguen intactos.',
      };
    case 'account-not-authorized':
      return {
        kind,
        retryable: false,
        message:
          'Esta cuenta de Google no está autorizada para sincronizar. Usa la cuenta configurada; tus datos locales siguen intactos.',
      };
    default:
      return {
        kind,
        retryable: false,
        message:
          'No se pudo acceder con Google. Tus datos siguen guardados en este dispositivo.',
      };
  }
}

export function initialSyncFailure(error: unknown): SyncFailureDescription {
  const kind = classifySyncFailure(error);
  switch (kind) {
    case 'network':
      return {
        kind,
        retryable: true,
        message:
          'Cuenta conectada. Los cambios quedan pendientes y Atlas volverá a sincronizarlos cuando tengas conexión.',
      };
    case 'firestore-permission':
      return {
        kind,
        retryable: false,
        message:
          'Firestore ha rechazado el acceso de esta cuenta. Comprueba que has iniciado sesión con la cuenta prevista y que las reglas de seguridad permiten acceder a sus propios datos. Tus datos locales siguen intactos.',
      };
    case 'firestore-setup':
      return {
        kind,
        retryable: false,
        message:
          'Firestore aún no está listo para sincronizar. Comprueba que la base de datos esté creada y configurada. Tus datos locales siguen intactos.',
      };
    case 'remote-integrity':
      return {
        kind,
        retryable: false,
        message:
          'Los datos remotos no han superado la comprobación de integridad. La sincronización no se ha activado y tus datos locales siguen intactos.',
      };
    case 'google-provider-disabled':
    case 'credentials-configuration':
    case 'account-not-authorized':
      return googleAccessFailure(error);
    default:
      return {
        kind,
        retryable: false,
        message:
          'No se pudo completar la primera sincronización. No se ha activado y tus datos locales siguen intactos.',
      };
  }
}

export function syncIssueFor(error: unknown): Readonly<{
  failure: SyncFailureDescription;
  issue: SyncIssue;
}> {
  const failure = initialSyncFailure(error);
  return {
    failure,
    issue: {
      kind: failure.kind,
      remediation: remediationFor(failure.kind),
    },
  };
}
