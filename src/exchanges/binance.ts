import type { Axios } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import createHmac from 'create-hmac';
import { groupBy, omit } from 'lodash';
import { forEachSeries } from 'p-iteration';
import qs from 'qs';
import WebSocket from 'ws';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLVCOptions,
  Order,
  Position,
  Ticker,
} from '../types';
import { OrderSide, OrderStatus, OrderType, PositionSide } from '../types';
import { getUTCTimestamp } from '../utils/utc';

import { BaseExchange } from './base';

const RECV_WINDOW = 5000;
const BASE_URL = {
  livenet: 'https://fapi.binance.com',
  testnet: 'https://testnet.binancefuture.com',
};

const BASE_WS_URL = {
  public: {
    livenet: 'wss://fstream.binance.com/ws',
    testnet: 'wss://stream.binancefuture.com/ws',
  },
  private: {
    livenet: 'wss://fstream-auth.binance.com/ws',
    testnet: 'wss://stream.binancefuture.com/ws',
  },
};

const ENDPOINTS = {
  BALANCE: '/fapi/v2/balance',
  MARKETS: '/fapi/v1/exchangeInfo',
  ACCOUNT: '/fapi/v2/account',
  LEVERAGE_BRACKET: '/fapi/v1/leverageBracket',
  TICKERS_24H: '/fapi/v1/ticker/24hr',
  TICKERS_BOOK: '/fapi/v1/ticker/bookTicker',
  TICKERS_PRICE: '/fapi/v1/premiumIndex',
  POSITION_SIDE: '/fapi/v1/positionSide/dual',
  SET_LEVERAGE: '/fapi/v1/leverage',
  OPEN_ORDERS: '/fapi/v1/openOrders',
  CANCEL_SYMBOL_ORDERS: '/fapi/v1/allOpenOrders',
  BATCH_ORDERS: '/fapi/v1/batchOrders',
  KLINE: '/fapi/v1/klines',
  LISTEN_KEY: '/fapi/v1/listenKey',
};

const ORDER_TYPE: Record<string, OrderType> = {
  LIMIT: OrderType.Limit,
  MARKET: OrderType.Market,
  STOP_MARKET: OrderType.StopLoss,
  TAKE_PROFIT_MARKET: OrderType.TakeProfit,
};

const ORDER_SIDE: Record<string, OrderSide> = {
  BUY: OrderSide.Buy,
  SELL: OrderSide.Sell,
};

const POSITION_SIDE: Record<string, PositionSide> = {
  LONG: PositionSide.Long,
  SHORT: PositionSide.Short,
};

export class Binance extends BaseExchange {
  xhr: Axios;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(
      axios.create({
        baseURL: BASE_URL[opts.testnet ? 'testnet' : 'livenet'],
        timeout: RECV_WINDOW,
        paramsSerializer: {
          serialize: (params) =>
            qs.stringify(params, { arrayFormat: 'repeat' }),
        },
        headers: {
          'X-MBX-APIKEY': opts.key,
          'Content-Type': 'application/json, chartset=utf-8',
        },
      }),
      {
        maxRequests: 5,
        perMilliseconds: 1000,
      }
    );

    this.xhr.interceptors.request.use((config) => {
      const nextConfig = { ...config };
      const timestamp = getUTCTimestamp().valueOf();

      const data = config.data || config.params || {};
      data.timestamp = timestamp;
      data.recvWindow = RECV_WINDOW;

      const asString = qs.stringify(data, { arrayFormat: 'repeat' });
      const signature = createHmac('sha256', opts.secret)
        .update(asString)
        .digest('hex');

      data.signature = signature;
      nextConfig.params = data;

      // use cors-anywhere to bypass CORS
      // Binance doesn't allow CORS on their API
      if (nextConfig.method !== 'get' && this.options.corsAnywhere) {
        nextConfig.baseURL = `${this.options.corsAnywhere}/${config.baseURL}`;
      }

      // remove data from POST/PUT/DELETE requests
      // Binance API takes data as query params
      return omit(nextConfig, 'data');
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

  listenWS = async () => {
    if (!this.isDisposed) {
      const listenKey = await this.fetchListenKey();

      const key = this.options.testnet ? 'testnet' : 'livenet';
      const base = BASE_WS_URL.private[key];

      const url = this.options.testnet
        ? `${base}/${listenKey}`
        : `${base}/${listenKey}?listenKey=${listenKey}`;

      this.wsPrivate = new WebSocket(url);

      this.wsPrivate?.on('open', () => {
        if (!this.isDisposed) this.ping();
      });

      this.wsPrivate?.on?.('message', (data) => {
        if (!this.isDisposed) {
          const json = JSON.parse(data.toString());

          if (json.e === 'ACCOUNT_UPDATE') {
            this.handlePositionTopic(json.a.P);
          }

          if (json.e === 'ORDER_TRADE_UPDATE') {
            this.handleOrderTopic(json.o);
          }
        }
      });
    }
  };

  handleOrderTopic = (data: Record<string, any>) => {
    if (data.X === 'NEW') {
      this.store.orders.push({
        id: `${data.i}`,
        status: OrderStatus.Open,
        symbol: data.s,
        type: ORDER_TYPE[data.ot],
        side: ORDER_SIDE[data.ps],
        price: parseFloat(data.p) || parseFloat(data.sp),
        amount: parseFloat(data.q),
        filled: parseFloat(data.z),
        remaining: parseFloat(data.q) - parseFloat(data.z),
      });
    }

    if (data.X === 'PARTIALLY_FILLED') {
      const order = this.store.orders.find((o) => o.id === `${data.i}`);

      if (order) {
        order.filled = parseFloat(data.z);
        order.remaining = parseFloat(data.q) - parseFloat(data.z);
      }
    }

    if (data.X === 'CANCELED' || data.X === 'FILLED') {
      this.store.orders = this.store.orders.filter((o) => o.id !== `${data.i}`);
    }
  };

  handlePositionTopic = (data: Array<Record<string, any>>) => {
    data.forEach((p: any) => {
      const symbol = p.s;
      const side = POSITION_SIDE[p.ps];

      const position = this.store.positions.find(
        (p2) => p2.symbol === symbol && p2.side === side
      );

      if (position) {
        const entryPrice = parseFloat(p.ep);
        const contracts = parseFloat(p.pa);
        const upnl = parseFloat(p.up);

        position.entryPrice = entryPrice;
        position.contracts = contracts;
        position.notional = contracts * entryPrice + upnl;
        position.unrealizedPnl = upnl;
      }
    });
  };

  fetchListenKey = async () => {
    const {
      data: { listenKey },
    } = await this.xhr.post<{ listenKey: string }>(ENDPOINTS.LISTEN_KEY);

    // keep connection alive with a 30 minute interval
    setTimeout(() => this.updateListenKey(), 1000 * 60 * 30);

    return listenKey;
  };

  updateListenKey = async () => {
    if (!this.isDisposed) {
      await this.xhr.put(ENDPOINTS.LISTEN_KEY);
      setTimeout(() => this.updateListenKey(), 1000 * 60 * 30);
    }
  };

  fetchBalance = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.BALANCE
    );

    const usdt = data.find(({ asset }) => asset === 'USDT')!;
    const busd = data.find(({ asset }) => asset === 'BUSD')!;

    const balances = [usdt, busd].map((margin) => {
      const free = parseFloat(margin.availableBalance);
      const total = parseFloat(margin.balance);
      const upnl = parseFloat(margin.crossUnPnl);
      const used = total - free;
      return { free, total, used, upnl };
    });

    return balances.reduce(
      (acc: Balance, curr: Balance) => {
        return {
          free: acc.free + curr.free,
          total: acc.total + curr.total,
          used: acc.used + curr.used,
          upnl: acc.upnl + curr.upnl,
        };
      },
      { free: 0, total: 0, used: 0, upnl: 0 }
    );
  };

  fetchMarkets = async () => {
    const {
      data: { symbols },
    } = await this.xhr.get<{ symbols: Array<Record<string, any>> }>(
      ENDPOINTS.MARKETS
    );

    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.LEVERAGE_BRACKET
    );

    const markets: Market[] = symbols
      .filter(
        (m) =>
          m.contractType === 'PERPETUAL' &&
          (m.marginAsset === 'BUSD' || m.marginAsset === 'USDT')
      )
      .map((m) => {
        const p = m.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
        const amt = m.filters.find((f: any) => f.filterType === 'LOT_SIZE');

        const { brackets } = data.find((b) => b.symbol === m.symbol)!;

        return {
          id: `${m.baseAsset}/${m.quoteAsset}:${m.marginAsset}`,
          symbol: m.symbol,
          base: m.baseAsset,
          quote: m.quoteAsset,
          active: m.status === 'TRADING',
          precision: {
            amount: parseFloat(amt.stepSize),
            price: parseFloat(p.tickSize),
          },
          limits: {
            amount: {
              min: parseFloat(amt.minQty),
              max: parseFloat(amt.maxQty),
            },
            leverage: {
              min: 1,
              max: brackets[0].initialLeverage,
            },
          },
        };
      });

    return markets;
  };

  fetchTickers = async () => {
    const { data: dailys } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.TICKERS_24H
    );

    const { data: books } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.TICKERS_BOOK
    );

    const { data: prices } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.TICKERS_PRICE
    );

    const tickers: Ticker[] = books.reduce((acc: Ticker[], book) => {
      const market = this.store.markets.find((m) => m.symbol === book.symbol)!;
      const daily = dailys.find((d) => d.symbol === book.symbol)!;
      const price = prices.find((p) => p.symbol === book.symbol)!;

      if (!market || !daily || !price) return acc;

      const ticker = {
        id: market.id,
        symbol: market.symbol,
        bid: parseFloat(book.bidPrice),
        ask: parseFloat(book.askPrice),
        last: parseFloat(daily.lastPrice),
        mark: parseFloat(price.markPrice),
        index: parseFloat(price.indexPrice),
        percentage: parseFloat(daily.priceChangePercent),
        fundingRate: parseFloat(price.lastFundingRate),
        volume: parseFloat(daily.volume),
        quoteVolume: parseFloat(daily.quoteVolume),
        openInterest: 0, // Binance doesn't provides all tickers data
      };

      return [...acc, ticker];
    }, []);

    return tickers;
  };

  fetchPositions = async () => {
    const { data } = await this.xhr.get<{
      positions: Array<Record<string, any>>;
    }>(ENDPOINTS.ACCOUNT);

    const positions: Position[] = data.positions.map((p) => {
      const entryPrice = parseFloat(p.entryPrice);
      const contracts = parseFloat(p.positionAmt);
      const upnl = parseFloat(p.unrealizedProfit);

      return {
        symbol: p.symbol,
        side: POSITION_SIDE[p.positionSide],
        entryPrice,
        notional: contracts * entryPrice + upnl,
        leverage: parseFloat(p.leverage),
        unrealizedPnl: upnl,
        contracts,
        liquidationPrice: 0, // Binance doesn't provides on all positions data
      };
    });

    return positions;
  };

  fetchOrders = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.OPEN_ORDERS
    );

    const orders: Order[] = data.map((o) => {
      const order = {
        id: `${o.orderId}`,
        status: OrderStatus.Open,
        symbol: o.symbol,
        type: ORDER_TYPE[o.type],
        side: ORDER_SIDE[o.side],
        price: parseFloat(o.price) || parseFloat(o.stopPrice),
        amount: parseFloat(o.origQty),
        filled: parseFloat(o.executedQty),
        remaining: new BigNumber(o.origQty).minus(o.executedQty).toNumber(),
      };

      return order;
    });

    return orders;
  };

  fetchOHLCV = async (opts: OHLVCOptions) => {
    const { data } = await this.xhr.get<any[][]>(ENDPOINTS.KLINE, {
      params: {
        symbol: opts.symbol,
        interval: opts.interval,
        limit: 500,
      },
    });

    const candles: Candle[] = data.map(
      ([time, open, high, low, close, volume]) => {
        return {
          timestamp: time,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
        };
      }
    );

    return candles;
  };

  listenOHLCV = (opts: OHLVCOptions, callback: (candle: Candle) => void) => {
    if (!this.wsPublic) {
      this.wsPublic = new WebSocket(
        BASE_WS_URL.public[this.options.testnet ? 'testnet' : 'livenet']
      );
    }

    const topic = `${opts.symbol.toLowerCase()}@kline_${opts.interval}`;

    const subscribe = () => {
      if (!this.isDisposed) {
        const payload = { method: 'SUBSCRIBE', params: [topic], id: 1 };
        this.wsPublic?.send?.(JSON.stringify(payload));
      }
    };

    const handleMessage = (data: Buffer) => {
      const json = JSON.parse(data.toString());

      if (!this.isDisposed && json.s === opts.symbol && json.e === 'kline') {
        const candle: Candle = {
          timestamp: json.k.t,
          open: parseFloat(json.k.o),
          high: parseFloat(json.k.h),
          low: parseFloat(json.k.l),
          close: parseFloat(json.k.c),
          volume: parseFloat(json.k.v),
        };

        callback(candle);
      }
    };

    this.wsPublic?.on('message', handleMessage);
    this.wsPublic?.on('open', () => {
      subscribe();
    });

    const dispose = () => {
      if (this.wsPublic) {
        const payload = { method: 'UNSUBSCRIBE', params: [topic], id: 3 };
        this.wsPublic.send(JSON.stringify(payload));
        this.wsPublic.off('message', handleMessage);
      }
    };

    return dispose;
  };

  setHedgeMode = async () => {
    try {
      await this.xhr.post(ENDPOINTS.POSITION_SIDE, {
        dualSidePosition: 'true',
      });
    } catch {
      // do nothing, hedge mode is already set
    }
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol);
    const position = this.store.positions.find((p) => p.symbol === symbol);

    if (!market) throw new Error(`Market ${symbol} not found`);
    if (!position) throw new Error(`Position ${symbol} not found`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    if (position.leverage !== leverage) {
      await this.xhr.post(ENDPOINTS.SET_LEVERAGE, {
        symbol,
        leverage,
      });

      this.store.positions = this.store.positions.map((p) =>
        p.symbol === symbol ? { ...p, leverage } : p
      );
    }
  };

  cancelOrders = async (orders: Order[]) => {
    const groupedBySymbol = groupBy(orders, 'symbol');
    const requests = Object.entries(groupedBySymbol).map(
      ([symbol, symbolOrders]) => ({
        symbol,
        orderIdList: symbolOrders.map((o) => parseInt(o.id, 10)),
      })
    );

    await forEachSeries(requests, async (request) => {
      await this.xhr.delete(ENDPOINTS.BATCH_ORDERS, { params: request });
      this.store.orders = this.store.orders.filter(
        (o) => !request.orderIdList.includes(parseInt(o.id, 10))
      );
    });
  };

  cancelSymbolOrders = async (symbol: string) => {
    await this.xhr.delete(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
      params: { symbol },
    });

    this.store.orders = this.store.orders.filter((o) => o.symbol !== symbol);
  };
}
