export function createConcurrencyBarrier(target: number) {
  let count = 0;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    hit: () => {
      if (++count >= target) release();
    },
    get count() {
      return count;
    },
  };
}
