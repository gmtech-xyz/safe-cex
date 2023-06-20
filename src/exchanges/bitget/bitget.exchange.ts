import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import groupBy from 'lodash/groupBy';
import omit from 'lodash/omit';
import partition from 'lodash/partition';
import times from 'lodash/times';

import type { Store } from '../../store/store.interface';
import {
  OrderSide,
  OrderType,
  OrderTimeInForce,
  PositionSide,
} from '../../types';
import type {
  Writable,
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

    // loop fetch leverage brackets
    this.fetchLeverageBrackets();

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
        parseFloat(usdt.available),
        parseFloat(usdt.crossMaxAvailable)
      ),
      free: parseFloat(usdt.crossMaxAvailable),
      total: parseFloat(usdt.available),
      upnl: parseFloat(usdt.unrealizedPL),
    };

    return balance;
  };

  fetchPositions = async () => {
    const {
      data: { data: rawPositions },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.POSITIONS,
      {
        params: {
          productType: this.apiProductType,
          marginCoin: this.apiMarginCoin,
        },
      }
    );

    const {
      data: { data: rawPositionsV2 },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.POSITIONS_V2,
      {
        params: {
          productType: this.apiProductType,
          marginCoin: this.apiMarginCoin,
        },
      }
    );

    const positions: Position[] = rawPositionsV2.map((p) => {
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

    const fakePositions: Position[] = this.store.markets.reduce(
      (acc: Position[], m) => {
        const hasPosition = positions.find((p) => p.symbol === m.symbol);
        if (hasPosition) return acc;

        const fakeMarketPositions: Position[] = [
          {
            symbol: m.symbol,
            side: PositionSide.Long,
            entryPrice: 0,
            notional: 0,
            leverage: 20,
            unrealizedPnl: 0,
            contracts: 0,
            liquidationPrice: 0,
          },
          {
            symbol: m.symbol,
            side: PositionSide.Short,
            entryPrice: 0,
            notional: 0,
            leverage: 20,
            unrealizedPnl: 0,
            contracts: 0,
            liquidationPrice: 0,
          },
        ];

        return [...acc, ...fakeMarketPositions];
      },
      []
    );

    const allPositions = [...positions, ...fakePositions].map((p) => {
      const p1 = rawPositions.find(
        (rp) =>
          rp.symbol === `${p.symbol}_${this.apiProductType.toUpperCase()}` &&
          p.side === POSITION_SIDE[rp.holdSide]
      );

      return p1 ? { ...p, leverage: p1.leverage } : p;
    });

    return allPositions;
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

  fetchLeverageBrackets = async () => {
    for (const market of this.store.markets) {
      if (!this.isDisposed) {
        try {
          const {
            data: { data },
          } = await this.xhr.get(ENDPOINTS.LEVERAGE, {
            params: { symbol: market.id },
          });
          this.store.updateMarket(market, {
            limits: {
              ...market.limits,
              leverage: {
                min: parseInt(data.minLeverage, 10),
                max: parseInt(data.maxLeverage, 10),
              },
            },
          });
        } catch (err: any) {
          this.emitter.emit('error', err?.response?.data?.msg || err?.message);
        }
      }
    }
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
    const normalOrders = await this.fetchNormalOrders();
    const algoOrders = await this.fetchAlgoOrders();

    return [...normalOrders, ...algoOrders];
  };

  fetchNormalOrders = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.ORDERS,
      { params: { productType: this.apiProductType } }
    );

    return data.map(this.mapOrder);
  };

  fetchAlgoOrders = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.ALGO_ORDERS,
      { params: { productType: this.apiProductType, isPlan: 'profit_loss' } }
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
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  cancelOrders = async (orders: Order[]) => {
    const [algoOrders, normalOrders] = partition<Order>(
      orders,
      this.isAlgoOrder
    );

    if (normalOrders.length) await this.cancelNormalOrders(normalOrders);
    if (algoOrders.length) await this.cancelAlgoOrders(algoOrders);
  };

  cancelNormalOrders = async (orders: Order[]) => {
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
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }
  };

  cancelAlgoOrders = async (orders: Order[]) => {
    for (const order of orders) {
      try {
        await this.xhr.post(ENDPOINTS.CANCEL_ALGO_ORDER, {
          orderId: order.id,
          symbol: `${order.symbol}_${this.apiProductType.toUpperCase()}`,
          marginCoin: this.apiMarginCoin,
          planType: this.getOrderPlanType(order),
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
        marginCoin: this.apiMarginCoin,
      });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    if (this.isAlgoOrder(opts)) {
      const payload = this.formatAlgoOrder(opts);
      return await this.placeAlgoOrders([payload]);
    }

    const payloads = this.formatCreateOrder(opts);
    return await this.placeOrderBatch(payloads);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const [algoOrders, normalOrders] = partition(orders, this.isAlgoOrder);

    const normalOrdersOpts = normalOrders
      .flatMap((o) => this.formatCreateOrder(o))
      .filter((o) => parseFloat(o.size) > 0);

    const derivedAlgoOrders = this.deriveAlgoOrdersFromNormalOrdersOpts(orders);
    const algoOrdersOpts = [...algoOrders, ...derivedAlgoOrders].map(
      this.formatAlgoOrder
    );

    const orderIds = [
      ...(await this.placeOrderBatch(normalOrdersOpts)),
      ...(await this.placeAlgoOrders(algoOrdersOpts)),
    ];

    return orderIds;
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

  formatAlgoOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const payload: Record<string, any> = {
      marginCoin: this.apiMarginCoin,
      symbol: market.id,
      clientOid: uuid(),
      planType: this.getOrderPlanType(opts),
    };

    if (opts.type === OrderType.TakeProfit && opts.price) {
      const price = adjust(opts.price, market.precision.price);
      payload.planType = 'pos_profit';
      payload.triggerPrice = `${price}`;
      payload.holdSide = this.getAlgoOrderSide(opts);
    }

    if (opts.type === OrderType.StopLoss && opts.price) {
      const price = adjust(opts.price, market.precision.price);
      payload.planType = 'pos_loss';
      payload.triggerPrice = `${price}`;
      payload.holdSide = this.getAlgoOrderSide(opts);
    }

    return payload;
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

        data?.failure?.forEach?.((obj: any) => {
          this.emitter.emit('error', obj.errorMsg);
        });
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }

    return newOrderIds;
  };

  placeAlgoOrders = async (payloads: Array<Record<string, any>>) => {
    const newOrderIds: string[] = [];

    for (const payload of payloads) {
      try {
        const {
          data: { data },
        } = await this.xhr.post(ENDPOINTS.PLACE_ALGO_ORDER, payload);

        if (data?.orderId) {
          newOrderIds.push(data.orderId);
        }
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }

    return newOrderIds;
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    if (this.isAlgoOrder(order)) {
      return this.updateAlgoOrder({ order, update });
    }

    const market = this.store.markets.find((m) => m.symbol === order.symbol);
    if (!market) throw new Error(`Market ${order.symbol} not found`);

    const payload: Record<string, any> = {
      newClientOid: uuid(),
      orderId: order.id,
      symbol: market.id,
      price: `${order.price}`,
      size: `${order.amount}`,
    };

    if ('price' in update) {
      const price = adjust(update.price, market.precision.price);
      payload.price = `${price}`;
    }

    if ('amount' in update) {
      const amount = adjust(update.amount, market.precision.amount);
      payload.size = `${amount}`;
    }

    try {
      const {
        data: { data },
      } = await this.xhr.post(ENDPOINTS.UPDATE_ORDER, payload);
      return data?.orderId ? [data.orderId] : [];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return [];
    }
  };

  updateAlgoOrder = async ({ order, update }: UpdateOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === order.symbol);
    if (!market) throw new Error(`Market ${order.symbol} not found`);

    const payload: Record<string, any> = {
      orderId: order.id,
      marginCoin: this.apiMarginCoin,
      symbol: market.id,
      planType: this.getOrderPlanType(order),
    };

    if ('price' in update) {
      const price = adjust(update.price, market.precision.price);
      payload.triggerPrice = `${price}`;
    }

    try {
      const {
        data: { data },
      } = await this.xhr.post(ENDPOINTS.UPDATE_ALGO_ORDER, payload);
      return data?.orderId ? [data.orderId] : [];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return [];
    }
  };

  mapOrder = (o: Record<string, any>) => {
    const order: Writable<Order> = {
      id: o.orderId || o.ordId || o.id,
      status: ORDER_STATUS[o.state || o.status],
      symbol: (o.symbol || o.instId).replace(
        `_${this.apiProductType.toUpperCase()}`,
        ''
      ),
      type: ORDER_TYPE[o.orderType || o.ordType],
      side: ORDER_SIDE[o.tradeSide || o.tS],
      price: o.price || parseFloat(o.px),
      amount: o.size || parseFloat(o.sz) || 0,
      filled: o.filledQty || parseFloat(o.accFillSz) || 0,
      reduceOnly: o.reduceOnly || o.low,
      remaining: subtract(
        o.size || parseFloat(o.sz) || 0,
        o.filledQty || parseFloat(o.accFillSz) || 0
      ),
    };

    if (o.planType) {
      order.type = ORDER_TYPE[o.planType];
      order.price = parseFloat(o.triggerPrice) || parseFloat(o.triggerPx);
      order.reduceOnly = true;
    }

    return order;
  };

  private getOrderSide = (opts: PlaceOrderOpts) => {
    if (opts.reduceOnly) {
      if (opts.side === OrderSide.Buy) return 'close_short';
      if (opts.side === OrderSide.Sell) return 'close_long';
    }

    if (opts.side === OrderSide.Buy) return 'open_long';
    if (opts.side === OrderSide.Sell) return 'open_short';

    throw new Error(`Unknown order side: ${opts.side}`);
  };

  private getAlgoOrderSide = (opts: PlaceOrderOpts) => {
    if (opts.type === OrderType.TakeProfit) {
      if (opts.side === OrderSide.Buy) return 'short';
      if (opts.side === OrderSide.Sell) return 'long';
    }

    if (opts.type === OrderType.StopLoss) {
      if (opts.side === OrderSide.Buy) return 'short';
      if (opts.side === OrderSide.Sell) return 'long';
    }

    throw new Error(`Unknown algo order side: ${opts.type} - ${opts.side}`);
  };

  private isAlgoOrder = (opts: PlaceOrderOpts) => {
    return (
      opts.type === OrderType.StopLoss ||
      opts.type === OrderType.TakeProfit ||
      opts.type === OrderType.TrailingStopLoss
    );
  };

  private getOrderPlanType = (opts: { type: OrderType }) => {
    if (opts.type === OrderType.StopLoss) return 'pos_loss';
    if (opts.type === OrderType.TakeProfit) return 'pos_profit';

    throw new Error(`Unknown order type: ${opts.type}`);
  };
}
