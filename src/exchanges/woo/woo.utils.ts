import { memoize } from 'lodash';

export const normalizeSymbol = memoize((str: string) => {
  const [, baseAsset, quoteAsset] = str.split('_');
  return `${baseAsset}${quoteAsset}`;
});

export const reverseSymbol = memoize((str: string) => {
  const asset = str.replace('USDT', '');
  return `PERP_${asset}_USDT`;
});
