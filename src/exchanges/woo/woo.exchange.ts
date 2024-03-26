import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import sumBy from 'lodash/sumBy';
import times from 'lodash/times';
import { forEachSeries, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
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
  Writable,
} from '../../types';
import { OrderSide, OrderType, OrderStatus, PositionSide } from '../../types';
import { v } from '../../utils/get-key';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { adjust, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './woo.api';
import { ENDPOINTS, ORDER_SIDE, ORDER_TYPE } from './woo.types';
import { normalizeSymbol, reverseSymbol } from './woo.utils';
import { WooPrivateWebscoket } from './woo.ws-private';
import { WooPublicWebsocket } from './woo.ws-public';

export class WOOXExchange extends BaseExchange {
  name = 'WOO';

  xhr: Axios;

  publicWebsocket: WooPublicWebsocket;
  privateWebsocket: WooPrivateWebscoket;

  // Woo store leverage per account, not per position
  // as workaround we store the account leverage here when
  // we call the ACCOUNT endpoint, and copy this value into positions
  private accountLeverage = 1;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 5 });

    this.publicWebsocket = new WooPublicWebsocket(this);
    this.privateWebsocket = new WooPrivateWebscoket(this);
  }

  dispose = () => {
    this.isDisposed = true;
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
  };

  getAccount = async () => {
    const {
      data: { data },
    } = await this.xhr.get(ENDPOINTS.ACCOUNT);

    return {
      userId: data.applicationId,
      affiliateId: data.referrerID || null,
    };
  };

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.ACCOUNT);
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return err?.message?.toLowerCase()?.includes?.('network error')
        ? 'Error while contacting WOO API'
        : err?.response?.data?.message || 'Invalid API key or secret';
    }
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
      `Loaded ${Math.min(tickers.length, markets.length)} Woo X markerts`
    );

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on WOO X`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded WOO X orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const positions = await this.fetchPositions();
        if (this.isDisposed) return;

        const balance = await this.fetchBalance();
        if (this.isDisposed) return;

        // woo doesnt provides unrealized pnl in the account endpoint
        // we are computing this from the positions polling
        (balance as Writable<Balance>).upnl =
          positions.length > 0
            ? Math.round(sumBy(positions, 'unrealizedPnl') * 100) / 100
            : 0;

        // total balance from API already takes in account uPNL
        (balance as Writable<Balance>).total = balance.total - balance.upnl;

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
    try {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Record<string, any> }>(ENDPOINTS.ACCOUNT);

      // store the account leverage
      // we will use this value to populate the positions leverage
      this.accountLeverage = data.leverage;

      const free = Math.round(data.freeCollateral * 100) / 100;
      const total = Math.round(data.totalAccountValue * 100) / 100;
      const used =
        Math.round((data.totalCollateral - data.freeCollateral) * 100) / 100;

      // woo doesnt provides unrealized pnl in the account endpoint
      // we are computing this from the positions polling
      const balance = { free, total, used, upnl: this.store.balance.upnl };

      return balance;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return this.store.balance;
    }
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { rows },
      } = await this.xhr.get<{ rows: Array<Record<string, any>> }>(
        ENDPOINTS.MARKETS
      );

      const markets: Market[] = rows
        .filter((r) => r.symbol.startsWith('PERP_'))
        .map((r) => {
          const [, baseAsset, quoteAsset] = r.symbol.split('_');

          return {
            id: `${baseAsset}/${quoteAsset}:USDT`,
            symbol: `${baseAsset}${quoteAsset}`,
            base: baseAsset,
            quote: quoteAsset,
            active: true,
            precision: {
              amount: v(r, 'base_tick'),
              price: v(r, 'quote_tick'),
            },
            limits: {
              amount: {
                min: v(r, 'base_min'),
                max: v(r, 'base_max'),
              },
              leverage: {
                min: 1,
                max: 20,
              },
            },
          };
        });

      return markets;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return this.store.markets;
    }
  };

  fetchTickers = async () => {
    try {
      const {
        data: { rows },
      } = await this.xhr.get<{ rows: Array<Record<string, any>> }>(
        ENDPOINTS.TICKERS
      );

      const tickers: Ticker[] = rows.reduce((acc: Ticker[], row) => {
        const symbol = normalizeSymbol(row.symbol);
        const market = this.store.markets.find((m) => m.symbol === symbol);

        if (!market) return acc;

        const open = v(row, '24h_open');
        const close = v(row, '24h_close');

        const percentage =
          Math.round(((close - open) / open) * 100 * 100) / 100;

        const ticker: Ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: close,
          ask: close,
          last: close,
          index: v(row, 'index_price'),
          mark: v(row, 'mark_price'),
          percentage,
          fundingRate: v(row, 'last_funding_rate'),
          volume: v(row, '24h_volume'),
          quoteVolume: v(row, '24h_amount'),
          openInterest: v(row, 'open_interest'),
        };

        return [...acc, ticker];
      }, []);

      return tickers;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return this.store.tickers;
    }
  };

  fetchPositions = async () => {
    try {
      const {
        data: {
          data: { positions },
        },
      } = await this.xhr.get<{
        data: { positions: Array<Record<string, any>> };
      }>(ENDPOINTS.POSITIONS);

      const formatted: Position[] = positions.reduce<Position[]>((acc, p) => {
        const symbol = normalizeSymbol(p.symbol);
        const ticker = this.store.tickers.find((t) => t.symbol === symbol);

        if (!ticker) return acc;
        if (!p.holding) return acc;

        const entryPrice = v(p, 'averageOpenPrice');
        const holdings = v(p, 'holding');
        const contracts = Math.abs(holdings);
        const side = holdings > 0 ? PositionSide.Long : PositionSide.Short;

        const priceDiff =
          Math.max(entryPrice, ticker.mark) - Math.min(entryPrice, ticker.mark);

        const isLoss =
          (side === PositionSide.Long && ticker.mark < entryPrice) ||
          (side === PositionSide.Short && ticker.mark > entryPrice);

        const absUPNL = priceDiff * contracts;
        const upnl = Math.round((isLoss ? -absUPNL : absUPNL) * 100) / 100;

        const position = {
          symbol,
          side,
          entryPrice,
          notional: contracts * ticker.mark,
          leverage: this.accountLeverage,
          unrealizedPnl: upnl,
          contracts,
          liquidationPrice: v(p, 'estLiqPrice'),
        };

        return [...acc, position];
      }, []);

      return formatted;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return this.store.positions;
    }
  };

  fetchOrders = async () => {
    const limitOrders = await this.fetchLimitOrders();
    const algoOrders = await this.fetchAlgoOrders();
    return [...limitOrders, ...algoOrders];
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const {
      data: { rows },
    } = await this.xhr.get<{ rows: Array<Record<string, any>> }>(
      ENDPOINTS.KLINE,
      {
        params: {
          symbol: reverseSymbol(opts.symbol),
          type: opts.interval,
          limit: 1000,
        },
      }
    );

    const candles: Candle[] = rows
      .filter((r) => {
        const isAfter = r.timestamp >= (opts.from || Infinity);
        const isBefore = r.timestamp <= (opts.to || 0);
        return !isAfter && !isBefore;
      })
      .map((r) => ({
        timestamp: r.start_timestamp / 1000,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));

    return candles.reverse();
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

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    if (this.isAlgoOrder(order.type)) {
      return this.updateAlgoOrder({ order, update });
    }

    const payload: Record<string, any> = { orderId: order.id };
    if ('price' in update) payload.price = `${update.price}`;
    if ('amount' in update) payload.quantity = `${update.amount}`;

    try {
      await this.xhr.put(`${ENDPOINTS.UPDATE_ORDER}/${order.id}`, payload);
      return [order.id];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  updateAlgoOrder = async ({ order, update }: UpdateOrderOpts) => {
    const payload: Record<string, any> = {};

    if ('price' in update) {
      payload.childOrders = [
        { algoOrderId: order.id, triggerPrice: `${update.price}` },
      ];
    }

    try {
      await this.xhr.put(`${ENDPOINTS.ALGO_ORDER}/${order.parentId}`, payload);
      return [order.id];
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  fetchLimitOrders = async () => {
    try {
      const { data } = await this.xhr.get<{ rows: Array<Record<string, any>> }>(
        ENDPOINTS.ORDERS,
        { params: { status: 'INCOMPLETE' } }
      );

      const orders: Order[] = data.rows.reduce<Order[]>((acc, o) => {
        const order = this.mapLimitOrder(o);
        return order !== null ? [...acc, order] : acc;
      }, []);

      return orders;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  mapLimitOrder = (o: Record<string, any>) => {
    const symbol = normalizeSymbol(o.symbol);
    const market = this.store.markets.find((m) => m.symbol === symbol);

    if (!market) return null;

    const order: Order = {
      id: `${v(o, 'order_id')}`,
      status: OrderStatus.Open,
      symbol,
      type: ORDER_TYPE[o.type],
      side: ORDER_SIDE[o.side],
      price: o.price,
      amount: o.quantity,
      reduceOnly: v(o, 'reduce_only'),
      filled: o.executed,
      remaining: subtract(o.quantity, o.executed),
    };

    return order;
  };

  fetchAlgoOrders = async () => {
    try {
      const {
        data: {
          data: { rows },
        },
      } = await this.xhr.get<{
        data: { rows: Array<Record<string, any>> };
      }>(ENDPOINTS.ALGO_ORDERS, { params: { status: 'INCOMPLETE' } });

      const orders = rows.reduce<Order[]>((acc, o) => {
        const childOrders = this.mapAlgoOrder(o);
        return [...acc, ...childOrders];
      }, []);

      return orders;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  mapAlgoOrder = (o: Record<string, any>) => {
    const symbol = normalizeSymbol(o.symbol);
    const market = this.store.markets.find((m) => m.symbol === symbol);

    if (!market) return [];

    const arr = o.childOrders ? o.childOrders : [o];
    const orders = arr
      .filter(
        (co: Record<string, any>) =>
          v(co, 'triggerPrice') || v(co, 'algoType') === 'TRAILING_STOP'
      )
      .map((co: Record<string, any>) => {
        const filled = v(co, 'totalExecutedQuantity');
        const price =
          v(co, 'triggerPrice') ||
          subtract(v(co, 'extremePrice'), v(co, 'callbackValue'));

        return {
          id: `${v(co, 'algoOrderId')}`,
          parentId: `${v(o, 'rootAlgoOrderId') || v(co, 'rootAlgoOrderId')}`,
          status: OrderStatus.Open,
          symbol,
          type: ORDER_TYPE[v(co, 'algoType')],
          side: ORDER_SIDE[co.side],
          price,
          amount: co.quantity,
          reduceOnly: v(co, 'reduceOnly'),
          filled,
          remaining: subtract(co.quantity, filled),
        };
      });

    return orders;
  };

  cancelOrders = async (orders: Order[]) => {
    await forEachSeries(orders, async (order) => {
      const isAlgo = this.isAlgoOrder(order.type);

      if (isAlgo) {
        await this.cancelAlgoOrder(order);
      } else {
        await this.xhr.delete(ENDPOINTS.CANCEL_ORDER, {
          data: omitUndefined({
            order_id: parseInt(order.id, 10),
            symbol: reverseSymbol(order.symbol),
          }),
        });
      }
    });
  };

  cancelAlgoOrder = async (order: Order) => {
    try {
      const sibling = this.store.orders.find(
        (o) => o.parentId === order.parentId && o.id !== order.id
      );

      const id = order.parentId || order.id;
      await this.xhr.delete(`${ENDPOINTS.ALGO_ORDER}/${id}`);

      if (sibling) {
        const priceKey =
          sibling.type === OrderType.StopLoss ? 'stopLoss' : 'takeProfit';

        await this.placePositionalAlgoOrder({
          symbol: sibling.symbol,
          side: sibling.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy,
          [priceKey]: sibling.price,
        });
      }
    } catch (err: any) {
      if (err?.response?.data?.message?.includes('already canceled')) {
        this.store.removeOrder({ id: order.id });
      } else {
        this.emitter.emit(
          'error',
          err?.response?.data?.message || err?.message
        );
      }
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    if (this.isAlgoOrder(opts.type)) {
      return this.placeAlgoOrder(opts);
    }

    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market not found: ${opts.symbol}`);
    }

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(opts.amount, pAmount);

    const price = opts.price ? adjust(opts.price, pPrice) : null;
    const type = inverseObj(ORDER_TYPE)[opts.type];

    const req = omitUndefined({
      symbol: reverseSymbol(opts.symbol),
      order_type: type,
      order_price: opts.type === OrderType.Limit ? price : undefined,
      reduce_only: opts.reduceOnly,
      side: inverseObj(ORDER_SIDE)[opts.side],
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);
    const payloads = times(lots, () => {
      return { ...req, order_quantity: lotSize };
    });

    if (rest) payloads.push({ ...req, order_quantity: rest });

    try {
      const orderIds = await mapSeries(payloads, async (payload) => {
        const { data } = await this.xhr.post(ENDPOINTS.PLACE_ORDER, payload);

        return data.order_id as string;
      });

      if (opts.stopLoss || opts.takeProfit) {
        const algoIds = await this.placePositionalAlgoOrder(opts);
        orderIds.push(...algoIds);
      }

      return orderIds;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  placeAlgoOrder = async (opts: PlaceOrderOpts) => {
    if (!opts.price) {
      this.emitter.emit('error', 'Price is required for algo orders');
      return [];
    }

    if (opts.type === OrderType.TrailingStopLoss) {
      return this.placeTrailingStopLossOrder(opts);
    }

    const params = {
      symbol: opts.symbol,
      side: opts.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy,
      stopLoss: 0,
      takeProfit: 0,
    };

    const sibling = this.store.orders.find(
      (o) =>
        o.symbol === opts.symbol &&
        (o.type === OrderType.StopLoss || o.type === OrderType.TakeProfit)
    );

    if (opts.type === OrderType.StopLoss) {
      params.stopLoss = opts.price;
    }

    if (opts.type === OrderType.TakeProfit) {
      params.takeProfit = opts.price;
    }

    if (sibling) {
      if (params.stopLoss) params.takeProfit = sibling.price;
      if (params.takeProfit) params.stopLoss = sibling.price;
      await this.cancelAlgoOrder(sibling);
    }

    return this.placePositionalAlgoOrder(params);
  };

  placeTrailingStopLossOrder = async (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    const ticker = this.store.tickers.find((t) => t.symbol === opts.symbol);

    const pSide =
      opts.side === OrderSide.Buy ? PositionSide.Short : PositionSide.Long;

    const position = this.store.positions.find(
      (p) => p.symbol === opts.symbol && p.side === pSide
    );

    if (!market) throw new Error(`Market ${opts.symbol} not found`);
    if (!ticker) throw new Error(`Ticker ${opts.symbol} not found`);

    if (!position) {
      throw new Error(`Position ${opts.symbol} and side ${pSide} not found`);
    }

    const priceDistance = adjust(
      Math.max(ticker.last, opts.price!) - Math.min(ticker.last, opts.price!),
      market.precision.price
    );

    const payload = {
      symbol: reverseSymbol(opts.symbol),
      type: 'MARKET',
      algoType: 'TRAILING_STOP',
      callbackValue: `${priceDistance}`,
      side: inverseObj(ORDER_SIDE)[opts.side],
      reduceOnly: true,
      quantity: `${position.contracts}`,
    };

    const {
      data: { data },
    } = await this.xhr.post<{
      data: { rows: Array<Record<string, any>> };
    }>(ENDPOINTS.ALGO_ORDER, payload);

    return data.rows.map((r) => r.order_id);
  };

  placePositionalAlgoOrder = async (
    opts: Pick<PlaceOrderOpts, 'side' | 'stopLoss' | 'symbol' | 'takeProfit'>
  ) => {
    const req: Record<string, any> = {
      symbol: reverseSymbol(opts.symbol),
      reduceOnly: false,
      algoType: 'POSITIONAL_TP_SL',
      childOrders: [],
    };

    if (opts.stopLoss) {
      req.childOrders.push({
        algoType: 'STOP_LOSS',
        type: 'CLOSE_POSITION',
        side: opts.side === OrderSide.Buy ? 'SELL' : 'BUY',
        reduceOnly: true,
        triggerPrice: `${opts.stopLoss}`,
      });
    }

    if (opts.takeProfit) {
      req.childOrders.push({
        algoType: 'TAKE_PROFIT',
        type: 'CLOSE_POSITION',
        side: opts.side === OrderSide.Buy ? 'SELL' : 'BUY',
        reduceOnly: true,
        triggerPrice: `${opts.takeProfit}`,
      });
    }

    try {
      const {
        data: { data },
      } = await this.xhr.post<{
        data: { rows: Array<Record<string, any>> };
      }>(ENDPOINTS.ALGO_ORDER, req);

      return data.rows.map((r) => r.orderId);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  cancelAllOrders = async () => {
    try {
      await this.xhr.delete(ENDPOINTS.CANCEL_ORDERS);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
    }
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      const wooSymbol = reverseSymbol(symbol);
      await this.xhr.delete(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
        params: { symbol: wooSymbol },
      });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
    }
  };

  setLeverage = (_symbol: string, inputLeverage: number) => {
    return this.setAllLeverage(inputLeverage);
  };

  setAllLeverage = async (inputLeverage: number) => {
    // possible values:
    // 1, 2, 3, 4, 5, 10, 15, 20
    const leverage = Math.round(inputLeverage / 5) * 5;

    if (this.accountLeverage !== inputLeverage && !this.isDisposed) {
      try {
        await this.xhr.post(ENDPOINTS.LEVERAGE, { leverage });
        this.accountLeverage = leverage;
      } catch (err: any) {
        this.emitter.emit(
          'error',
          err?.response?.data?.message || err?.message
        );
      }
    }
  };

  changePositionMode = async (_hedged: boolean) => {
    await this.emitter.emit('error', 'Position mode is not supported on Woo X');
  };

  private isAlgoOrder = (orderType: OrderType) => {
    return (
      orderType === OrderType.StopLoss ||
      orderType === OrderType.TakeProfit ||
      orderType === OrderType.TrailingStopLoss
    );
  };
}
