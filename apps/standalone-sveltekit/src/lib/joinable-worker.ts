export function createJoinableWorker(work: () => Promise<void>): () => Promise<void> {
  let requested = false;
  let active: Promise<void> | null = null;

  return async () => {
    requested = true;
    if (!active) {
      active = (async () => {
        try {
          while (requested) {
            requested = false;
            await work();
          }
        } finally {
          active = null;
        }
      })();
    }
    await active;
  };
}
