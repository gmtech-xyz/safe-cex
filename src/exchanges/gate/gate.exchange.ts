import type { Axios } from 'axios';
import axiosRateLimit from 'axios-rate-limit';
import chunk from 'lodash/chunk';
import flatten from 'lodash/flatten';
import partition from 'lodash/partition';
import times from 'lodash/times';
import uniq from 'lodash/uniq';
import { forEach, forEachSeries, map, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
import {
  OrderType,
  OrderTimeInForce,
  OrderSide,
  OrderStatus,
  PositionSide,
} from '../../types';
import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  OrderBook,
  PlaceOrderOpts,
  Position,
  Ticker,
  UpdateOrderOpts,
} from '../../types';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
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

    await this.tick();
    if (this.isDisposed) return;

    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    const algoOrders = await this.fetchAlgoOrders();
    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded ${orders.length} orders`);

    this.store.update({
      orders: [...algoOrders, ...orders],
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const balance = await this.fetchBalance();
        if (this.isDisposed) return;

        const positions = await this.fetchPositions();
        if (this.isDisposed) return;

        this.store.update({
          balance,
          positions,
          loaded: {
            ...this.store.loaded,
            balance: true,
            positions: true,
          },
        });
      } catch (err: any) {
        this.emitter.emit('error', err?.message);
      }

      loop(() => this.tick());
    }
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

    if (!this.store.loaded.balance) {
      this.store.setSetting('isHedged', data.in_dual_mode);
    }

    return balance;
  };

  fetchPositions = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.POSITIONS);
    return this.mapPositions(data);
  };

  mapPositions = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Position[], p) => {
      const market = this.store.markets.find((m) => m.id === p.contract);
      if (!market) return acc;

      const position: Position = {
        symbol: market.symbol,
        side: p.size > 0 ? PositionSide.Long : PositionSide.Short,
        entryPrice: parseFloat(p.entry_price),
        notional: parseFloat(p.value),
        leverage: parseFloat(p.leverage) || 1,
        unrealizedPnl: parseFloat(p.unrealised_pnl),
        contracts: multiply(
          Math.abs(parseFloat(p.size)),
          market.precision.amount
        ),
        liquidationPrice: parseFloat(p.liq_price),
      };

      return [...acc, position];
    }, []);
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

  fetchAlgoOrders = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.ALGO_ORDERS, {
      params: { status: 'open' },
    });

    return this.mapAlgoOrders(data);
  };

  mapAlgoOrders = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Order[], o: Record<string, any>) => {
      const market = this.store.markets.find(
        (m) => m.id === o.initial.contract
      );

      if (!market) return acc;

      const side = o.initial.auto_size.includes('long')
        ? OrderSide.Sell
        : OrderSide.Buy;

      let type: OrderType = OrderType.StopLoss;

      if (side === OrderSide.Sell) {
        if (o.trigger.rule === 1) type = OrderType.TakeProfit;
        if (o.trigger.rule === 2) type = OrderType.StopLoss;
      }

      if (side === OrderSide.Buy) {
        if (o.trigger.rule === 1) type = OrderType.StopLoss;
        if (o.trigger.rule === 2) type = OrderType.TakeProfit;
      }

      const order: Order = {
        id: `${o.id}`,
        status: OrderStatus.Open,
        symbol: market.symbol,
        type,
        side,
        price: parseFloat(o.trigger.price),
        amount: 0,
        remaining: 0,
        filled: 0,
        reduceOnly: true,
      };

      return [...acc, order];
    }, []);
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

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    return this.publicWebsocket.listenOrderBook(symbol, callback);
  };

  changePositionMode = async (hedged: boolean) => {
    if (this.store.positions.some((p) => p.contracts > 0)) {
      throw new Error('Close all positions before changing position mode');
    }

    try {
      await this.xhr.post(
        ENDPOINTS.DUAL_MODE,
        {},
        { params: { dual_mode: hedged } }
      );
      this.store.setSetting('isHedged', hedged);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.label || err?.message);
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    try {
      if (this.isAlgoOrder(opts)) {
        return await this.placeAlgoOrder(opts);
      }

      return await this.placeOrders([opts]);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.label || err?.message);
      return [];
    }
  };

  placeOrders = async (opts: PlaceOrderOpts[]) => {
    const orderIds: string[] = [];

    const [algoOrders, normalOrders] = partition(opts, (o) =>
      this.isAlgoOrder(o)
    );

    if (normalOrders.length) {
      try {
        const ids = await this.placeOrderBatch(
          flatten(normalOrders.map(this.formatCreateOrder))
        );

        if (ids?.length) {
          orderIds.push(...ids);
        }
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.label || err?.message);
      }
    }

    const derivedAlogOrders = this.deriveAlgoOrdersFromNormalOrdersOpts(opts);
    const allAlgoOrders = [...algoOrders, ...derivedAlogOrders];

    if (allAlgoOrders.length) {
      try {
        const ids = flatten(await map(allAlgoOrders, this.placeAlgoOrder));

        if (ids?.length) {
          orderIds.push(...ids);
        }
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.label || err?.message);
      }
    }

    return orderIds;
  };

  cancelOrders = async (orders: Order[]) => {
    const [algoOrders, normalOrders] = partition(orders, (o) =>
      this.isAlgoOrder(o)
    );

    await this.cancelAlgoOrders(algoOrders);
    await this.cancelNormalOrders(normalOrders);
  };

  cancelNormalOrders = async (orders: Order[]) => {
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

  cancelAlgoOrders = async (orders: Order[]) => {
    await forEach(orders, async (o) => {
      try {
        await this.xhr.delete(`${ENDPOINTS.ALGO_ORDERS}/${o.id}`);
      } catch (err: any) {
        if (err?.response?.data?.label === 'ORDER_NOT_FOUND') {
          this.store.removeOrder(o);
        }
      }
    });
  };

  cancelAllOrders = async () => {
    const symbols = uniq(this.store.orders.map((o) => o.symbol));
    await forEachSeries(symbols, this.cancelSymbolOrders);
    await this.xhr.delete(ENDPOINTS.ALGO_ORDERS);
  };

  cancelSymbolOrders = async (symbol: string) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);

    if (market) {
      await this.xhr.delete(ENDPOINTS.ORDERS, {
        params: { contract: market.id },
      });
    }
  };

  setAllLeverage = async (inputLeverage: number) => {
    await forEachSeries(this.store.markets, async (market) => {
      if (!this.isDisposed) {
        const position = this.store.positions.find(
          (p) => p.symbol === market.symbol
        );

        if (position?.leverage !== inputLeverage) {
          await this.setLeverage(market.symbol, inputLeverage);
        }
      }
    });
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);

    if (!market) {
      throw new Error(`Market ${symbol} not found`);
    }

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    try {
      await this.xhr.post(
        `${ENDPOINTS.POSITIONS}/${market.id}/leverage`,
        {},
        { params: { leverage } }
      );

      this.store.updatePositions([
        [{ symbol, side: PositionSide.Long }, { leverage }],
        [{ symbol, side: PositionSide.Short }, { leverage }],
      ]);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.label || err?.message);
    }
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    if (order.type !== OrderType.Limit) {
      return this.updateAlgoOrder({ order, update });
    }

    const market = this.store.markets.find((m) => m.symbol === order.symbol);
    if (!market) throw new Error(`Market ${order.symbol} not found`);

    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const payload: Record<string, any> = {};
    if ('price' in update) payload.price = `${adjust(update.price, pPrice)}`;
    if ('amount' in update) {
      const amount = adjust(divide(update.amount, pAmount), pAmount);
      payload.size = amount;
    }

    try {
      const { data } = await this.xhr.put(
        `${ENDPOINTS.ORDERS}/${order.id}`,
        payload
      );
      return [`${data.id}`];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.label || err?.message);
      return [];
    }
  };

  updateAlgoOrder = async ({ order, update }: UpdateOrderOpts) => {
    const newOrder = {
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      price: order.price,
      amount: order.amount,
      reduceOnly: order.reduceOnly || false,
    };

    if ('price' in update) newOrder.price = update.price;
    if ('amount' in update) newOrder.amount = update.amount;

    await this.cancelAlgoOrders([order]);
    return await this.placeAlgoOrder(newOrder);
  };

  private formatAlgoOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    if (!opts.price) {
      throw new Error('Price is required for algo orders');
    }

    if (opts.type === OrderType.TrailingStopLoss) {
      throw new Error('Trailing stop loss is not supported for Gate.io');
    }

    const pPrice = market.precision.price;
    const price = adjust(opts.price, pPrice);

    let rule: number = 0;

    if (opts.type === OrderType.StopLoss) {
      if (opts.side === OrderSide.Buy) rule = 1;
      if (opts.side === OrderSide.Sell) rule = 2;
    }

    if (opts.type === OrderType.TakeProfit) {
      if (opts.side === OrderSide.Buy) rule = 2;
      if (opts.side === OrderSide.Sell) rule = 1;
    }

    const req = omitUndefined({
      initial: {
        contract: market.id,
        size: 0,
        price: '0',
        tif: 'ioc',
        text: 'api',
        reduce_only: true,
        auto_size: opts.side === OrderSide.Buy ? 'close_short' : 'close_long',
      },
      trigger: {
        strategy_type: 0,
        price_type: 1,
        price: `${price}`,
        rule,
      },
    });

    return req;
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

    const defaultTimeInForce =
      opts.timeInForce || OrderTimeInForce.GoodTillCancel;

    const timeInForce =
      opts.type === OrderType.Market
        ? OrderTimeInForce.FillOrKill
        : defaultTimeInForce;

    const req = omitUndefined({
      contract: market.id,
      size: opts.side === OrderSide.Buy ? amount : -amount,
      price: opts.type === OrderType.Limit ? `${price}` : `0`,
      reduce_only: opts.reduceOnly ? true : undefined,
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
        this.emitter.emit('error', o.label);
        return acc;
      }, []);
    });

    return flatten(responses);
  };

  private placeAlgoOrder = async (opts: PlaceOrderOpts) => {
    const { data } = await this.xhr.post(
      ENDPOINTS.ALGO_ORDERS,
      this.formatAlgoOrder(opts)
    );

    return [`${data.id}`];
  };

  private isAlgoOrder = (opts: Pick<PlaceOrderOpts, 'type'>) => {
    return (
      opts.type === OrderType.StopLoss ||
      opts.type === OrderType.TakeProfit ||
      opts.type === OrderType.TrailingStopLoss
    );
  };
}
