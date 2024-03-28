import type { Axios } from 'axios';
import { partition } from 'lodash';
import chunk from 'lodash/chunk';
import flatten from 'lodash/flatten';
import sumBy from 'lodash/sumBy';
import times from 'lodash/times';
import { forEachSeries, map, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
import { OrderSide, OrderStatus, OrderType, PositionSide } from '../../types';
import type {
  Balance,
  Candle,
  ExchangeAccount,
  ExchangeOptions,
  OHLCVOptions,
  Order,
  OrderBook,
  PlaceOrderOpts,
  Position,
  Ticker,
  UpdateOrderOpts,
  Writable,
} from '../../types';
import { inverseObj } from '../../utils/inverse-obj';
import { omitUndefined } from '../../utils/omit-undefined';
import { roundUSD } from '../../utils/round-usd';
import { add, adjust, divide, multiply, subtract } from '../../utils/safe-math';
import { uuid } from '../../utils/uuid';
import { BaseExchange } from '../base';

import { createAPI } from './okx.api';
import {
  BROKER_ID,
  ENDPOINTS,
  INTERVAL,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  POSITION_SIDE,
  REVERSE_ORDER_TYPE,
} from './okx.types';
import { OKXBusinessWebsocket } from './okx.ws-business';
import { OKXPrivateWebsocket } from './okx.ws-private';
import { OKXPublicWebsocket } from './okx.ws-public';

export class OKXExchange extends BaseExchange {
  name = 'OKX';

  xhr: Axios;

  publicWebsocket: OKXPublicWebsocket;
  businessWebsocket: OKXBusinessWebsocket;
  privateWebsocket: OKXPrivateWebsocket;

  leverageHash: Record<string, number> = {};
  isPortfolioMargin: boolean = false;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = createAPI(opts);
    this.publicWebsocket = new OKXPublicWebsocket(this);
    this.businessWebsocket = new OKXBusinessWebsocket(this);
    this.privateWebsocket = new OKXPrivateWebsocket(this);
  }

  getAccount = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.ACCOUNT);
    const user = data?.data?.[0];

    const account: Writable<ExchangeAccount> = { userId: user?.mainUid };
    if (user?.mainUid !== user?.uid) account.subId = user?.uid;

    return account;
  };

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.BALANCE);
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return err?.response?.data?.msg || err?.message;
    }
  };

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.businessWebsocket.dispose();
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

    this.log(`Loaded ${Math.min(tickers.length, markets.length)} OKX markets`);

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    // we set the account level to multi-currency margin
    // the portfolio margin mode is bugged with TP/SL orders
    // and with leverage settings
    await this.setAccountLevel();

    // we need to fetch leverage before positions
    // this means before ws connect and before balance/positions fetch
    await this.fetchLeverage();

    // Start websocket
    this.publicWebsocket.connectAndSubscribe();
    this.businessWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    // fetch current position mode (Hedge/One-way)
    this.store.setSetting('isHedged', await this.fetchPositionMode());

    const { balance, positions } = await this.fetchBalanceAndPositions();
    if (this.isDisposed) return;

    this.store.update({
      balance,
      positions,
      loaded: { ...this.store.loaded, balance: true, positions: true },
    });

    this.log(`Ready to trade on OKX`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded ${orders.length} OKX orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.MARKETS,
        { params: { instType: 'SWAP' } }
      );

      const markets = data
        .filter((m) => m.ctType === 'linear')
        .map((m) => {
          const maxAmount = Math.min(
            parseFloat(m.maxIcebergSz),
            parseFloat(m.maxLmtSz),
            parseFloat(m.maxMktSz),
            parseFloat(m.maxStopSz),
            parseFloat(m.maxTriggerSz),
            parseFloat(m.maxTwapSz)
          );

          return {
            id: m.instId,
            symbol: m.instId.replace(/-SWAP$/, '').replace(/-/g, ''),
            base: m.ctValCcy,
            quote: m.settleCcy,
            active: m.state === 'live',
            precision: {
              amount: parseFloat(m.ctVal),
              price: parseFloat(m.tickSz),
            },
            limits: {
              amount: {
                min: parseFloat(m.minSz) * parseFloat(m.ctVal),
                max: maxAmount,
              },
              leverage: {
                min: 1,
                max: parseFloat(m.lever),
              },
            },
          };
        });

      return markets;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.markets;
    }
  };

  fetchTickers = async () => {
    try {
      const {
        data: { data },
      } = await this.xhr.get(ENDPOINTS.TICKERS, {
        params: {
          instType: 'SWAP',
        },
      });

      const tickers: Ticker[] = data.reduce(
        (acc: Ticker[], t: Record<string, any>) => {
          const market = this.store.markets.find((m) => m.id === t.instId);

          if (!market) return acc;

          const open = parseFloat(t.open24h);
          const last = parseFloat(t.last);
          const percentage = roundUSD(((last - open) / open) * 100);

          const ticker = {
            id: market.id,
            symbol: market.symbol,
            bid: parseFloat(t.bidPx),
            ask: parseFloat(t.askPx),
            last,
            mark: last,
            index: last,
            percentage,
            fundingRate: 0,
            volume: parseFloat(t.volCcy24h),
            quoteVolume: parseFloat(t.vol24h),
            openInterest: 0,
          };

          return [...acc, ticker];
        },
        []
      );

      return tickers;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.tickers;
    }
  };

  fetchBalanceAndPositions = async () => {
    try {
      const {
        data: {
          data: [{ balData: bal }],
        },
      } = await this.xhr.get<{
        data: Array<Record<string, Array<Record<string, any>>>>;
      }>(ENDPOINTS.BALANCE, { params: { instType: 'SWAP' } });

      const {
        data: { data: pData },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.POSITIONS,
        { params: { instType: 'SWAP' } }
      );

      const totalCollateral = roundUSD(sumBy(bal, (b) => parseFloat(b.disEq)));
      const used = roundUSD(sumBy(pData, (p) => parseFloat(p.mmr)));
      const upnl = roundUSD(sumBy(pData, (p) => parseFloat(p.upl)));

      const balance: Balance = {
        used,
        free: subtract(totalCollateral, used),
        total: subtract(totalCollateral, upnl),
        upnl,
      };

      const positions: Position[] = this.mapPositions(pData);

      // We create fake positions for the leverage setting
      // since the API doesn't return it for positions with 0 contracts
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
              leverage: this.leverageHash[m.id] || 0,
              unrealizedPnl: 0,
              contracts: 0,
              liquidationPrice: 0,
            },
            {
              symbol: m.symbol,
              side: PositionSide.Short,
              entryPrice: 0,
              notional: 0,
              leverage: this.leverageHash[m.id] || 0,
              unrealizedPnl: 0,
              contracts: 0,
              liquidationPrice: 0,
            },
          ];

          return [...acc, ...fakeMarketPositions];
        },
        []
      );

      return {
        balance,
        positions: [...positions, ...fakePositions],
      };
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return {
        balance: this.store.balance,
        positions: this.store.positions,
      };
    }
  };

  fetchPositions = async () => {
    const { positions } = await this.fetchBalanceAndPositions();
    return positions;
  };

  fetchBalance = async () => {
    const { balance } = await this.fetchBalanceAndPositions();
    return balance;
  };

  fetchLeverage = async () => {
    const responses = flatten(
      await map(chunk(this.store.markets, 20), async (batch) => {
        if (this.isDisposed) return [];

        const {
          data: { data },
        } = await this.xhr.get(ENDPOINTS.LEVERAGE, {
          params: {
            instId: batch.map((m) => m.id).join(','),
            mgnMode: 'cross',
          },
        });

        return data;
      })
    );

    if (!this.isDisposed) {
      responses.forEach((r: Record<string, any>) => {
        this.leverageHash[r.instId] = parseFloat(r.lever);
      });
    }
  };

  fetchOrders = async () => {
    const orders = await this.fetchNormalOrders();
    const ocoOrders = await this.fetchAlgoOrders('oco');
    const conditionalOrders = await this.fetchAlgoOrders('conditional');
    const trailingOrders = await this.fetchAlgoOrders('move_order_stop');
    return [...orders, ...ocoOrders, ...trailingOrders, ...conditionalOrders];
  };

  fetchNormalOrders = async () => {
    const recursiveFetch = async (
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.UNFILLED_ORDERS,
        {
          params: {
            instType: 'SWAP',
            after: orders.length ? orders[orders.length - 1].ordId : undefined,
          },
        }
      );

      if (data.length === 100) {
        return recursiveFetch([...orders, ...data]);
      }

      return [...orders, ...data];
    };

    const okxOrders = await recursiveFetch();
    const orders = this.mapOrders(okxOrders);

    return orders;
  };

  fetchAlgoOrders = async (type: 'conditional' | 'move_order_stop' | 'oco') => {
    const recursiveFetch = async (
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.UNFILLED_ALGO_ORDERS,
        {
          params: {
            instType: 'SWAP',
            ordType: type,
            after: orders.length ? orders[orders.length - 1].algoId : undefined,
          },
        }
      );

      if (data.length === 100) {
        return recursiveFetch([...orders, ...data]);
      }

      return [...orders, ...data];
    };

    const okxOrders = await recursiveFetch();
    const orders = this.mapOrders(okxOrders);

    return orders;
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      this.emitter.emit('error', `Market ${opts.symbol} not found on OKX`);
      return [];
    }

    try {
      const {
        data: { data },
      } = await this.xhr.get(ENDPOINTS.KLINE, {
        params: omitUndefined({
          instId: market.id,
          bar: INTERVAL[opts.interval],
          limit: opts.limit ? Math.min(opts.limit, 300) : 300,
          after: opts.to,
          before: opts.from,
        }),
      });

      const candles: Candle[] = data.map((c: string[]) => {
        return {
          timestamp: parseInt(c[0], 10) / 1000,
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[7]),
        };
      });

      candles.sort((a, b) => a.timestamp - b.timestamp);

      return candles;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return [];
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    return this.businessWebsocket.listenOHLCV(opts, callback);
  };

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    return this.publicWebsocket.listenOrderBook(symbol, callback);
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    if (order.type !== OrderType.Limit) {
      return this.updateAlgoOrder({ order, update });
    }

    const market = this.store.markets.find((m) => m.symbol === order.symbol);
    if (!market) throw new Error(`Market ${order.symbol} not found on OKX`);

    const payload: Record<string, any> = { instId: market.id, ordId: order.id };

    if ('price' in update) {
      payload.newPx = `${update.price}`;
    }

    if ('amount' in update) {
      const pFactor = market.precision.amount;
      const pAmount = divide(pFactor, pFactor);
      const amount = adjust(divide(update.amount, pFactor), pAmount);

      if (amount === 0) {
        this.emitter.emit('error', 'Order amount is too small');
        return [];
      }

      payload.newSz = `${amount}`;
    }

    try {
      await this.xhr.post(ENDPOINTS.UPDATE_ORDER, payload);
      return [order.id];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return [];
    }
  };

  updateAlgoOrder = async ({ order, update }: UpdateOrderOpts) => {
    const orders = this.store.orders.filter((o) =>
      o.id.startsWith(order.id.replace(/_[a-zA-Z]+$/, ''))
    );

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

    if (
      newOrder.amount === 0 &&
      (newOrder.type === OrderType.StopLoss ||
        newOrder.type === OrderType.TakeProfit)
    ) {
      const position = this.store.positions.find(
        (p) =>
          p.symbol === order.symbol &&
          p.side ===
            (order.side === OrderSide.Buy
              ? PositionSide.Short
              : PositionSide.Long)
      );

      newOrder.amount = position ? position.contracts : 0;
    }

    await this.cancelAlgoOrders(orders);
    return await this.placeOrder(newOrder);
  };

  cancelOrders = async (orders: Order[]) => {
    const [algoOrders, normalOrders] = partition(orders, (o) =>
      this.isAlgoOrder(o.type)
    );

    if (normalOrders.length) await this.cancelNormalOrders(normalOrders);
    if (algoOrders.length) await this.cancelAlgoOrders(algoOrders);
  };

  cancelSymbolOrders = async (symbol: string) => {
    const orders = this.store.orders.filter((o) => o.symbol === symbol);
    await this.cancelOrders(orders);
  };

  setAccountLevel = async () => {
    try {
      await this.xhr.post(ENDPOINTS.ACCOUNT_LEVEL, { acctLv: '3' });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    const position = this.store.positions.find((p) => p.symbol === symbol);

    if (!market) throw new Error(`Market ${symbol} not found on OKX`);
    if (!position) throw new Error(`Position ${symbol} not found on OKX`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    if (position.leverage !== leverage) {
      await this.xhr.post(ENDPOINTS.SET_LEVERAGE, {
        instId: market.id,
        lever: `${leverage}`,
        mgnMode: 'cross',
      });

      this.leverageHash[market.id] = leverage;
      this.store.updatePositions([
        [{ symbol, side: PositionSide.Long }, { leverage }],
        [{ symbol, side: PositionSide.Short }, { leverage }],
      ]);
    }
  };

  fetchPositionMode = async () => {
    const {
      data: {
        data: [{ posMode, acctLv }],
      },
    } = await this.xhr.get(ENDPOINTS.ACCOUNT_CONFIG);

    // set portifolio margin flag
    // this is used for algo orders
    this.isPortfolioMargin = acctLv === '4';

    return posMode === 'long_short_mode';
  };

  changePositionMode = async (hedged: boolean) => {
    if (this.store.positions.filter((p) => p.contracts > 0).length > 0) {
      this.emitter.emit(
        'error',
        'Please close all positions before switching position mode'
      );
      return;
    }

    try {
      const { data } = await this.xhr.post(ENDPOINTS.SET_POSITION_MODE, {
        posMode: hedged ? 'long_short_mode' : 'net_mode',
      });
      if (data.msg === '') {
        this.store.setSetting('isHedged', hedged);
      } else {
        this.emitter.emit('error', data.msg);
      }
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    if (this.isAlgoOrder(opts.type)) {
      const payload = this.formatAlgoOrder(opts);
      return await this.placeAlgoOrderBatch([payload]);
    }

    const payloads = this.formatCreateOrder(opts);

    if (payloads.some((o) => parseFloat(o.sz) === 0)) {
      this.emitter.emit('error', `Order amount is too small`);
      return [];
    }

    return await this.placeOrderBatch(payloads);
  };

  placeOrders = async (opts: PlaceOrderOpts[]) => {
    const [algoOrders, normalOrders] = partition(opts, (o) =>
      this.isAlgoOrder(o.type)
    );

    const normalOrdersOpts = normalOrders.flatMap((o) =>
      this.formatCreateOrder(o)
    );

    if (normalOrdersOpts.some((o) => parseFloat(o.sz) === 0)) {
      this.emitter.emit('error', `Total order amount is too small`);
      return [];
    }

    const derivedAlogOrders = this.deriveAlgoOrdersFromNormalOrdersOpts(opts);
    const algoOrdersOpts = [...algoOrders, ...derivedAlogOrders].map(
      this.formatAlgoOrder
    );

    const orderIds = [
      ...(await this.placeOrderBatch(normalOrdersOpts)),
      ...(await this.placeAlgoOrderBatch(algoOrdersOpts)),
    ];

    return orderIds;
  };

  mapOrders = (orders: Array<Record<string, any>>) => {
    return orders.reduce<Order[]>((acc, o: Record<string, any>) => {
      const market = this.store.markets.find((m) => m.id === o.instId);
      if (!market) return acc;

      if (o.ordType === 'oco' || o.ordType === 'conditional') {
        const newOrders: Order[] = [];

        if (parseFloat(o.slTriggerPx)) {
          newOrders.push({
            id: `${o.algoId}_sl`,
            status: OrderStatus.Open,
            symbol: market.symbol,
            type: OrderType.StopLoss,
            side: ORDER_SIDE[o.side],
            price: parseFloat(o.slTriggerPx),
            amount: 0,
            filled: 0,
            remaining: 0,
            reduceOnly: true,
          });
        }

        if (parseFloat(o.tpTriggerPx)) {
          newOrders.push({
            id: `${o.algoId}_tp`,
            status: OrderStatus.Open,
            symbol: market.symbol,
            type: OrderType.TakeProfit,
            side: ORDER_SIDE[o.side],
            price: parseFloat(o.tpTriggerPx),
            amount: 0,
            filled: 0,
            remaining: 0,
            reduceOnly: true,
          });
        }

        return [...acc, ...newOrders];
      }

      if (o.ordType === 'move_order_stop') {
        const side = ORDER_SIDE[o.side];
        const existingPosition = this.store.positions.find((pos) => {
          return (
            pos.symbol === market.symbol &&
            (side === OrderSide.Sell
              ? pos.side === PositionSide.Long
              : pos.side === PositionSide.Short)
          );
        });

        const callbackSpread = parseFloat(o.callbackSpread);
        const moveTriggerPx = existingPosition
          ? subtract(
              Math.min(existingPosition.entryPrice, callbackSpread),
              Math.max(existingPosition.entryPrice, callbackSpread)
            )
          : parseFloat(o.moveTriggerPx);

        const price = adjust(
          side === OrderSide.Buy
            ? subtract(parseFloat(o.last), moveTriggerPx)
            : add(parseFloat(o.last), moveTriggerPx),
          market.precision.price
        );

        return [
          ...acc,
          {
            id: `${o.algoId}_tsl`,
            status: OrderStatus.Open,
            symbol: market.symbol,
            type: OrderType.TrailingStopLoss,
            side: ORDER_SIDE[o.side],
            price: price || callbackSpread,
            amount: 0,
            filled: 0,
            remaining: 0,
            reduceOnly: true,
          },
        ];
      }

      const amount = multiply(parseFloat(o.sz), market.precision.amount);
      const filled = multiply(parseFloat(o.accFillSz), market.precision.amount);
      const remaining = subtract(amount, filled);

      const order = {
        id: o.ordId,
        status: ORDER_STATUS[o.state],
        symbol: market.symbol,
        type: ORDER_TYPE[o.ordType],
        side: ORDER_SIDE[o.side],
        price: parseFloat(o.px || '0'),
        amount,
        filled,
        remaining,
        reduceOnly: o.reduceOnly === 'true',
      };

      return [...acc, order];
    }, []);
  };

  mapPositions = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Position[], p: Record<string, any>) => {
      const market = this.store.markets.find((m) => m.id === p.instId);
      if (!market) return acc;

      const pos = parseFloat(p.pos);
      const contracts = pos ? multiply(pos, market.precision.amount) : 0;

      let side = POSITION_SIDE[p.posSide];

      if (contracts > 0) side = PositionSide.Long;
      if (contracts < 0) side = PositionSide.Short;

      // FALLBACK TO LONG POSITION IF SENT FROM OKX
      // THIS SHOULD NOT OVERRIDE THE "VIRTUAL SHORT" POSITION
      if (!side) side = PositionSide.Long;

      const position: Position = {
        symbol: market.symbol,
        side,
        entryPrice: contracts ? parseFloat(p.avgPx) : 0,
        notional: contracts ? Math.abs(parseFloat(p.notionalUsd)) : 0,
        leverage: this.leverageHash[market.id] || 0,
        unrealizedPnl: contracts
          ? adjust(parseFloat(p.upl), market.precision.price)
          : 0,
        contracts: Math.abs(contracts),
        liquidationPrice: parseFloat(p.liqPx || '0'),
      };

      return [...acc, position];
    }, []);
  };

  private formatAlgoOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found on OKX`);
    }

    const pFactor = market.precision.amount;
    const pAmount = divide(pFactor, pFactor);

    const amount = adjust(divide(opts.amount, pFactor), pAmount);

    const pPrice = market.precision.price;
    const price = opts.price ? adjust(opts.price, pPrice) : null;

    const req: Record<string, any> = omitUndefined({
      instId: market.id,
      tdMode: 'cross',
      algoClOrdId: `${BROKER_ID}${uuid()}`.slice(0, 32),
      tag: BROKER_ID,
      side: inverseObj(ORDER_SIDE)[opts.side],
      posSide: this.getPositionSide(opts),
      ordType:
        opts.type === OrderType.TrailingStopLoss
          ? 'move_order_stop'
          : 'conditional',
    });

    if (
      opts.type === OrderType.StopLoss ||
      opts.type === OrderType.TakeProfit
    ) {
      req.cxlOnClosePos = true;
      req.reduceOnly = true;

      if (this.store.options.isHedged || this.isPortfolioMargin) {
        req.sz = `${amount}`;
      } else {
        req.closeFraction = '1';
      }
    }

    if (opts.type === OrderType.StopLoss) {
      req.slTriggerPx = `${price}`;
      req.slOrdPx = '-1';
      req.slTriggerPxType = 'mark';
    }

    if (opts.type === OrderType.TakeProfit) {
      req.tpTriggerPx = `${price}`;
      req.tpOrdPx = '-1';
      req.tpTriggerPxType = 'mark';
    }

    if (opts.type === OrderType.TrailingStopLoss) {
      req.activePx = '';
      req.callbackRatio = '';
      req.callbackSpread = `${price}`;
      req.sz = `${amount}`;
    }

    return req;
  };

  private formatCreateOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found on OKX`);
    }

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;

    const pFactor = market.precision.amount;
    const pAmount = divide(pFactor, pFactor);

    const amount = adjust(divide(opts.amount, pFactor), pAmount);
    const price = opts.price ? adjust(opts.price, pPrice) : null;

    const req = omitUndefined({
      instId: market.id,
      clOrdId: `${BROKER_ID}${uuid()}`.slice(0, 32),
      tag: BROKER_ID,
      tdMode: 'cross',
      side: inverseObj(ORDER_SIDE)[opts.side],
      ordType: REVERSE_ORDER_TYPE[opts.type],
      sz: `${amount}`,
      px: opts.type === OrderType.Limit ? `${price}` : undefined,
      reduceOnly: opts.reduceOnly || undefined,
      posSide: this.getPositionSide(opts),
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);
    const payloads: Array<Record<string, any>> = times(lots, () => {
      return { ...req, sz: `${lotSize}` };
    });

    if (rest) payloads.push({ ...req, sz: `${rest}` });

    return payloads;
  };

  private placeOrderBatch = async (payloads: Array<Record<string, any>>) => {
    const responses = await mapSeries(chunk(payloads, 20), async (batch) => {
      const {
        data: { data },
      } = await this.xhr.post<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.PLACE_ORDERS,
        batch
      );

      return data.reduce((acc: string[], o) => {
        if (o.ordId) {
          return [...acc, o.ordId];
        }

        this.emitter.emit('error', o.sMsg);
        return acc;
      }, []);
    });

    return flatten(responses);
  };

  private placeAlgoOrderBatch = async (
    payloads: Array<Record<string, any>>
  ) => {
    const responses = await mapSeries(payloads, async (payload) => {
      const {
        data: { data },
      } = await this.xhr.post<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.PLACE_ALGO_ORDER,
        payload
      );

      return data.reduce((acc: string[], o) => {
        if (o.algoId) {
          return [...acc, o.algoId];
        }

        this.emitter.emit('error', o.sMsg);
        return acc;
      }, []);
    });

    return flatten(responses);
  };

  private cancelNormalOrders = async (orders: Order[]) => {
    const batches = orders
      .filter((o) => !this.isAlgoOrder(o.type))
      .reduce((acc: Array<Record<string, any>>, o) => {
        const market = this.store.markets.find((m) => m.symbol === o.symbol);
        if (!market) return acc;
        return [...acc, { instId: market.id, ordId: o.id }];
      }, []);

    await forEachSeries(chunk(batches, 20), async (batch) => {
      const {
        data: { data },
      } = await this.xhr.post(ENDPOINTS.CANCEL_ORDERS, batch);

      data.forEach((d: Record<string, any>) => {
        if (d.sMsg) this.emitter.emit('error', d.sMsg);
      });
    });
  };

  private cancelAlgoOrders = async (orders: Order[]) => {
    const batches = orders
      .filter((o) => this.isAlgoOrder(o.type))
      .reduce((acc: Array<Record<string, any>>, o) => {
        const market = this.store.markets.find((m) => m.symbol === o.symbol);
        if (!market) return acc;
        return [
          ...acc,
          { instId: market.id, algoId: o.id.replace(/_[a-zA-Z]+$/, '') },
        ];
      }, []);

    await forEachSeries(chunk(batches, 20), async (batch) => {
      const {
        data: { data },
      } = await this.xhr.post(ENDPOINTS.CANCEL_ALGO_ORDERS, batch);

      data.forEach((d: Record<string, any>) => {
        if (d.sMsg) this.emitter.emit('error', d.sMsg);
      });
    });
  };

  private isAlgoOrder = (orderType: OrderType) => {
    return (
      orderType === OrderType.StopLoss ||
      orderType === OrderType.TakeProfit ||
      orderType === OrderType.TrailingStopLoss
    );
  };

  private getPositionSide = (
    opts: Pick<PlaceOrderOpts, 'reduceOnly' | 'side' | 'type'>
  ) => {
    if (!this.store.options.isHedged) return undefined;

    let side = opts.side === OrderSide.Buy ? 'long' : 'short';

    if (
      opts.type === OrderType.StopLoss ||
      opts.type === OrderType.TakeProfit ||
      opts.type === OrderType.TrailingStopLoss ||
      opts.reduceOnly
    ) {
      side = side === 'long' ? 'short' : 'long';
    }

    return side;
  };
}
