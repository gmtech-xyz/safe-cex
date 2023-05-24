import { BinanceExchange } from './exchanges/binance/binance.exchange';
import { BybitExchange } from './exchanges/bybit/bybit.exchange';
import { GateExchange } from './exchanges/gate/gate.exchange';
import { OKXExchange } from './exchanges/okx/okx.exchange';
import { WOOXExchange } from './exchanges/woo/woo.exchange';
import { DefaultStore } from './store/store.base';
import type { Store } from './store/store.interface';
import type { ExchangeOptions } from './types';
import { virtualClock } from './utils/virtual-clock';

const exchanges = {
  bybit: BybitExchange,
  binance: BinanceExchange,
  woo: WOOXExchange,
  okx: OKXExchange,
  gate: GateExchange,
};

export const createExchange = (
  exchangeName: keyof typeof exchanges,
  options: ExchangeOptions & { key?: string; secret?: string },
  store?: Store
) => {
  // start the virtual clock to contact exchanges
  // with a server timestamp
  virtualClock.start();

  const Exchange = exchanges[exchangeName];
  return new Exchange(
    { ...options, key: options.key || '', secret: options.secret || '' },
    store || new DefaultStore()
  );
};
