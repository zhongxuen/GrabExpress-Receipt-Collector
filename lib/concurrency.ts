/**
 * Runs `worker` over `items` with at most `limit` in flight at once,
 * preserving input order in the returned array. Used to fetch many Gmail
 * messages in parallel batches instead of one at a time, which is what
 * keeps large-mailbox exports under Vercel's function time limit.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runNext));

  return results;
}
