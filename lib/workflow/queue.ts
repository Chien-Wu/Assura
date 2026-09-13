// Sources, form edits and awaitable client tools share one ordered channel.
// A failed operation rejects its caller without stranding later cleanup work.
export function createWorkflowQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.catch(() => undefined);
      return result;
    },
    drain: () => tail,
  };
}
