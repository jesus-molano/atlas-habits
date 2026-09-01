import { describe, expect, it, vi } from 'vitest';

import { runSingleFlight } from './single-flight';

describe('runSingleFlight', () => {
  it('ignores a repeated event while the first operation is pending', async () => {
    let complete: ((value: string) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const lock = { current: false };

    const first = runSingleFlight(lock, operation);
    const repeated = runSingleFlight(lock, operation);

    await expect(repeated).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledTimes(1);
    complete?.('guardado');
    await expect(first).resolves.toBe('guardado');

    const next = runSingleFlight(lock, operation);
    expect(operation).toHaveBeenCalledTimes(2);
    complete?.('otro guardado');
    await expect(next).resolves.toBe('otro guardado');
  });
});
