type RecorderHandoffOutcome<T> = {
  note: T | null;
  error: Error | null;
};

type RecorderHandoffSteps<T> = {
  stopAdmission(): void;
  waitForStartup(): Promise<unknown>;
  drainWrites(): Promise<unknown>;
  closeSession(): Promise<unknown>;
  readSaved(): Promise<T>;
  complete(outcome: RecorderHandoffOutcome<T>): void;
};

/** Stop once, finish admitted work, and read the saved version for review. */
export function createRecorderHandoff<T>(steps: RecorderHandoffSteps<T>) {
  let pending: Promise<RecorderHandoffOutcome<T>> | undefined;

  return function finish(): Promise<RecorderHandoffOutcome<T>> {
    if (pending) return pending;

    let resolve!: (outcome: RecorderHandoffOutcome<T>) => void;
    // SDK shutdown can synchronously call onDisconnect, which calls finish again.
    // Publish the promise before stopping admission so every caller shares it.
    pending = new Promise((done) => {
      resolve = done;
    });
    let error: Error | null = null;
    const rememberError = (cause: unknown) => {
      error ??=
        cause instanceof Error
          ? cause
          : new Error(
              typeof cause === "string"
                ? cause
                : "Could not finish saving the conversation.",
            );
    };
    try {
      steps.stopAdmission();
    } catch (cause) {
      rememberError(cause);
    }

    void (async () => {
      // Even after a failed write or cancelled startup, close any session that
      // was created. The first error keeps the result from entering review.
      for (const step of [
        () => steps.waitForStartup(),
        () => steps.drainWrites(),
        () => steps.closeSession(),
      ]) {
        try {
          await step();
        } catch (cause) {
          rememberError(cause);
        }
      }

      let note: T | null = null;
      try {
        // A fresh note can restore the editor after a failure, but it does not
        // clear that failure or prove every transcript update was saved.
        note = await steps.readSaved();
      } catch (cause) {
        rememberError(cause);
      }
      const outcome = { note, error };
      try {
        steps.complete(outcome);
      } catch (cause) {
        rememberError(cause);
        outcome.error = error;
      }
      resolve(outcome);
    })();

    return pending;
  };
}
