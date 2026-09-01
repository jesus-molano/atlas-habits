export type SingleFlightLock = { current: boolean };

/** Prevents repeated UI events from starting the same async action twice. */
export async function runSingleFlight<Result>(
  lock: SingleFlightLock,
  operation: () => Promise<Result>,
): Promise<Result | undefined> {
  if (lock.current) return undefined;
  lock.current = true;
  try {
    return await operation();
  } finally {
    lock.current = false;
  }
}
