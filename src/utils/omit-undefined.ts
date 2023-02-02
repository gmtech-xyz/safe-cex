import { omitBy } from 'lodash';

export const omitUndefined = <T extends Record<string, any>>(obj: T): T => {
  return omitBy<T>(obj, (value) => value === undefined) as T;
};
