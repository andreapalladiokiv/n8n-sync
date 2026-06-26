// Debounced + serialized runner: a burst of triggers coalesces into ONE run, runs never overlap,
// and a trigger arriving DURING a run re-fires once that run finishes. Pure (no n8n) → unit-tested.

export interface DebouncedRunner { schedule(): void }

export function makeDebouncedRunner(
  run: () => Promise<void>,
  debounceMs: number,
  onSettled?: (err?: unknown) => void,
): DebouncedRunner {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;

  function fire(): void {
    timer = null;
    if (running || !dirty) return;
    dirty = false;
    running = true;
    run()
      .then(() => onSettled?.())
      .catch((e: unknown) => onSettled?.(e))
      .finally(() => { running = false; if (dirty) schedule(); });
  }

  function schedule(): void {
    dirty = true;
    if (timer || running) return;
    timer = setTimeout(fire, debounceMs);
  }

  return { schedule };
}
