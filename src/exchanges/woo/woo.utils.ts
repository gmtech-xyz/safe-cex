import { memoize } from 'lodash';

export const normalizeSymbol = memoize((str: string) => {
  const [, baseAsset, quoteAsset] = str.split('_');
  return `${baseAsset}${quoteAsset}`;
});
