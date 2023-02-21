import { Binance } from './exchanges/binance/binance.exchange';
import { Bybit } from './exchanges/bybit/bybit.exchange';
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
