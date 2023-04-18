export const clone = <K extends Record<string, any>>(obj: K): K => {
  if (typeof structuredClone !== 'undefined') {
    return structuredClone(obj);
  }

  return JSON.parse(JSON.stringify(obj));
};
