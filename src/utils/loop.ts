import { sleep } from './sleep';

export const loop = async (fn: () => void, minInterval?: number) => {
  if (minInterval) {
    await sleep(minInterval);
  }

  if (typeof window !== 'undefined' && document.visibilityState === 'visible') {
    requestAnimationFrame(() => fn());
  } else {
    setTimeout(() => fn(), 0);
  }
};
