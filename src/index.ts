import { Binance } from './exchanges/binance/binance.exchange';
import { Bybit } from './exchanges/bybit/bybit.exchange';
import { Woo } from './exchanges/woo/woo.exchange';
import { DefaultStore } from './store/store.base';
import type { Store } from './store/store.interface';
import type { ExchangeOptions } from './types';
import { virtualClock } from './utils/virtual-clock';

const exchanges = {
  bybit: Bybit,
  binance: Binance,
  woo: Woo,
};

export const createExchange = (
  exchangeName: keyof typeof exchanges,
  options: ExchangeOptions,
  store?: Store
) => {
  // start the virtual clock to contact exchanges
  // with a server timestamp
  virtualClock.start();

  const Exchange = exchanges[exchangeName];
  return new Exchange(options, store || new DefaultStore());
};
