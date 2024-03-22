import uniq from 'lodash/uniq';
import { forEachSeries, mapSeries } from 'p-iteration';
import Emitter from 'tiny-emitter';

import type {
  DatafeedConfiguration,
  IBasicDataFeed,
} from '../charting_library';
import type { Store } from '../store/store.interface';
import type {
  Candle,
  ExchangeAccount,
  ExchangeOptions,
  OHLCVOptions,
  Order,
  OrderBook,
  PlaceOrderOpts,
  UpdateOrderOpts,
} from '../types';
import { LogSeverity, OrderSide, OrderType } from '../types';
import { createDatafeedAPI } from '../utils/datafeed-api';
import { sleep } from '../utils/sleep';

export interface Exchange {
  name: string;
  store: Store;
  emitter: Emitter.TinyEmitter;
  options: ExchangeOptions;
  isDisposed: boolean;
  on: Emitter.TinyEmitter['on'];
  once: Emitter.TinyEmitter['once'];
  off: Emitter.TinyEmitter['off'];
  dispose: () => void;
  getAccount: () => Promise<ExchangeAccount>;
  validateAccount: () => Promise<string>;
  start: () => Promise<void>;
  nuke: (tries?: number) => Promise<void>;
  changePositionMode: (hedged: boolean) => Promise<void>;
  setLeverage: (symbol: string, leverage: number) => Promise<void>;
  setAllLeverage: (leverage: number) => Promise<void>;
  placeOrder: (opts: PlaceOrderOpts) => Promise<string[]>;
  placeOrders: (orders: PlaceOrderOpts[]) => Promise<string[]>;
  updateOrder: (opts: UpdateOrderOpts) => Promise<string[]>;
  cancelOrders: (orders: Order[]) => Promise<void>;
  cancelSymbolOrders: (symbol: string) => Promise<void>;
  cancelAllOrders: () => Promise<void>;
  fetchOHLCV: (opts: OHLCVOptions) => Promise<Candle[]>;
  listenOHLCV: (o: OHLCVOptions, c: (c: Candle) => void) => () => void;
  listenOrderBook: (s: string, c: (o: OrderBook) => void) => () => void;
  getDatafeedAPI: (customConfig?: DatafeedConfiguration) => IBasicDataFeed;
}

export class BaseExchange implements Exchange {
  name: string;

  store: Store;
  options: ExchangeOptions;
  emitter: Emitter.TinyEmitter = new (Emitter as any)();

  isDisposed: boolean = false;
  isNuking: boolean = false;

  on: Emitter.TinyEmitter['on'];
  once: Emitter.TinyEmitter['once'];
  off: Emitter.TinyEmitter['off'];

  constructor(opts: ExchangeOptions, store: Store) {
    this.name = 'SAFE-CEX';

    this.options = opts;
    this.store = store;

    this.on = this.emitter.on.bind(this.emitter);
    this.once = this.emitter.once.bind(this.emitter);
    this.off = this.emitter.off.bind(this.emitter);

    this.store.subscribe((data) => {
      this.emitter.emit('update', data);
    });
  }

  onWSPublicClose = () => {};

  getAccount = async () => {
    await Promise.reject(new Error('Not implemented'));
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return {} as ExchangeAccount;
  };

  validateAccount = async () => {
    await Promise.reject(new Error('Not implemented'));
    return '';
  };

  log = (message: string, severity: LogSeverity = LogSeverity.Info) => {
    this.emitter.emit('log', message, severity);
  };

  start = async () => {
    await Promise.reject(new Error('Not implemented'));
  };

  setLeverage = async (_symbol: string, _leverage: number) => {
    await Promise.reject(new Error('Not implemented'));
  };

  changePositionMode = async (_hedged: boolean) => {
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
    return [] as string[];
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const orderIds = await mapSeries(orders, (order) => this.placeOrder(order));
    return orderIds.flat();
  };

  updateOrder = async (_opts: UpdateOrderOpts) => {
    await Promise.reject(new Error('Not implemented'));
    return [] as string[];
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

  listenOHLCV = (_opts: OHLCVOptions, _callback: (candle: Candle) => void) => {
    return () => {};
  };

  listenOrderBook = (
    _symbol: string,
    _callback: (orderBook: OrderBook) => void
  ) => {
    return () => {};
  };

  deriveAlgoOrdersFromNormalOrdersOpts = (opts: PlaceOrderOpts[]) => {
    return opts.reduce<PlaceOrderOpts[]>((acc, o) => {
      const newOrders: PlaceOrderOpts[] = [];

      if (o.stopLoss) {
        newOrders.push({
          symbol: o.symbol,
          side: o.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy,
          type: OrderType.StopLoss,
          price: o.stopLoss,
          amount: o.amount,
        });
      }

      if (o.takeProfit) {
        newOrders.push({
          symbol: o.symbol,
          side: o.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy,
          type: OrderType.TakeProfit,
          price: o.takeProfit,
          amount: o.amount,
        });
      }

      return [...acc, ...newOrders];
    }, []);
  };

  nuke = async (tries = 0) => {
    if (!this.isDisposed && !this.isNuking) {
      this.isNuking = true;

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
      this.isNuking = false;
    }

    const openPositions = this.store.positions.filter(
      (position) => position.contracts > 0
    );

    if (tries + 1 <= 3 && openPositions.length > 0) {
      await sleep(100);
      await this.nuke(tries + 1);
    }
  };

  getDatafeedAPI = (customConfig?: DatafeedConfiguration) => {
    return createDatafeedAPI(this, customConfig);
  };

  dispose() {
    this.isDisposed = true;

    this.off('update');
    this.off('fill');
    this.off('error');

    this.store.reset();
  }
}
