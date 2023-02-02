import { Binance } from './exchanges/binance';
import { Bybit } from './exchanges/bybit';
import type { ExchangeOptions } from './types';

const exchanges = {
  bybit: Bybit,
  binance: Binance,
};

export const createExchange = (
  exchangeName: keyof typeof exchanges,
  options: ExchangeOptions
) => {
  const Exchange = exchanges[exchangeName];
  return new Exchange(options);
};
