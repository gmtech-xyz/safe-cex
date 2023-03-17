export const loop = (fn: () => void) => {
  if (typeof window !== 'undefined' && document.visibilityState === 'visible') {
    requestAnimationFrame(() => fn());
  } else {
    setTimeout(() => fn(), 0);
  }
};
