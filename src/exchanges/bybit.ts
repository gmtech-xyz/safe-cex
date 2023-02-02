import type { Axios } from 'axios';
import axios, { AxiosHeaders } from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import createHmac from 'create-hmac';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import { times } from 'lodash';
import { forEachSeries, mapSeries } from 'p-iteration';
import qs from 'qs';
import WebSocket from 'ws';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  Position,
  Ticker,
  Timeframe,
  Order,
  PlaceOrderOpts,
  OHLVCOptions,
} from '../types';
import { PositionSide, OrderType, OrderStatus, OrderSide } from '../types';
import { adjust } from '../utils/adjust';
import { inverseObj } from '../utils/inverse-obj';
import { omitUndefined } from '../utils/omit-undefined';
import { getUTCTimestamp } from '../utils/utc';

import { BaseExchange } from './base';

const RECV_WINDOW = 5000;
const BASE_URL = {
  livenet: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
};

const BASE_WS_URL = {
  public: {
    livenet: 'wss://stream-testnet.bybit.com/realtime_public',
    testnet: 'wss://stream-testnet.bybit.com/realtime_public',
  },
  private: {
    livenet: 'wss://stream.bybit.com/realtime_public',
    testnet: 'wss://stream-testnet.bybit.com/realtime_private',
  },
};

const ENDPOINTS = {
  // V3
  BALANCE: '/contract/v3/private/account/wallet/balance',
  UNFILLED_ORDERS: '/contract/v3/private/order/unfilled-orders',
  TICKERS: '/derivatives/v3/public/tickers',
  MARKETS: '/derivatives/v3/public/instruments-info',
  CREATE_ORDER: '/contract/v3/private/order/create',
  CANCEL_ORDER: '/contract/v3/private/order/cancel',
  SET_LEVERAGE: '/contract/v3/private/position/set-leverage',
  SET_POSITION_MODE: '/contract/v3/private/position/switch-mode',
  // V2
  POSITIONS: '/private/linear/position/list',
  KLINE: '/public/linear/kline',
  CANCEL_SYMBOL_ORDERS: '/private/linear/order/cancel-all',
};

const INTERVAL: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
};

const ORDER_STATUS: Record<string, OrderStatus> = {
  Created: OrderStatus.Open,
  New: OrderStatus.Open,
  Active: OrderStatus.Open,
  Untriggered: OrderStatus.Open,
  PartiallyFilled: OrderStatus.Open,
  Rejected: OrderStatus.Closed,
  Filled: OrderStatus.Closed,
  Deactivated: OrderStatus.Closed,
  Triggered: OrderStatus.Closed,
  PendingCancel: OrderStatus.Canceled,
  Cancelled: OrderStatus.Canceled,
};

const ORDER_TYPE: Record<string, OrderType> = {
  Limit: OrderType.Limit,
  Market: OrderType.Market,
  StopLoss: OrderType.StopLoss,
  TakeProfit: OrderType.TakeProfit,
};

const ORDER_SIDE: Record<string, OrderSide> = {
  Buy: OrderSide.Buy,
  Sell: OrderSide.Sell,
};

const POSITION_SIDE: Record<string, PositionSide> = {
  Buy: PositionSide.Long,
  Sell: PositionSide.Short,
};

export class Bybit extends BaseExchange {
  xhr: Axios;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(
      axios.create({
        baseURL: BASE_URL[opts.testnet ? 'testnet' : 'livenet'],
        timeout: RECV_WINDOW,
        paramsSerializer: {
          serialize: (params) => qs.stringify(params),
        },
        headers: {
          'X-BAPI-SIGN-TYPE': 2,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'Content-Type': 'application/json, charset=utf-8',
        },
      }),
      {
        maxRequests: 5,
        perMilliseconds: 1000,
      }
    );

    this.xhr.interceptors.request.use((config) => {
      const timestamp = getUTCTimestamp().valueOf();
      const data =
        config.method === 'get'
          ? qs.stringify(config.params)
          : JSON.stringify(config.data);

      const signature = createHmac('sha256', this.options.secret)
        .update([timestamp, this.options.key, RECV_WINDOW, data].join(''))
        .digest('hex');

      return {
        ...config,
        headers: new AxiosHeaders({
          ...config.headers,
          'X-BAPI-SIGN': signature,
          'X-BAPI-API-KEY': this.options.key,
          'X-BAPI-TIMESTAMP': timestamp,
        }),
      };
    });

    this.xhr.interceptors.response.use((response) => {
      if (response.data.retCode !== 0 && response.data.ret_code !== 0) {
        throw new Error(response.data.retMsg || response.data.ret_msg);
      }

      return response;
    });

    if (!this.isDisposed) {
      this.start();
    }
  }

  start = async () => {
    // load initial market data
    // then we can poll for live data
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.store.markets = markets;

    // set hedge mode before fetching positions
    await this.setHedgeMode();
    if (this.isDisposed) return;

    // listen to websocket
    this.listenWS();

    // start ticking live data
    // balance, tickers, positions
    await this.tick();
    if (this.isDisposed) return;

    // fetch unfilled orders
    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.store.orders = orders;
  };

  tick = async () => {
    if (!this.isDisposed) {
      const balance = await this.fetchBalance();
      if (this.isDisposed) return;

      const tickers = await this.fetchTickers();
      if (this.isDisposed) return;

      const positions = await this.fetchPositions();
      if (this.isDisposed) return;

      this.store.balance = balance;
      this.store.tickers = tickers;
      this.store.positions = positions;

      if (typeof window === 'undefined') {
        setTimeout(() => this.tick(), 0);
      } else {
        requestAnimationFrame(() => this.tick());
      }
    }
  };

  listenWS = () => {
    if (!this.isDisposed) {
      this.wsPrivate = new WebSocket(
        BASE_WS_URL.private[this.options.testnet ? 'testnet' : 'livenet']
      );

      const auth = () => {
        const expires = new Date().getTime() + 10_000;
        const signature = createHmac('sha256', this.options.secret)
          .update(`GET/realtime${expires}`)
          .digest('hex');

        const payload = {
          op: 'auth',
          args: [this.options.key, expires.toFixed(0), signature],
        };

        this.wsPrivate?.send?.(JSON.stringify(payload));
      };

      // subscribe to topics
      const subscribe = (topic: string) => {
        const payload = { op: 'subscribe', args: [topic] };
        this.wsPrivate?.send?.(JSON.stringify(payload));
      };

      this.wsPrivate?.on?.('open', () => {
        if (!this.isDisposed) {
          auth();
          this.ping();
          subscribe('order');
          subscribe('position');
        }
      });

      this.wsPrivate?.on?.('message', (data) => {
        if (!this.isDisposed) {
          const json = JSON.parse(data.toString());

          if (json.topic === 'order') {
            this.handleOrderTopic(json.data);
          }

          if (json.topic === 'position') {
            this.handlePositionTopic(json.data);
          }
        }
      });
    }
  };

  handleOrderTopic = (data: Array<Record<string, any>>) => {
    const toAdd: Order[] = [];
    const toReplace: Order[] = [];
    const toRemove: string[] = [];

    data.forEach((order: Record<string, any>) => {
      if (
        order.order_status === 'Cancelled' &&
        order.order_status === 'Filled'
      ) {
        toRemove.push(order.order_id);
      }

      if (order.order_status === 'New') {
        toAdd.push(this.mapOrder(order));
      }

      if (order.order_status === 'PartiallyFilled') {
        toReplace.push(this.mapOrder(order));
      }
    });

    this.store.orders = this.store.orders
      .filter((o) => !toRemove.includes(o.id))
      .concat(...toAdd)
      .map((o) => {
        const order = toReplace.find((o2) => o2.id === o.id);
        return order || o;
      });
  };

  handlePositionTopic = (data: Array<Record<string, any>>) => {
    const positions: Position[] = data.map(this.mapPosition);

    this.store.positions = this.store.positions.map((p) => {
      const pos = positions.find(
        (p2) => p2.symbol === p.symbol && p2.side === p.side
      );

      return pos || p;
    });
  };

  fetchBalance = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.BALANCE, {
      params: { coin: 'USDT' },
    });

    const [usdt] = data.result.list;
    const balance: Balance = {
      used: parseFloat(usdt.positionMargin) + parseFloat(usdt.orderMargin),
      free: parseFloat(usdt.availableBalance),
      total: parseFloat(usdt.walletBalance) + parseFloat(usdt.unrealisedPnl),
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

      if (data.result.list.length === 0) {
        return orders;
      }

      if (data.result.nextPageCursor) {
        return recursiveFetch(data.result.nextPageCursor, [
          ...orders,
          ...data.result.list,
        ]);
      }

      return data.result.list;
    };

    const bybitOrders = await recursiveFetch();
    const orders: Order[] = bybitOrders.map(this.mapOrder);

    return orders;
  };

  fetchPositions = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.POSITIONS);
    const positions: Position[] = data.result.map(this.mapPosition);

    return positions;
  };

  fetchTickers = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.TICKERS, {
      params: { category: 'linear' },
    });

    const tickers: Ticker[] = data.result.list.reduce(
      (acc: Ticker[], t: Record<string, any>) => {
        const market = this.store.markets.find(
          ({ symbol }) => symbol === t.symbol
        );

        if (!market) return acc;

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
          volume: parseFloat(t.volume24h) * parseFloat(t.lastPrice),
          quoteVolume: parseFloat(t.volume24h),
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

    const markets: Market[] = data.result.list.map(
      (market: Record<string, any>) => {
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
      }
    );

    return markets;
  };

  fetchOHLCV = async (opts: OHLVCOptions) => {
    const interval = INTERVAL[opts.interval];
    const [, amount, unit] = opts.interval.split(/(\d+)/);

    const from =
      opts.from ||
      dayjs()
        .subtract(parseFloat(amount) * 200, unit as ManipulateType)
        .unix();

    const { data } = await this.xhr.get(ENDPOINTS.KLINE, {
      params: {
        symbol: opts.symbol,
        from,
        interval,
        limit: 200,
      },
    });

    const candles: Candle[] = data.result.map((c: Record<string, any>) => {
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

  listenOHLCV = (opts: OHLVCOptions, callback: (candle: Candle) => void) => {
    if (!this.wsPublic) {
      // We reuse the same websocket client for the future
      // requests of another chart, we only unsubscribe the topic
      this.wsPublic = new WebSocket(
        BASE_WS_URL.public[this.options.testnet ? 'testnet' : 'livenet']
      );
    }

    // subscribe to the kline topic
    const topic = `candle.${INTERVAL[opts.interval]}.${opts.symbol}`;
    const subscribe = () => {
      if (!this.isDisposed) {
        const payload = { op: 'subscribe', args: [topic] };
        this.wsPublic?.send?.(JSON.stringify(payload));
      }
    };

    // ping the server to keep the connection alive
    const ping = () => {
      if (!this.isDisposed) {
        const handler = () => {
          if (!this.isDisposed) {
            setTimeout(() => ping(), 10_000);
          }
        };

        this.wsPublic?.ping?.();
        this.wsPublic?.once?.('pong', handler);
      }
    };

    const handleMessage = (data: Buffer) => {
      const json = JSON.parse(data.toString());

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

    this.wsPublic?.on?.('open', () => {
      ping();
      subscribe();
    });

    this.wsPublic?.on?.('message', handleMessage);

    // dispose function to be called
    // when we don't need this kline anymore
    const dispose = () => {
      if (this.wsPublic) {
        this.wsPublic.off('message', handleMessage);
        this.wsPublic.send(
          JSON.stringify({ op: 'unsubscribe', args: [topic] })
        );
      }
    };

    return dispose;
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find(
      ({ symbol }) => symbol === opts.symbol
    );

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    let positionIdx = opts.side === OrderSide.Buy ? 1 : 2;
    if (opts.reduceOnly) positionIdx = positionIdx === 1 ? 2 : 1;

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(opts.amount, pAmount);

    const price = opts.price ? adjust(opts.price, pPrice) : null;
    const stopLoss = opts.stopLoss ? adjust(opts.stopLoss, pPrice) : null;
    const takeProfit = opts.takeProfit ? adjust(opts.takeProfit, pPrice) : null;

    const payload = omitUndefined({
      symbol: opts.symbol,
      side: inverseObj(ORDER_SIDE)[opts.side],
      orderType: inverseObj(ORDER_TYPE)[opts.type],
      qty: amount,
      price: opts.type === OrderType.Limit ? price : undefined,
      stopLoss: opts.stopLoss ? stopLoss : undefined,
      takeProfit: opts.takeProfit ? takeProfit : undefined,
      reduceOnly: opts.reduceOnly,
      slTriggerBy: 'MarkPrice',
      tpTriggerBy: 'MarkPrice',
      closeOnTrigger: false,
      positionIdx,
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? amount % maxSize : 0;

    const payloads = times(lots, () => ({ ...payload, qty: maxSize }));
    if (rest) payloads.push({ ...payload, qty: rest });

    const responses = await mapSeries(payloads, async (p) => {
      const { data } = await this.xhr.post(ENDPOINTS.CREATE_ORDER, p);
      return data;
    });

    return responses;
  };

  cancelOrders = async (orders: Order[]) => {
    const toRemove: string[] = [];

    await forEachSeries(orders, async (order) => {
      const { data } = await this.xhr.post(ENDPOINTS.CANCEL_ORDER, {
        symbol: order.symbol,
        orderId: order.id,
      });

      if (data.retMsg === 'OK' || data.retMsg.includes('order not exists or')) {
        toRemove.push(order.id);
      }
    });

    // remove orders from the store
    // they should be already removed via websocket push
    // just to make sure we didn't miss an event
    this.store.orders = this.store.orders.filter(
      (order) => !toRemove.includes(order.id)
    );
  };

  cancelSymbolOrders = async (symbol: string) => {
    const { data } = await this.xhr.post(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
      symbol,
    });

    this.store.orders = this.store.orders.filter(
      (order) => !data.result.includes(order.id)
    );
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
        buyLeverage: leverage,
        sellLeverage: leverage,
      });

      this.store.positions = this.store.positions.map((p) =>
        p.symbol === symbol ? { ...p, leverage } : p
      );
    }
  };

  setHedgeMode = async () => {
    await this.xhr.post(ENDPOINTS.SET_POSITION_MODE, {
      symbol: 'USDT',
      mode: 3,
    });
  };

  private mapPosition(p: Record<string, any>) {
    const position: Position = {
      symbol: p.symbol,
      side: POSITION_SIDE[p.side],
      entryPrice: parseFloat(p.entry_price),
      notional: parseFloat(p.position_value),
      leverage: parseFloat(p.leverage),
      unrealizedPnl: parseFloat(p.unrealised_pnl),
      contracts: parseFloat(p.size),
      liquidationPrice: parseFloat(p.liq_price),
    };

    return position;
  }

  // we use v2 for websocket to return all the positions even if size is 0
  // so we need to support `snake_case` and `camelCase`
  private mapOrder(o: Record<string, any>) {
    const isStop = (o.stopOrderType || o.stop_order_type) !== 'UNKNOWN';

    const oPrice = isStop ? o.triggerPrice || o.trigger_price : o.price;
    const oType = isStop
      ? o.stopOrderType || o.stop_order_type
      : o.orderType || o.order_type;

    const order: Order = {
      id: o.orderId,
      status: ORDER_STATUS[o.orderStatus] || ORDER_STATUS[o.order_status],
      symbol: o.symbol,
      type: ORDER_TYPE[oType],
      side: ORDER_SIDE[o.side],
      price: parseFloat(oPrice),
      amount: parseFloat(o.qty),
      filled: parseFloat(o.cumQty || o.cum_qty),
      remaining: new BigNumber(o.qty).minus(o.cumQty || o.cum_qty).toNumber(),
    };

    return order;
  }
}
