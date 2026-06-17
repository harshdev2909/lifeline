/**
 * serialize.ts — a one-at-a-time gate for SDK-touching work.
 *
 * Turns and mesh probes share one QVAC worker and registry corestore, so they
 * must not overlap. Every such operation runs through `withLock`, which queues
 * callers and runs them strictly in order. The UI is single-user and local, so a
 * serial pipeline is exactly right.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive even if a task throws.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function isBusy(): boolean {
  return pending > 0;
}

let pending = 0;
export async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  pending++;
  try {
    return await withLock(fn);
  } finally {
    pending--;
  }
}
