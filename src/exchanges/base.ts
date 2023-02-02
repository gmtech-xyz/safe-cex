import { forEachSeries } from 'p-iteration';
import type WebSocket from 'ws';

import { createStore } from '../store';
import type { ExchangeOptions, Store } from '../types';

export class BaseExchange {
  store: Store;
  options: ExchangeOptions;

  isDisposed: boolean = false;

  wsPrivate?: WebSocket;
  wsPublic?: WebSocket;

  constructor(opts: ExchangeOptions) {
    this.options = opts;
    this.store = createStore();
  }

  ping = () => {
    const handler = (start: number) => () => {
      if (!this.isDisposed) {
        const diff = performance.now() - start;
        this.store.latency = Math.round(diff / 2);

        setTimeout(() => this.ping(), 10_000);
      }
    };

    if (!this.isDisposed) {
      this.wsPrivate?.ping?.();
      this.wsPrivate?.once?.('pong', handler(performance.now()));
    }
  };

  setLeverage = async (_symbol: string, _leverage: number) => {
    await Promise.reject(new Error('Not implemented'));
  };

  setAllLeverage = async (inputLeverage: number) => {
    await forEachSeries(this.store.positions, async (position) => {
      await this.setLeverage(position.symbol, inputLeverage);
    });
  };

  dispose() {
    this.isDisposed = true;

    this.store.latency = 0;
    this.store.markets = [];
    this.store.positions = [];
    this.store.orders = [];
    this.store.tickers = [];

    if (this.wsPrivate) {
      this.wsPrivate.close();
      this.wsPrivate = undefined;
    }

    if (this.wsPublic) {
      this.wsPublic.close();
      this.wsPublic = undefined;
    }
  }
}
