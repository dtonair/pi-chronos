export interface LifecycleResource {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** Idempotent lifecycle wrapper used by session_start/session_shutdown adapters. */
export function createLifecycle(resources: readonly LifecycleResource[]) {
  let started = false;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  async function start(): Promise<void> {
    if (starting) return starting;
    if (started) return;
    starting = (async () => {
      started = true;
      try {
        for (const resource of resources) await resource.start();
      } catch (error) {
        started = false;
        try {
          await stopResources(resources);
        } catch {
          // Preserve the startup failure; cleanup failures are best effort.
        }
        throw error;
      } finally {
        starting = undefined;
      }
    })();
    return starting;
  }
  async function stop(): Promise<void> {
    if (starting) {
      try {
        await starting;
      } catch {
        // Startup already performed best-effort cleanup.
      }
    }
    if (!started && !stopping) return;
    if (stopping) return stopping;
    stopping = (async () => {
      try {
        await stopResources(resources);
      } finally {
        started = false;
        stopping = undefined;
      }
    })();
    return stopping;
  }
  return {
    start,
    stop,
    get started(): boolean {
      return started;
    },
  };
}

async function stopResources(resources: readonly LifecycleResource[]): Promise<void> {
  let firstError: unknown;
  for (const resource of [...resources].reverse()) {
    try {
      await resource.stop();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}
