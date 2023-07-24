import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import omit from 'lodash/omit';
import orderBy from 'lodash/orderBy';
import times from 'lodash/times';
import { forEachSeries, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
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
  OrderBook,
} from '../../types';
import {
  OrderTimeInForce,
  OrderType,
  OrderSide,
  PositionSide,
} from '../../types';
import { v } from '../../utils/get-key';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { add, adjust, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './bybit.api';
import {
  ENDPOINTS,
  INTERVAL,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TIME_IN_FORCE,
  ORDER_TYPE,
  POSITION_SIDE,
} from './bybit.types';
import { BybitPrivateWebsocket } from './bybit.ws-private';
import { BybitPublicWebsocket } from './bybit.ws-public';

export class BybitExchange extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: BybitPublicWebsocket;
  privateWebsocket: BybitPrivateWebsocket;

  private unifiedMarginStatus: number = 1;

  private hedgedPositionsMap: Record<string, boolean> = {};
  private leverageHash: Record<string, number> = {};

  get accountType() {
    return this.unifiedMarginStatus === 1 ? 'CONTRACT' : 'UNIFIED';
  }

  get accountCategory() {
    return 'linear';
  }

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new BybitPublicWebsocket(this);
    this.privateWebsocket = new BybitPrivateWebsocket(this);
  }

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
  };

  getAccount = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.ACCOUNT);

    if (data.retCode !== 0) {
      throw new Error(data.retMsg);
    }

    return {
      userId: data?.result?.userID,
      affiliateId: data?.result?.inviterID,
    };
  };

  validateAccount = async () => {
    try {
      const { data } = await this.xhr.get(ENDPOINTS.ACCOUNT_MARGIN);

      if (data.retMsg !== 'OK') {
        this.emitter.emit('error', data.retMsg);

        if (data.retMsg.includes('timestamp and recv_window param')) {
          return 'Check your computer time and date';
        }

        return data.retMsg;
      }

      return '';
    } catch (err) {
      return 'Invalid API key or secret';
    }
  };

  start = async () => {
    const isDemo = !this.options.key || !this.options.secret;

    // first check the account type of the user
    // this will determine the parameters for the next requests
    if (!isDemo) await this.fetchMarginAccountInfos();

    // load initial market data
    // then we can poll for live data
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.store.update({
      markets,
      loaded: { ...this.store.loaded, markets: true },
    });

    // load initial tickers data
    // then we use websocket for live data
    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.log(
      `Loaded ${Math.min(tickers.length, markets.length)} Bybit markets`
    );

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    // start websocket streams
    this.publicWebsocket.connectAndSubscribe();
    if (!isDemo) this.privateWebsocket.connectAndSubscribe();

    // start ticking live data
    // balance, tickers, positions
    if (!isDemo) {
      await this.tick();
    } else {
      this.store.update({
        loaded: { ...this.store.loaded, balance: true, positions: true },
      });
    }
    if (this.isDisposed) return;

    this.log(`Ready to trade on Bybit`);

    // fetch unfilled orders
    const orders = isDemo ? [] : await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Bybit orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });

    // we fetch positions leverage in backggound
    // this is for updating the leverage on the UI
    if (!isDemo) this.fetchLeverage();
  };

  fetchMarginAccountInfos = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.ACCOUNT_MARGIN);

    if (data.retMsg !== 'OK') {
      this.emitter.emit('error', data.retMsg);
      return;
    }

    this.unifiedMarginStatus = data?.result?.unifiedMarginStatus;
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

      loop(() => this.tick(), this.options.extra?.tickInterval);
    }
  };

  fetchBalance = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.BALANCE, {
      params: { accountType: this.accountType },
    });

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.balance;
    }

    // UNIFIED ACCOUNT TYPE BALANCE CALCULATION
    // ----------------------------------------
    if (this.accountType === 'UNIFIED') {
      const [firstAccount] = data.result.list || [];

      const balance: Balance = {
        total: parseFloat(firstAccount.totalEquity),
        upnl: parseFloat(firstAccount.totalPerpUPL),
        used:
          parseFloat(firstAccount.totalMaintenanceMargin) +
          parseFloat(firstAccount.totalInitialMargin),
        free: parseFloat(firstAccount.totalMarginBalance),
      };

      return balance;
    }

    // NORMAL ACCOUNT TYPE BALANCE CALCULATION
    // ---------------------------------------
    const [firstAccount] = data.result.list || [];
    const usdt = firstAccount?.coin?.find?.((c: any) => c.coin === 'USDT');

    // The user has no USDT balance, yet?
    if (!usdt) return this.store.balance;

    const balance: Balance = {
      total: parseFloat(usdt.walletBalance),
      upnl: parseFloat(usdt.unrealisedPnl),
      used: add(
        parseFloat(usdt.totalOrderIM),
        parseFloat(usdt.totalPositionIM)
      ),
      free: parseFloat(usdt.availableToWithdraw),
    };

    return balance;
  };

  fetchOrders = async () => {
    const recursiveFetch = async (
      cursor: string = '',
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const { data } = await this.xhr.get(ENDPOINTS.UNFILLED_ORDERS, {
        params: {
          category: this.accountCategory,
          settleCoin: 'USDT',
          limit: 50,
          cursor,
        },
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
    const { data } = await this.xhr.get(ENDPOINTS.POSITIONS, {
      params: {
        category: this.accountCategory,
        settleCoin: 'USDT',
        limit: 200,
      },
    });

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
      return this.store.positions;
    }

    const positions: Position[] = data.result.list.map(this.mapPosition);

    // copy the positions leverage to hash
    // so we can use it for fake positions with 0
    positions.forEach((p) => {
      this.leverageHash[p.symbol] = p.leverage;
    });

    // We create fake positions for the leverasge settings
    // since the API returns only the positions that are open
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
            leverage: this.leverageHash[m.symbol] || 0,
            unrealizedPnl: 0,
            contracts: 0,
            liquidationPrice: 0,
          },
          {
            symbol: m.symbol,
            side: PositionSide.Short,
            entryPrice: 0,
            notional: 0,
            leverage: this.leverageHash[m.symbol] || 0,
            unrealizedPnl: 0,
            contracts: 0,
            liquidationPrice: 0,
          },
        ];

        return [...acc, ...fakeMarketPositions];
      },
      []
    );

    return [...positions, ...fakePositions];
  };

  fetchTickers = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.TICKERS, {
      params: { category: this.accountCategory },
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
          bid: parseFloat(t.bid1Price),
          ask: parseFloat(t.ask1Price),
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
      params: { category: this.accountCategory, limit: 1000 },
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

  fetchLeverage = async () => {
    for (const market of this.store.markets) {
      if (!this.isDisposed) {
        try {
          const { data } = await this.xhr.get(ENDPOINTS.POSITIONS, {
            params: {
              symbol: market.symbol,
              category: this.accountCategory,
            },
          });

          const row = data?.result?.list?.[0];
          if (row) {
            this.leverageHash[row.symbol] = parseFloat(row.leverage);
          }
        } catch {
          // do nothing
        }
      }
    }
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const interval = INTERVAL[opts.interval];
    const [, amount, unit] = opts.interval.split(/(\d+)/);

    const end = dayjs().valueOf();
    const start = dayjs()
      .subtract(parseFloat(amount) * 500, unit as ManipulateType)
      .valueOf();

    const params = {
      category: this.accountCategory,
      symbol: opts.symbol,
      start,
      end,
      interval,
      limit: 500,
    };

    const { data } = await this.xhr.get(ENDPOINTS.KLINE, { params });

    const candles: Candle[] = orderBy(
      data?.result?.list?.map?.(
        ([open_time, open, high, low, close, volume]: string[]) => {
          return {
            timestamp: parseFloat(open_time) / 1000,
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume),
          };
        }
      ),
      ['timestamp'],
      ['asc']
    );

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

    const positionIdx = await this.getOrderPositionIdx(opts);

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(opts.amount, pAmount);

    const price = opts.price ? adjust(opts.price, pPrice) : null;
    const stopLoss = opts.stopLoss ? adjust(opts.stopLoss, pPrice) : null;
    const takeProfit = opts.takeProfit ? adjust(opts.takeProfit, pPrice) : null;
    const timeInForce =
      inverseObj(ORDER_TIME_IN_FORCE)[
        opts.timeInForce || OrderTimeInForce.GoodTillCancel
      ];

    const req = omitUndefined({
      category: this.accountCategory,
      symbol: opts.symbol,
      side: inverseObj(ORDER_SIDE)[opts.side],
      orderType: inverseObj(ORDER_TYPE)[opts.type],
      qty: `${amount}`,
      price: opts.type === OrderType.Limit ? `${price}` : undefined,
      stopLoss: opts.stopLoss ? `${stopLoss}` : undefined,
      takeProfit: opts.takeProfit ? `${takeProfit}` : undefined,
      reduceOnly: opts.reduceOnly || false,
      slTriggerBy: opts.stopLoss ? 'MarkPrice' : undefined,
      tpTriggerBy: opts.takeProfit ? 'LastPrice' : undefined,
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
      try {
        const { data } = await this.unlimitedXHR.post(
          ENDPOINTS.CREATE_ORDER,
          p
        );
        return data;
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.retMsg || err.message);
        return undefined;
      }
    });

    const fullfilled = responses.filter((r) => r !== undefined);

    fullfilled.forEach((resp) => {
      if (v(resp, 'retMsg') !== 'OK') {
        this.emitter.emit('error', v(resp, 'retMsg'));
      }
    });

    return fullfilled.map((resp) => resp.result.orderId);
  };

  placeStopLossOrTakeProfit = async (opts: PlaceOrderOpts) => {
    const payload: Record<string, any> = {
      category: this.accountCategory,
      symbol: opts.symbol,
      positionIdx: await this.getStopOrderPositionIdx(opts),
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
      category: this.accountCategory,
      symbol: opts.symbol,
      positionIdx: await this.getStopOrderPositionIdx(opts),
      trailingStop: `${distance}`,
    };

    const { data } = await this.xhr.post(ENDPOINTS.SET_TRADING_STOP, payload);

    if (data.retMsg !== 'OK') {
      this.emitter.emit('error', data.retMsg);
    }

    return [data.result.orderId];
  };

  // eslint-disable-next-line complexity
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
          category: this.accountCategory,
          orderId: og.id,
          symbol: order.symbol,
          [key]: `${update.price}`,
        };

        try {
          const { data } = await this.xhr.post(
            ENDPOINTS.REPLACE_ORDER,
            payload
          );

          if (data.retMsg === 'OK') {
            updatedOrderIds.push(data.result.orderId);
          } else {
            this.emitter.emit('error', data.retMsg);
          }
        } catch (err: any) {
          this.emitter.emit(
            'error',
            err?.response?.data?.retMsg || err.message
          );
        }
      }
    }

    // If we want to update the price or amount of a limit order
    // we can do it directly on the order
    if (order.type === OrderType.Limit) {
      const payload: Record<string, any> = {
        category: this.accountCategory,
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
        category: this.accountCategory,
        symbol: order.symbol,
        positionIdx: await this.getOrderPositionIdx(order),
      };

      if ('price' in update) {
        if (order.type === OrderType.StopLoss) {
          payload.stopLoss = `${update.price}`;
        } else if (order.type === OrderType.TakeProfit) {
          payload.takeProfit = `${update.price}`;
        }
      }

      const { data } = await this.xhr.post(ENDPOINTS.SET_TRADING_STOP, payload);

      if (data.retMsg !== 'OK') {
        this.emitter.emit('error', data.retMsg);
      }
    }

    const storeOrder = this.store.orders.find(
      (o) => o.id === order.id && o.symbol === order.symbol
    );

    if (storeOrder) {
      this.store.updateOrder(storeOrder, storeOrder);
    }

    return updatedOrderIds;
  };

  cancelOrders = async (orders: Order[]) => {
    await forEachSeries(orders, async (order) => {
      const { data } = await this.unlimitedXHR.post(ENDPOINTS.CANCEL_ORDER, {
        category: this.accountCategory,
        symbol: order.symbol,
        orderId: order.id,
      });

      if (data.retMsg === 'OK' || data.retMsg.includes('order not exists or')) {
        this.store.removeOrder(order);
      } else {
        this.emitter.emit('error', data.retMsg);
      }
    });
  };

  cancelSymbolOrders = async (symbol: string) => {
    const tpOrSLorders = this.store.orders.filter(
      (o) => o.symbol === symbol && o.type !== OrderType.Limit
    );

    const { data } = await this.unlimitedXHR.post(
      ENDPOINTS.CANCEL_SYMBOL_ORDERS,
      { category: this.accountCategory, symbol }
    );

    // we need to re-create TP/SL after cancel all
    // before bybit was not cancelling them
    if (tpOrSLorders.length > 0) {
      await this.placeOrders(
        tpOrSLorders.map((o) => ({
          ...o,
          side: o.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy,
        }))
      );
    }

    if (v(data, 'retMsg') !== 'OK') {
      this.emitter.emit('error', v(data, 'retMsg'));
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
        category: this.accountCategory,
        symbol,
        buyLeverage: `${leverage}`,
        sellLeverage: `${leverage}`,
      });

      this.leverageHash[symbol] = leverage;
      this.store.updatePositions([
        [{ symbol, side: PositionSide.Long }, { leverage }],
        [{ symbol, side: PositionSide.Short }, { leverage }],
      ]);
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
      category: this.accountCategory,
      coin: 'USDT',
      mode: hedged ? 3 : 0,
    });

    if (data.retMsg === 'All symbols switched successfully.') {
      this.store.setSetting('isHedged', hedged);
    } else {
      this.emitter.emit('error', data.retMsg);
    }
  };

  mapPosition(p: Record<string, any>) {
    const position: Position = {
      symbol: p.symbol,
      side: POSITION_SIDE[p.side],
      entryPrice: parseFloat(v(p, 'avgPrice') || v(p, 'entryPrice') || 0),
      notional: parseFloat(v(p, 'positionValue') || 0),
      leverage: parseFloat(p.leverage),
      unrealizedPnl: parseFloat(v(p, 'unrealisedPnl') || 0),
      contracts: parseFloat(p.size ?? 0),
      liquidationPrice: parseFloat(v(p, 'liqPrice') || 0),
    };

    return position;
  }

  mapOrder(o: Record<string, any>) {
    const isStop = o.stopOrderType !== 'UNKNOWN' && o.stopOrderType !== '';

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
        remaining: subtract(o.qty ?? 0, v(o, 'cumExecQty') ?? 0),
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

  private fetchPositionMode = async (symbol: string) => {
    if (this.store.options.isHedged) return true;

    if (symbol in this.hedgedPositionsMap) {
      return this.hedgedPositionsMap[symbol];
    }

    const { data } = await this.xhr.get(ENDPOINTS.POSITIONS, {
      params: {
        category: this.accountCategory,
        symbol,
      },
    });

    const isHedged = data?.result?.list?.length > 1;

    this.hedgedPositionsMap[symbol] = isHedged;
    this.store.setSetting('isHedged', isHedged);

    return this.hedgedPositionsMap[symbol];
  };

  private getOrderPositionIdx = async (
    opts: Pick<PlaceOrderOpts, 'reduceOnly' | 'side' | 'symbol'>
  ) => {
    const isHedged = await this.fetchPositionMode(opts.symbol);
    if (!isHedged) return 0;

    let positionIdx = opts.side === OrderSide.Buy ? 1 : 2;
    if (opts.reduceOnly) positionIdx = positionIdx === 1 ? 2 : 1;

    return positionIdx;
  };

  private getStopOrderPositionIdx = async (
    opts: Pick<PlaceOrderOpts, 'reduceOnly' | 'side' | 'symbol'>
  ) => {
    const positionIdx = await this.getOrderPositionIdx(opts);
    return { 0: 0, 1: 2, 2: 1 }[positionIdx];
  };
}
