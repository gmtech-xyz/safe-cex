export const inverseObj = <
  TKey extends number | string | symbol,
  TValue extends number | string | symbol
>(
  obj: Record<TKey, TValue>
) =>
  Object.entries(obj).reduce((acc, [key, value]) => {
    return { ...acc, [value as TKey]: key as TValue };
  }, {} as Record<TValue, TKey>);
