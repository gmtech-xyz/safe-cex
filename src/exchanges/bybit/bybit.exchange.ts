/* eslint-disable complexity */
import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import { omit, orderBy, times, uniqBy } from 'lodash';
import { forEachSeries, mapSeries } from 'p-iteration';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  Position,
  Ticker,
  Order,
  PlaceOrderOpts,
  OHLCVOptions,
  UpdateOrderOpts,
} from '../../types';
import { OrderTimeInForce, OrderType, OrderSide } from '../../types';
import { adjust } from '../../utils/adjust';
import { v } from '../../utils/get-key';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { createWebSocket } from '../../utils/universal-ws';
import { BaseExchange } from '../base';

import { createAPI } from './bybit.api';
import {
  BASE_WS_URL,
  ENDPOINTS,
  INTERVAL,
  KLINES_LIMIT,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_SIDE,
} from './bybit.types';
import { BybitPrivateWebsocket } from './bybit.ws-private';
import { BybitPublicWebsocket } from './bybit.ws-public';

export class Bybit extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: BybitPublicWebsocket;
  privateWebsocket: BybitPrivateWebsocket;

  // we use this Map to indicate if a position is on hedge mode
  // so we can avoid counting positions on every `placeOrder()` call
  // we could have used a memoized function instead but the Map is built only once
  private hedgedPositionsMap: Record<string, boolean> = {};

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new BybitPublicWebsocket(this);
    this.privateWebsocket = new BybitPrivateWebsocket(this);
  }

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
  };

  validateAccount = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.BALANCE);

    if (data.retMsg !== 'OK') {
      this.emitter.emit('error', data.retMsg);

      if (data.retMsg.includes('timestamp and recv_window param')) {
        return 'Check your computer time and date';
      }

      return data.retMsg;
    }

    return '';
  };

  start = async () => {
    // load initial market data
    // then we can poll for live data
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.store.markets = markets;
    this.store.loaded.markets = true;

    // load initial tickers data
    // then we use websocket for live data
    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.log(
      `Loaded ${Math.min(tickers.length, markets.length)} Bybit markets`
    );

    this.store.tickers = tickers;
    this.store.loaded.tickers = true;

    // start websocket streams
    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    // start ticking live data
    // balance, tickers, positions
    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on Bybit`);

    // fetch unfilled orders
    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Bybit orders`);

    this.store.orders = orders;
    this.store.loaded.orders = true;
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const balance = await this.fetchBalance();
        if (this.isDisposed) return;

        const positions = await this.fetchPositions();
        if (this.isDisposed) return;

        this.store.balance = balance;
        this.store.positions = positions;

        this.store.loaded.balance = true;
        this.store.loaded.positions = true;
      } catch (err: any) {
        this.emitter.emit('error', err?.message);
      }

      loop(() => this.tick());
    }
  };

  fetchBalance = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.BALANCE, {
      params: { coin: 'USDT' },
    });

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.balance;
    }

    const [usdt] = data.result.list;
    const balance: Balance = {
      used: parseFloat(usdt.positionMargin) + parseFloat(usdt.orderMargin),
      free: parseFloat(usdt.availableBalance),
      total: parseFloat(usdt.walletBalance),
      upnl: parseFloat(usdt.unrealisedPnl),
    };

    return balance;
  };

  fetchOrders = async () => {
    const recursiveFetch = async (
      cursor: string = '',
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const { data } = await this.xhr.get(ENDPOINTS.UNFILLED_ORDERS, {
        params: { settleCoin: 'USDT', cursor },
      });

      const ordersList = Array.isArray(data?.result?.list)
        ? data.result.list
        : [];

      if (ordersList.length === 0) {
        return orders;
      }

      if (data.result.nextPageCursor) {
        return recursiveFetch(data.result.nextPageCursor, [
          ...orders,
          ...ordersList,
        ]);
      }

      return ordersList;
    };

    const bybitOrders = await recursiveFetch();
    const orders: Order[] = bybitOrders.flatMap(this.mapOrder);

    return orders;
  };

  fetchPositions = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.POSITIONS);

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.positions;
    }

    const positions: Position[] = data.result.map((p: any) =>
      this.mapPosition(p.data)
    );

    // reduce symbols into an object with symbol as key and boolean as value
    // value is true if symbol is present more than once
    // this means that we have a position on hedge mode
    if (!this.store.loaded.positions) {
      this.hedgedPositionsMap = positions
        .map((p) => p.symbol)
        .reduce<Record<string, boolean>>(
          (acc, symbol) => ({
            ...acc,
            [symbol]: typeof acc[symbol] !== 'undefined',
          }),
          {}
        );

      this.store.options.isHedged = Object.values(this.hedgedPositionsMap).some(
        (value) => value === true
      );
    }

    return positions;
  };

  fetchTickers = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.TICKERS, {
      params: { category: 'linear' },
    });

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.tickers;
    }

    const tickers: Ticker[] = data.result.list.reduce(
      (acc: Ticker[], t: Record<string, any>) => {
        const market = this.store.markets.find(
          ({ symbol }) => symbol === t.symbol
        );

        if (!market) return acc;
        if (!t.symbol.endsWith('USDT')) return acc;

        const ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: parseFloat(t.bidPrice),
          ask: parseFloat(t.askPrice),
          last: parseFloat(t.lastPrice),
          mark: parseFloat(t.markPrice),
          index: parseFloat(t.indexPrice),
          percentage: parseFloat(t.price24hPcnt) * 100,
          openInterest: parseFloat(t.openInterest),
          fundingRate: parseFloat(t.fundingRate),
          volume: parseFloat(t.volume24h),
          quoteVolume: parseFloat(t.volume24h) * parseFloat(t.lastPrice),
        };

        return [...acc, ticker];
      },
      []
    );

    return tickers;
  };

  fetchMarkets = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.MARKETS, {
      params: { category: 'linear', limit: 1000 },
    });

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.markets;
    }

    const markets: Market[] = data.result.list
      .filter((market: Record<string, any>) => market.quoteCoin === 'USDT')
      .map((market: Record<string, any>) => {
        return {
          id: `${market.baseCoin}/${market.quoteCoin}:${market.settleCoin}`,
          symbol: market.symbol,
          base: market.baseCoin,
          quote: market.quoteCoin,
          active: market.status === 'Trading',
          precision: {
            amount: parseFloat(market.lotSizeFilter.qtyStep),
            price: parseFloat(market.priceFilter.tickSize),
          },
          limits: {
            amount: {
              min: parseFloat(market.lotSizeFilter.minOrderQty),
              max: parseFloat(market.lotSizeFilter.maxOrderQty),
            },
            leverage: {
              min: parseFloat(market.leverageFilter.minLeverage),
              max: parseFloat(market.leverageFilter.maxLeverage),
            },
          },
        };
      });

    return markets;
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const interval = INTERVAL[opts.interval];
    const [, amount, unit] = opts.interval.split(/(\d+)/);

    // Default to 200
    let requiredCandles = opts.limit ?? KLINES_LIMIT;

    const startTime =
      opts.startTime ??
      dayjs()
        .subtract(parseFloat(amount) * requiredCandles, unit as ManipulateType)
        .unix();

    // Calculate the number of candles that are going to be fetched
    if (opts.endTime) {
      const diff = dayjs
        .unix(startTime)
        .diff(dayjs.unix(opts.endTime), unit as ManipulateType);

      requiredCandles = Math.abs(diff);
    }

    // Bybit v2 API only allows to fetch 200 candles at a time
    // so we need to split the request in multiple calls
    const totalPages = Math.ceil(requiredCandles / KLINES_LIMIT);
    const promises = [];
    let currentStartTime = startTime;

    for (let i = 0; i < totalPages; i++) {
      const currentLimit = Math.min(
        requiredCandles - i * KLINES_LIMIT,
        KLINES_LIMIT
      );
      const currentEndTime = dayjs
        .unix(currentStartTime)
        .add(currentLimit, unit as ManipulateType)
        .unix();

      promises.push(
        this.xhr.get(ENDPOINTS.KLINE, {
          params: {
            symbol: opts.symbol,
            from: currentStartTime,
            interval,
            limit: currentLimit,
          },
        })
      );
      currentStartTime = currentEndTime;
    }

    const results = await Promise.all(promises);
    const arr = results.flatMap(({ data: page }) => {
      const data = Array.isArray(page.result) ? page.result : [];
      return data.filter((c: any) => c);
    });

    // sort by timestamp and remove duplicated candles
    const data = orderBy(uniqBy(arr, 'open_time'), ['open_time'], ['asc']);

    const candles: Candle[] = data.map((c: Record<string, any>) => {
      return {
        timestamp: c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    });

    return candles;
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    // subscribe to the kline topic
    const topic = `candle.${INTERVAL[opts.interval]}.${opts.symbol}`;
    const subscribe = () => {
      if (!this.isDisposed) {
        const payload = { op: 'subscribe', args: [topic] };
        this.wsPublic?.send?.(JSON.stringify(payload));
        this.log(`Switched to [${opts.symbol}:${opts.interval}]`);
      }
    };

    // ping the server to keep the connection alive
    const ping = () => {
      if (!this.isDisposed) {
        const pong = () => {
          if (!this.isDisposed) {
            setTimeout(() => ping(), 10_000);
          }
        };

        this.wsPublic?.ping?.(pong);
      }
    };

    const handleMessage = ({ data }: MessageEvent) => {
      const json = JSON.parse(data);

      if (!this.isDisposed && json.topic === topic) {
        const [bybitCandle] = json.data;
        const candle: Candle = {
          timestamp: bybitCandle.start,
          open: bybitCandle.open,
          high: bybitCandle.high,
          low: bybitCandle.low,
          close: bybitCandle.close,
          volume: parseFloat(bybitCandle.volume),
        };

        callback(candle);
      }
    };

    const connect = () => {
      if (!this.isDisposed) {
        if (this.wsPublic) {
          this.wsPublic.off('close', this.onWSPublicClose);
          this.wsPublic.close();
        }

        this.wsPublic = createWebSocket(
          BASE_WS_URL.public[this.options.testnet ? 'testnet' : 'livenet']
        );

        this.wsPublic.on('open', () => {
          ping();
          subscribe();
        });

        this.wsPublic.on('message', handleMessage);
      }
    };

    // dispose function to be called
    // when we don't need this kline anymore
    const dispose = () => {
      if (this.wsPublic) {
        this.wsPublic.off('message', handleMessage);
        this.wsPublic.close();
        this.wsPublic = undefined;
      }
    };

    connect();

    return dispose;
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    if (
      opts.type === OrderType.StopLoss ||
      opts.type === OrderType.TakeProfit
    ) {
      return this.placeStopLossOrTakeProfit(opts);
    }

    if (opts.type === OrderType.TrailingStopLoss) {
      return this.placeTrailingStopLoss(opts);
    }

    const market = this.store.markets.find(
      ({ symbol }) => symbol === opts.symbol
    );

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const positionIdx = this.getOrderPositionIdx(opts);

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(opts.amount, pAmount);

    const price = opts.price ? adjust(opts.price, pPrice) : null;
    const stopLoss = opts.stopLoss ? adjust(opts.stopLoss, pPrice) : null;
    const takeProfit = opts.takeProfit ? adjust(opts.takeProfit, pPrice) : null;
    const timeInForce = opts.timeInForce || OrderTimeInForce.GoodTillCancel;

    const req = omitUndefined({
      symbol: opts.symbol,
      side: inverseObj(ORDER_SIDE)[opts.side],
      orderType: inverseObj(ORDER_TYPE)[opts.type],
      qty: `${amount}`,
      price: opts.type === OrderType.Limit ? `${price}` : undefined,
      stopLoss: opts.stopLoss ? `${stopLoss}` : undefined,
      takeProfit: opts.takeProfit ? `${takeProfit}` : undefined,
      reduceOnly: opts.reduceOnly || false,
      slTriggerBy: opts.stopLoss ? 'MarkPrice' : undefined,
      tpTriggerBy: opts.takeProfit ? 'MarkPrice' : undefined,
      timeInForce: opts.type === OrderType.Limit ? timeInForce : undefined,
      closeOnTrigger: false,
      positionIdx,
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);

    const payloads = times(lots, (idx) => {
      // We want to remove stopLoss and takeProfit from the rest of the orders
      // because they are already set on the first one
      const payload =
        idx > 0
          ? omit(req, ['stopLoss', 'takeProfit', 'slTriggerBy', 'tpTriggerBy'])
          : req;

      return { ...payload, qty: `${lotSize}` };
    });

    if (rest) payloads.push({ ...req, qty: `${rest}` });

    const responses = await mapSeries(payloads, async (p) => {
      const { data } = await this.unlimitedXHR.post(ENDPOINTS.CREATE_ORDER, p);
      return data;
    });

    responses.forEach((resp) => {
      if (v(resp, 'retMsg') !== 'OK') {
        this.emitter.emit('error', v(resp, 'retMsg'));
      }
    });

    return responses.map((resp) => resp.result.orderId);
  };

  placeStopLossOrTakeProfit = async (opts: PlaceOrderOpts) => {
    const payload: Record<string, any> = {
      symbol: opts.symbol,
      positionIdx: this.getStopOrderPositionIdx(opts),
    };

    if (opts.type === OrderType.StopLoss) {
      payload.stopLoss = `${opts.price}`;
      payload.slTriggerBy = 'MarkPrice';
    }

    if (opts.type === OrderType.TakeProfit) {
      payload.takeProfit = `${opts.price}`;
      payload.tpTriggerBy = 'LastPrice';
    }

    const { data } = await this.xhr.post(ENDPOINTS.SET_TRADING_STOP, payload);

    if (data.retMsg !== 'OK') {
      this.emitter.emit('error', data.retMsg);
    }

    return [data.result.orderId];
  };

  placeTrailingStopLoss = async (opts: PlaceOrderOpts) => {
    const ticker = this.store.tickers.find((t) => t.symbol === opts.symbol);
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!ticker || !market) {
      throw new Error(`Ticker ${opts.symbol} not found`);
    }

    const distance = adjust(
      Math.max(ticker.last, opts.price!) - Math.min(ticker.last, opts.price!),
      market.precision.price
    );

    const payload: Record<string, any> = {
      symbol: opts.symbol,
      positionIdx: this.getStopOrderPositionIdx(opts),
      trailingStop: `${distance}`,
    };

    const { data } = await this.xhr.post(ENDPOINTS.SET_TRADING_STOP, payload);

    if (data.retMsg !== 'OK') {
      this.emitter.emit('error', data.retMsg);
    }

    return [data.result.orderId];
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    const updatedOrderIds = [] as string[];

    // Special use-case when position is not open yet
    // and we want to update the stop loss or take profit
    // we need to do it on the original ask/bid order
    const isVirtualSLorTP =
      order.id.endsWith('__stop_loss') || order.id.endsWith('__take_profit');

    if ('price' in update && isVirtualSLorTP) {
      const og = this.store.orders.find(
        (o) =>
          o.id ===
          order.id.replace('__stop_loss', '').replace('__take_profit', '')
      );

      if (og) {
        const key = order.id.endsWith('__stop_loss')
          ? 'stopLoss'
          : 'takeProfit';

        const payload: Record<string, any> = {
          orderId: og.id,
          symbol: order.symbol,
          [key]: `${update.price}`,
        };

        const { data } = await this.xhr.post(ENDPOINTS.REPLACE_ORDER, payload);

        if (data.retMsg === 'OK') {
          updatedOrderIds.push(data.result.orderId);
        } else {
          this.emitter.emit('error', data.retMsg);
        }
      }
    }

    // If we want to update the price or amount of a limit order
    // we can do it directly on the order
    if (order.type === OrderType.Limit) {
      const payload: Record<string, any> = {
        orderId: order.id,
        symbol: order.symbol,
      };

      if ('amount' in update) payload.qty = `${update.amount}`;
      if ('price' in update) payload.price = `${update.price}`;

      const { data } = await this.xhr.post(ENDPOINTS.REPLACE_ORDER, payload);

      if (data.retMsg === 'OK') {
        updatedOrderIds.push(data.result.orderId);
      } else {
        this.emitter.emit('error', data.retMsg);
      }
    }

    // If we want to update the stop loss or take profit order
    // we need to do it on the opened position
    if (
      !isVirtualSLorTP &&
      (order.type === OrderType.StopLoss || order.type === OrderType.TakeProfit)
    ) {
      const payload: Record<string, any> = {
        symbol: order.symbol,
        positionIdx: order.side === OrderSide.Buy ? 2 : 1,
      };

      if ('price' in update) {
        if (order.type === OrderType.StopLoss) {
          payload.stopLoss = `${update.price}`;
        } else if (order.type === OrderType.TakeProfit) {
          payload.takeProfit = `${update.price}`;
        }
      }

      await this.xhr.post(ENDPOINTS.SET_TRADING_STOP, payload);
    }

    const storeOrder = this.store.orders.find(
      (o) => o.id === order.id && o.symbol === order.symbol
    );

    if (storeOrder) {
      if ('price' in update) storeOrder.price = update.price;
      if ('amount' in update) storeOrder.amount = update.amount;
    }

    return updatedOrderIds;
  };

  cancelOrders = async (orders: Order[]) => {
    await forEachSeries(orders, async (order) => {
      const { data } = await this.unlimitedXHR.post(ENDPOINTS.CANCEL_ORDER, {
        symbol: order.symbol,
        orderId: order.id,
      });

      if (data.retMsg === 'OK' || data.retMsg.includes('order not exists or')) {
        this.removeOrderFromStore(order.id);
      } else {
        this.emitter.emit('error', data.retMsg);
      }
    });
  };

  cancelSymbolOrders = async (symbol: string) => {
    const { data } = await this.unlimitedXHR.post(
      ENDPOINTS.CANCEL_SYMBOL_ORDERS,
      { symbol }
    );

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
    } else {
      const list = Array.isArray(data.result) ? data.result : [];
      this.store.orders = this.store.orders.filter(
        // we use `startsWith` because we generate SL and TP orders with
        // their original ID `[order_id]__stop_loss` and `[order_id]__take_profit`
        (order) => !list.some((id: string) => order.id.startsWith(id))
      );
    }
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    const position = this.store.positions.find((p) => p.symbol === symbol);

    if (!market) throw new Error(`Market ${symbol} not found`);
    if (!position) throw new Error(`Position for ${symbol} not found`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    if (position.leverage !== leverage) {
      await this.xhr.post(ENDPOINTS.SET_LEVERAGE, {
        symbol,
        buyLeverage: `${leverage}`,
        sellLeverage: `${leverage}`,
      });

      this.store.positions = this.store.positions.map((p) =>
        p.symbol === symbol ? { ...p, leverage } : p
      );
    }
  };

  changePositionMode = async (hedged: boolean) => {
    if (this.store.positions.filter((p) => p.contracts > 0).length > 0) {
      this.emitter.emit(
        'error',
        'Please close all positions before switching position mode'
      );
      return;
    }

    const { data } = await this.xhr.post(ENDPOINTS.SET_POSITION_MODE, {
      coin: 'USDT',
      mode: hedged ? 3 : 0,
    });

    if (data.retMsg === 'All symbols switched successfully.') {
      this.store.options.isHedged = hedged;
      if (!hedged) this.hedgedPositionsMap = {};
    } else {
      this.emitter.emit('error', data.retMsg);
    }
  };

  mapPosition(p: Record<string, any>) {
    const position: Position = {
      symbol: p.symbol,
      side: POSITION_SIDE[p.side],
      entryPrice: parseFloat(v(p, 'entryPrice') ?? 0),
      notional: parseFloat(v(p, 'positionValue') ?? 0),
      leverage: parseFloat(p.leverage),
      unrealizedPnl: parseFloat(v(p, 'unrealisedPnl') ?? 0),
      contracts: parseFloat(p.size ?? 0),
      liquidationPrice: parseFloat(v(p, 'liqPrice') ?? 0),
    };

    return position;
  }

  mapOrder(o: Record<string, any>) {
    const isStop = o.stopOrderType !== 'UNKNOWN';

    const oPrice = isStop ? v(o, 'triggerPrice') : o.price;
    const oType = isStop ? v(o, 'stopOrderType') : v(o, 'orderType');

    const orders: Order[] = [
      {
        id: o.orderId,
        status: ORDER_STATUS[v(o, 'orderStatus')],
        symbol: o.symbol,
        type: ORDER_TYPE[oType],
        side: ORDER_SIDE[o.side],
        price: parseFloat(oPrice),
        amount: parseFloat(o.qty ?? 0),
        filled: parseFloat(v(o, 'cumExecQty') ?? 0),
        reduceOnly: v(o, 'reduceOnly') || false,
        remaining: new BigNumber(o.qty ?? 0)
          .minus(v(o, 'cumExecQty') ?? 0)
          .toNumber(),
      },
    ];

    const sl = parseFloat(v(o, 'stopLoss'));
    const tp = parseFloat(v(o, 'takeProfit'));

    const inverseSide =
      orders[0].side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;

    if (sl > 0) {
      orders.push({
        ...orders[0],
        id: `${o.orderId}__stop_loss`,
        type: OrderType.StopLoss,
        side: inverseSide,
        price: sl,
        filled: 0,
        remaining: orders[0].amount,
      });
    }

    if (tp > 0) {
      orders.push({
        ...orders[0],
        id: `${o.orderId}__take_profit`,
        type: OrderType.TakeProfit,
        side: inverseSide,
        price: tp,
        filled: 0,
        remaining: orders[0].amount,
      });
    }

    return orders;
  }

  private getOrderPositionIdx = (opts: PlaceOrderOpts) => {
    // we can't use `this.store.options.isHedged` because
    // it can be enabled on some symbols but not on others
    const isHedged = this.hedgedPositionsMap[opts.symbol] || false;
    if (!isHedged) return 0;

    let positionIdx = opts.side === OrderSide.Buy ? 1 : 2;
    if (opts.reduceOnly) positionIdx = positionIdx === 1 ? 2 : 1;

    return positionIdx;
  };

  private getStopOrderPositionIdx = (opts: PlaceOrderOpts) => {
    const positionIdx = this.getOrderPositionIdx(opts);
    return { 0: 0, 1: 2, 2: 1 }[positionIdx];
  };
}
