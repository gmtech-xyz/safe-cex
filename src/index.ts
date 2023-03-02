import { Binance } from './exchanges/binance/binance.exchange';
import { Bybit } from './exchanges/bybit/bybit.exchange';
import type { ExchangeOptions } from './types';
import { virtualClock } from './utils/virtual-clock';

const exchanges = {
  bybit: Bybit,
  binance: Binance,
};

export const createExchange = (
  exchangeName: keyof typeof exchanges,
  options: ExchangeOptions
) => {
  // start the virtual clock to contact exchanges
  // with a server timestamp
  virtualClock.start();

  const Exchange = exchanges[exchangeName];
  return new Exchange(options);
};
