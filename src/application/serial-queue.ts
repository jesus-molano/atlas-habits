/**
 * A tiny promise queue for React callers that intentionally do not await
 * persistence. A rejected write is observed and does not poison later writes.
 */
export class SerializedAsyncQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}
