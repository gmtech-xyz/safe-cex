import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import groupBy from 'lodash/groupBy';
import omit from 'lodash/omit';
import times from 'lodash/times';

import type { Store } from '../../store/store.interface';
import {
  OrderSide,
  type Balance,
  type Candle,
  type ExchangeOptions,
  type Market,
  type OHLCVOptions,
  type Order,
  type OrderBook,
  type PlaceOrderOpts,
  type Position,
  type Ticker,
  OrderType,
  OrderTimeInForce,
} from '../../types';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { adjust, multiply, subtract } from '../../utils/safe-math';
import { uuid } from '../../utils/uuid';
import { BaseExchange } from '../base';

import { createAPI } from './bitget.api';
import {
  ENDPOINTS,
  INTERVAL,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_SIDE,
  TIME_IN_FORCE,
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

  get apiMarginCoin() {
    return this.options.testnet ? 'SUSDT' : 'USDT';
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

    const usdt = data.find((b) => b.marginCoin === this.apiMarginCoin);
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
          marginCoin: this.apiMarginCoin,
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
      .filter((m) => m.quoteCoin === this.apiMarginCoin)
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
        marginCoin: this.apiMarginCoin,
      });
      this.store.update({ orders: [] });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  cancelOrders = async (orders: Order[]) => {
    const grouped = groupBy(orders, 'symbol');

    for (const [key, symbolOrders] of Object.entries(grouped)) {
      const symbol = `${key}_${this.apiProductType.toUpperCase()}`;
      const orderIds = symbolOrders.map((o) => o.id);

      try {
        await this.xhr.post(ENDPOINTS.CANCEL_ORDERS, {
          symbol,
          orderIds,
          marginCoin: this.apiMarginCoin,
        });
        this.store.removeOrders(symbolOrders);
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      await this.xhr.post(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
        symbol: `${symbol}_${this.apiProductType.toUpperCase()}`,
        marginCoin: this.apiMarginCoin,
      });
      this.store.removeOrders(
        this.store.orders.filter((o) => o.symbol === symbol)
      );
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const payloads = this.formatCreateOrder(opts);
    return await this.placeOrderBatch(payloads);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const requests = orders.flatMap((o) => this.formatCreateOrder(o));
    return await this.placeOrderBatch(requests);
  };

  formatCreateOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const side = this.getOrderSide(opts);

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;

    const pAmount = market.precision.amount;
    const amount = adjust(opts.amount, pAmount);

    const price =
      opts.price && opts.type !== OrderType.Market
        ? adjust(opts.price, pPrice)
        : undefined;

    const timeInForce = opts.timeInForce
      ? inverseObj(TIME_IN_FORCE)[opts.timeInForce]
      : inverseObj(TIME_IN_FORCE)[OrderTimeInForce.GoodTillCancel];

    const req = omitUndefined({
      symbol: market.id,
      size: amount ? `${amount}` : undefined,
      price: price ? `${price}` : undefined,
      side,
      orderType: inverseObj(ORDER_TYPE)[opts.type],
      timeInForce,
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);

    const payloads: Array<Record<string, any>> = times(lots, () => ({
      ...req,
      size: `${lotSize}`,
    }));

    if (rest) {
      payloads.push({ ...req, quantity: `${rest}` });
    }

    for (const payload of payloads) {
      payload.clientOid = uuid();
    }

    return payloads;
  };

  placeOrderBatch = async (payloads: Array<Record<string, any>>) => {
    const newOrderIds: string[] = [];
    const grouped = groupBy(payloads, 'symbol');

    for (const [symbol, orders] of Object.entries(grouped)) {
      try {
        const {
          data: { data },
        } = await this.xhr.post(ENDPOINTS.BATCH_ORDERS, {
          symbol,
          marginCoin: this.apiMarginCoin,
          orderDataList: orders.map((o) => omit(o, 'symbol')),
        });

        const oIds = data?.orderInfo?.map?.((obj: any) => obj.orderId);
        if (oIds) newOrderIds.push(...oIds);
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }

    return newOrderIds;
  };

  getOrderSide = (opts: PlaceOrderOpts) => {
    if (opts.reduceOnly) {
      if (opts.side === OrderSide.Buy) return 'close_short';
      if (opts.side === OrderSide.Sell) return 'close_long';
    }

    if (opts.side === OrderSide.Buy) return 'open_long';
    if (opts.side === OrderSide.Sell) return 'open_short';

    throw new Error(`Unknown order side: ${opts.side}`);
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
