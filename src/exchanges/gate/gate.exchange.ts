import type { Axios } from 'axios';
import axiosRateLimit from 'axios-rate-limit';
import { chunk, flatten, times, uniq } from 'lodash';
import { forEach, map, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
import {
  OrderType,
  OrderTimeInForce,
  OrderSide,
  OrderStatus,
} from '../../types';
import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  PlaceOrderOpts,
  Ticker,
} from '../../types';
import { inverseObj } from '../../utils/inverse-obj';
import { omitUndefined } from '../../utils/omit-undefined';
import { adjust, divide, multiply, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './gate.api';
import { ENDPOINTS, ORDER_TIME_IN_FORCE } from './gate.types';
import { GatePrivateWebsocket } from './gate.ws-private';
import { GatePublicWebsocket } from './gate.ws-public';

export class GateExchange extends BaseExchange {
  xhr: Axios;

  publicWebsocket: GatePublicWebsocket;
  privateWebsocket: GatePrivateWebsocket;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = axiosRateLimit(createAPI(opts), { maxRPS: 100 });
    this.publicWebsocket = new GatePublicWebsocket(this);
    this.privateWebsocket = new GatePrivateWebsocket(this);
  }

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
  };

  validateAccount = async () => {
    return await Promise.resolve('');
  };

  start = async () => {
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.store.update({
      markets,
      loaded: { ...this.store.loaded, markets: true },
    });

    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    this.log(`Loaded ${Math.min(tickers.length, markets.length)} markets`);

    const balance = await this.fetchBalance();
    if (this.isDisposed) return;

    this.store.update({
      balance,
      loaded: { ...this.store.loaded, balance: true },
    });

    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded ${orders.length} orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  fetchBalance = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.BALANCE);

    // we need this for fetching private channels
    this.privateWebsocket.userId = data.user;

    const total = parseFloat(data.total);
    const free = parseFloat(data.available);

    const balance: Balance = {
      used: subtract(total, free),
      free,
      total,
      upnl: parseFloat(data.unrealised_pnl),
    };

    return balance;
  };

  fetchMarkets = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.MARKETS
    );

    const markets: Market[] = data.map((m) => {
      const [base, quote] = m.name.split('_');

      return {
        id: m.name,
        symbol: `${base}${quote}`,
        base,
        quote,
        active: true,
        precision: {
          amount: parseFloat(m.quanto_multiplier),
          price: parseFloat(m.order_price_round),
        },
        limits: {
          amount: {
            min: parseFloat(m.quanto_multiplier),
            max: parseFloat(m.order_size_max),
          },
          leverage: {
            min: 1,
            max: parseFloat(m.leverage_max),
          },
        },
      };
    });

    return markets;
  };

  fetchTickers = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.TICKERS
    );

    return this.mapTickers(data);
  };

  mapTickers = (data: Array<Record<string, any>>) => {
    return data.reduce<Ticker[]>((acc, t) => {
      const market = this.store.markets.find((m) => m.id === t.contract);
      if (!market) return acc;

      const ticker = {
        id: market.id,
        symbol: market.symbol,
        bid: parseFloat(t.highest_bid),
        ask: parseFloat(t.lowest_ask),
        last: parseFloat(t.last),
        mark: parseFloat(t.mark_price),
        index: parseFloat(t.index_price),
        percentage: parseFloat(t.change_percentage),
        fundingRate: parseFloat(t.funding_rate),
        volume: parseFloat(t.volume_24h_base),
        quoteVolume: parseFloat(t.volume_24h_quote),
        openInterest: 0,
      };

      return [...acc, ticker];
    }, []);
  };

  fetchOrders = async () => {
    const rawOrders = flatten(
      await map(this.store.markets, async (market) => {
        if (this.isDisposed) return [];

        const { data } = await this.xhr.get(ENDPOINTS.ORDERS, {
          params: { status: 'open', contract: market.id },
        });

        return data;
      })
    );

    return this.mapOrders(rawOrders);
  };

  mapOrders = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Order[], o) => {
      const market = this.store.markets.find((m) => m.id === o.contract);
      if (!market) return acc;

      const size = parseFloat(o.size);
      const left = parseFloat(o.left);

      const amount = multiply(Math.abs(size), market.precision.amount);
      const remaining = multiply(Math.abs(left), market.precision.amount);
      const filled = subtract(amount, remaining);

      const order: Order = {
        id: `${o.id}`,
        status: OrderStatus.Open,
        symbol: market.symbol,
        type: OrderType.Limit,
        side: size > 0 ? OrderSide.Buy : OrderSide.Sell,
        price: parseFloat(o.price),
        amount,
        remaining,
        filled,
        reduceOnly: o.is_reduce_only,
      };

      return [...acc, order];
    }, []);
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      this.emitter.emit('error', `Market ${opts.symbol} not found`);
      return [];
    }

    const { data } = await this.xhr.get(ENDPOINTS.KLINE, {
      params: {
        contract: market.id,
        interval: opts.interval,
        limit: 500,
      },
    });

    const candles: Candle[] = data.map((c: Record<string, any>) => {
      return {
        timestamp: c.t,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      };
    });

    return candles;
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    return this.publicWebsocket.listenOHLCV(opts, callback);
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    return await this.placeOrders([opts]);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const orderIds = await this.placeOrderBatch(
      orders.flatMap((o) => this.formatCreateOrder(o))
    );

    return orderIds;
  };

  cancelOrders = async (orders: Array<Pick<Order, 'id'>>) => {
    await forEach(orders, async (o) => {
      try {
        await this.xhr.delete(`${ENDPOINTS.ORDERS}/${o.id}`);
      } catch (err: any) {
        if (err?.response?.data?.label === 'ORDER_NOT_FOUND') {
          this.store.removeOrder(o);
        }
      }
    });
  };

  cancelAllOrders = async () => {
    await this.xhr.delete(ENDPOINTS.CANCEL_ALL_ORDERS);
  };

  cancelSymbolOrders = async () => {
    const symbols = uniq(this.store.orders.map((o) => o.symbol));
    const markets = this.store.markets.filter((m) =>
      symbols.includes(m.symbol)
    );

    await forEach(markets, async (market) => {
      await this.xhr.delete(ENDPOINTS.ORDERS, {
        params: { contract: market.id },
      });
    });
  };

  private formatCreateOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(divide(opts.amount, pAmount), pAmount);
    const price = opts.price ? adjust(opts.price, pPrice) : null;

    const timeInForce = opts.timeInForce || OrderTimeInForce.GoodTillCancel;

    const req = omitUndefined({
      contract: market.id,
      size: opts.side === OrderSide.Buy ? amount : -amount,
      price: opts.type === OrderType.Limit ? `${price}` : undefined,
      reduce_only: opts.reduceOnly,
      tif: inverseObj(ORDER_TIME_IN_FORCE)[timeInForce],
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);
    const payloads: Array<Record<string, any>> = times(lots, () => {
      return { ...req, size: opts.side === OrderSide.Buy ? lotSize : -lotSize };
    });

    if (rest) {
      payloads.push({
        ...req,
        size: opts.side === OrderSide.Buy ? rest : -rest,
      });
    }

    return payloads;
  };

  private placeOrderBatch = async (payloads: Array<Record<string, any>>) => {
    const responses = await mapSeries(chunk(payloads, 20), async (batch) => {
      const { data } = await this.xhr.post<Array<Record<string, any>>>(
        ENDPOINTS.BATCH_ORDERS,
        batch
      );

      return data.reduce((acc: string[], o) => {
        if (o.id) return [...acc, `${o.id}`];
        this.emitter.emit('error', o.detail);
        return acc;
      }, []);
    });

    return flatten(responses);
  };
}
