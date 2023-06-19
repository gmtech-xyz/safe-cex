import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import groupBy from 'lodash/groupBy';

import type { Store } from '../../store/store.interface';
import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  OrderBook,
  Position,
  Ticker,
} from '../../types';
import { loop } from '../../utils/loop';
import { multiply, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './bitget.api';
import {
  ENDPOINTS,
  INTERVAL,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_SIDE,
} from './bitget.types';
import { BitgetPrivateWebsocket } from './bitget.ws-private';
import { BitgetPublicWebsocket } from './bitget.ws-public';

export class BitgetExchange extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: BitgetPublicWebsocket;
  privateWebsocket: BitgetPrivateWebsocket;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new BitgetPublicWebsocket(this);
    this.privateWebsocket = new BitgetPrivateWebsocket(this);
  }

  get apiProductType() {
    return this.options.testnet ? 'sumcbl' : 'umcbl';
  }

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.BALANCE, {
        params: { productType: this.apiProductType },
      });
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return err?.response?.data?.msg || err?.message;
    }
  };

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
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

    this.log(
      `Loaded ${Math.min(tickers.length, markets.length)} Bitget markets`
    );

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    // start websocket streams
    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on Bitget`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Bitget orders`);

    this.store.update({
      orders,
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
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }

      loop(() => this.tick());
    }
  };

  fetchBalance = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.BALANCE,
      { params: { productType: this.apiProductType } }
    );

    const usdt = data.find((b) => b.marginCoin === 'USDT');
    if (!usdt) return this.store.balance;

    const balance: Balance = {
      used: subtract(
        parseFloat(usdt.equity),
        parseFloat(usdt.crossMaxAvailable)
      ),
      free: parseFloat(usdt.crossMaxAvailable),
      total: parseFloat(usdt.equity),
      upnl: parseFloat(usdt.unrealizedPL),
    };

    return balance;
  };

  fetchPositions = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.POSITIONS,
      {
        params: {
          productType: this.apiProductType,
          marginCoin: 'USDT',
        },
      }
    );

    const positions: Position[] = data.map((p) => {
      const contracts = parseFloat(p.total);
      const price = parseFloat(p.marketPrice);

      const position: Position = {
        symbol: p.symbol.replace(`_${this.apiProductType.toUpperCase()}`, ''),
        side: POSITION_SIDE[p.holdSide],
        entryPrice: parseFloat(p.averageOpenPrice),
        notional: multiply(contracts, price),
        leverage: p.leverage,
        unrealizedPnl: parseFloat(p.unrealizedPL),
        contracts,
        liquidationPrice: parseFloat(p.liquidationPrice),
      };

      return position;
    });

    return positions;
  };

  fetchMarkets = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.MARKETS,
      { params: { productType: this.apiProductType } }
    );

    const markets: Market[] = data
      .filter((m) => m.quoteCoin === 'USDT')
      .map((m) => {
        const priceDecimals = 10 / 10 ** (parseFloat(m.pricePlace) + 1);
        const pricePrecision = priceDecimals * parseFloat(m.priceEndStep);

        return {
          id: m.symbol,
          symbol: m.symbolName,
          base: m.baseCoin,
          quote: m.quoteCoin,
          active: m.symbolStatus === 'normal',
          precision: {
            amount: parseFloat(m.sizeMultiplier),
            price: pricePrecision,
          },
          limits: {
            amount: {
              min: parseFloat(m.minTradeNum),
              max: Infinity,
            },
            leverage: {
              min: 1,
              max: 20,
            },
          },
        };
      });

    return markets;
  };

  fetchTickers = async () => {
    const {
      data: { data },
    } = await this.xhr.get(ENDPOINTS.TICKERS, {
      params: { productType: this.apiProductType },
    });

    const tickers: Ticker[] = data.reduce(
      (acc: Ticker[], t: Record<string, any>) => {
        const market = this.store.markets.find((m) => m.id === t.symbol);

        if (!market) return acc;

        const last = parseFloat(t.last);

        const ticker: Ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: parseFloat(t.bestBid),
          ask: parseFloat(t.bestAsk),
          last,
          mark: last,
          index: parseFloat(t.indexPrice),
          percentage: parseFloat(t.chgUtc) * 100,
          fundingRate: parseFloat(t.fundingRate),
          openInterest: 0, // not provided by the API, will be fetched with WS
          volume: parseFloat(t.baseVolume),
          quoteVolume: parseFloat(t.quoteVolume),
        };

        return [...acc, ticker];
      },
      []
    );

    return tickers;
  };

  fetchOrders = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.ORDERS,
      { params: { productType: this.apiProductType } }
    );

    return data.map(this.mapOrder);
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const interval = INTERVAL[opts.interval];
    const [, amount, unit] = opts.interval.split(/(\d+)/);

    const from = dayjs()
      .subtract(parseFloat(amount) * 200, unit as ManipulateType)
      .valueOf();

    const { data } = await this.xhr.get(ENDPOINTS.KLINE, {
      params: {
        symbol: `${opts.symbol}_${this.apiProductType.toUpperCase()}`,
        granularity: interval,
        startTime: from,
        endTime: Date.now(),
        limit: 500,
      },
    });

    const candles: Candle[] = data.map((c: string[]) => {
      return {
        timestamp: parseInt(c[0], 10) / 1000,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[6]),
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

  cancelAllOrders = async () => {
    try {
      await this.xhr.post(ENDPOINTS.CANCEL_ALL_ORDERS, {
        productType: this.apiProductType,
        marginCoin: 'USDT',
      });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  cancelOrders = async (orders: Order[]) => {
    const grouped = groupBy(orders, 'symbol');

    for (const [key, value] of Object.entries(grouped)) {
      const symbol = `${key}_${this.apiProductType.toUpperCase()}`;
      const orderIds = value.map((o) => o.id);

      try {
        await this.xhr.post(ENDPOINTS.CANCEL_ORDERS, {
          symbol,
          orderIds,
          marginCoin: 'USDT',
        });
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      await this.xhr.post(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
        symbol: `${symbol}_${this.apiProductType.toUpperCase()}`,
        marginCoin: 'USDT',
      });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  mapOrder = (o: Record<string, any>) => {
    const order: Order = {
      id: o.orderId || o.ordId,
      status: ORDER_STATUS[o.state || o.status],
      symbol: (o.symbol || o.instId).replace(
        `_${this.apiProductType.toUpperCase()}`,
        ''
      ),
      type: ORDER_TYPE[o.orderType || o.ordType],
      side: ORDER_SIDE[o.tradeSide || o.tS],
      price: o.price || parseFloat(o.px),
      amount: o.size || parseFloat(o.sz),
      filled: o.filledQty || parseFloat(o.accFillSz),
      reduceOnly: o.reduceOnly || o.low,
      remaining: subtract(
        o.size || parseFloat(o.px),
        o.filledQty || parseFloat(o.accFillSz)
      ),
    };

    return order;
  };
}
