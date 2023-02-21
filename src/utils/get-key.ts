import { camelCase, memoize, snakeCase } from 'lodash';

const s = memoize(snakeCase);
const c = memoize(camelCase);

export const v = (obj: Record<string, any>, key: string) => {
  if (typeof obj === 'undefined') return undefined;
  if (key in obj) return obj[key];
  if (s(key) in obj) return obj[s(key)];
  if (c(key) in obj) return obj[c(key)];
  return undefined;
};
