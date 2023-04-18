import omitBy from 'lodash/omitBy';

export const omitUndefined = <T extends Record<string, any>>(obj: T): T => {
  return omitBy<T>(obj, (value) => value === undefined) as T;
};
