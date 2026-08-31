export class SyncIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncIntegrityError';
  }
}

export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SyncGapError extends Error {
  readonly deviceId: string;
  readonly expectedSeq: number;
  readonly receivedSeq: number;

  constructor(deviceId: string, expectedSeq: number, receivedSeq: number) {
    super(
      `Sync history for ${deviceId} has a gap: expected sequence ${expectedSeq}, received ${receivedSeq}.`,
    );
    this.name = 'SyncGapError';
    this.deviceId = deviceId;
    this.expectedSeq = expectedSeq;
    this.receivedSeq = receivedSeq;
  }
}

export class SyncAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthenticationError';
  }
}
