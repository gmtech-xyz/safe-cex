import type { Axios } from 'axios';
import axios from 'axios';
import { uniq } from 'lodash';
import { forEachSeries } from 'p-iteration';
import Emitter from 'tiny-emitter';
import { snapshot, subscribe } from 'valtio/vanilla';

import { createStore, defaultStore } from '../store';
import type {
  Candle,
  ExchangeOptions,
  OHLCVOptions,
  Order,
  PlaceOrderOpts,
  Store,
  UpdateOrderOpts,
} from '../types';
import { LogSeverity, OrderSide, OrderType } from '../types';
import type { createWebSocket } from '../utils/universal-ws';

export interface Exchange {
  store: Store;
  emitter: Emitter.TinyEmitter;
  options: ExchangeOptions;
  isDisposed: boolean;
  on: Emitter.TinyEmitter['on'];
  once: Emitter.TinyEmitter['once'];
  off: Emitter.TinyEmitter['off'];
  dispose: () => void;
  validateAccount: () => Promise<string>;
  start: () => Promise<void>;
  nuke: () => Promise<void>;
  setLeverage: (symbol: string, leverage: number) => Promise<void>;
  setAllLeverage: (leverage: number) => Promise<void>;
  placeOrder: (opts: PlaceOrderOpts) => Promise<void>;
  placeOrders: (orders: PlaceOrderOpts[]) => Promise<void>;
  updateOrder: (opts: UpdateOrderOpts) => Promise<void>;
  cancelOrders: (orders: Order[]) => Promise<void>;
  cancelSymbolOrders: (symbol: string) => Promise<void>;
  cancelAllOrders: () => Promise<void>;
  fetchOHLCV: (opts: OHLCVOptions) => Promise<Candle[]>;
  listenOHLCV: (
    opts: OHLCVOptions,
    callback: (candle: Candle) => any
  ) => () => void;
}

export class BaseExchange implements Exchange {
  store: Store;
  options: ExchangeOptions;
  emitter: Emitter.TinyEmitter = new (Emitter as any)();

  isDisposed: boolean = false;
  isNuking: boolean = false;

  wsPrivate?: ReturnType<typeof createWebSocket>;
  wsPublic?: ReturnType<typeof createWebSocket>;

  on: Emitter.TinyEmitter['on'];
  once: Emitter.TinyEmitter['once'];
  off: Emitter.TinyEmitter['off'];

  xhr: Axios = axios.create();
  unlimitedXHR: Axios = axios.create();

  constructor(opts: ExchangeOptions) {
    this.options = opts;
    this.store = createStore();

    this.on = this.emitter.on.bind(this.emitter);
    this.once = this.emitter.once.bind(this.emitter);
    this.off = this.emitter.off.bind(this.emitter);

    subscribe(this.store, () => {
      this.emitter.emit('update', snapshot(this.store));
    });
  }

  onWSPrivateClose = () => {};
  onWSPublicClose = () => {};

  validateAccount = async () => {
    return await Promise.resolve('Unsupported exchange');
  };

  log = (message: string, severity: LogSeverity = LogSeverity.Info) => {
    this.emitter.emit('log', message, severity);
  };

  ping = () => {
    const pong = (start: number) => () => {
      if (!this.isDisposed) {
        const diff = performance.now() - start;
        this.store.latency = Math.round(diff / 2);
        setTimeout(() => this.ping(), 10_000);
      }
    };

    if (!this.isDisposed) {
      this.wsPrivate?.ping?.(pong(performance.now()));
    }
  };

  start = async () => {
    await Promise.reject(new Error('Not implemented'));
  };

  setLeverage = async (_symbol: string, _leverage: number) => {
    await Promise.reject(new Error('Not implemented'));
  };

  setAllLeverage = async (inputLeverage: number) => {
    await forEachSeries(this.store.positions, async (position) => {
      if (!this.isDisposed) {
        await this.setLeverage(position.symbol, inputLeverage);
      }
    });
  };

  placeOrder = async (_opts: PlaceOrderOpts) => {
    await Promise.reject(new Error('Not implemented'));
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    await forEachSeries(orders, async (order) => {
      if (!this.isDisposed) {
        await this.placeOrder(order);
      }
    });
  };

  updateOrder = async (_opts: UpdateOrderOpts) => {
    await Promise.reject(new Error('Not implemented'));
  };

  cancelOrders = async (_orders: Order[]) => {
    await Promise.reject(new Error('Not implemented'));
  };

  cancelSymbolOrders = async (_symbol: string) => {
    await Promise.reject(new Error('Not implemented'));
  };

  cancelAllOrders = async () => {
    const symbols = uniq(this.store.orders.map((order) => order.symbol));

    await forEachSeries(symbols, async (symbol) => {
      if (!this.isDisposed) {
        await this.cancelSymbolOrders(symbol);
      }
    });
  };

  fetchOHLCV = async (_opts: OHLCVOptions) => {
    return await Promise.resolve([] as Candle[]);
  };

  listenOHLCV = (_opts: OHLCVOptions, _callback: (candle: Candle) => any) => {
    return () => {};
  };

  nuke = async () => {
    if (!this.isDisposed && !this.isNuking) {
      // close all positions
      const openPositions = this.store.positions.filter(
        (position) => position.contracts > 0
      );

      await forEachSeries(openPositions, async (position) => {
        await this.placeOrder({
          symbol: position.symbol,
          side: position.side === 'long' ? OrderSide.Sell : OrderSide.Buy,
          type: OrderType.Market,
          amount: position.contracts,
          reduceOnly: true,
        });
      });

      // cancel all orders
      await this.cancelAllOrders();
    }
  };

  removeOrderFromStore = (orderId: string) => {
    const idx = this.store.orders.findIndex((order) => order.id === orderId);

    if (idx >= 0) {
      this.store.orders.splice(idx, 1);
    }
  };

  removeOrdersFromStore = (orderIds: string[]) => {
    orderIds.forEach((orderId) => this.removeOrderFromStore(orderId));
  };

  addOrReplaceOrderFromStore = (order: Order) => {
    const idx = this.store.orders.findIndex((o) => o.id === order.id);

    if (idx >= 0) {
      this.store.orders.splice(idx, 1, order);
    } else {
      this.store.orders.push(order);
    }
  };

  dispose() {
    this.isDisposed = true;

    this.off('update');
    this.off('fill');
    this.off('error');

    this.store.latency = 0;
    this.store.markets = [];
    this.store.positions = [];
    this.store.orders = [];
    this.store.tickers = [];
    this.store.balance = { ...defaultStore.balance };
    this.store.loaded = { ...defaultStore.loaded };

    if (this.wsPrivate) {
      this.wsPrivate.off('close', this.onWSPrivateClose);
      this.wsPrivate.close();
      this.wsPrivate = undefined;
    }

    if (this.wsPublic) {
      this.wsPublic.off('close', this.onWSPublicClose);
      this.wsPublic.close();
      this.wsPublic = undefined;
    }
  }
}
