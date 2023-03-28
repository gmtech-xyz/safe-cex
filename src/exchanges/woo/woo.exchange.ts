import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import { sumBy } from 'lodash';
import { forEachSeries } from 'p-iteration';

import type {
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  Position,
  Ticker,
  UpdateOrderOpts,
} from '../../types';
import { OrderType, OrderStatus, PositionSide } from '../../types';
import { v } from '../../utils/get-key';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { createWebSocket } from '../../utils/universal-ws';
import { BaseExchange } from '../base';

import { createAPI } from './woo.api';
import { BASE_WS_URL, ENDPOINTS, ORDER_SIDE, ORDER_TYPE } from './woo.types';
import { normalizeSymbol, reverseSymbol } from './woo.utils';
import { WooPrivateWebscoket } from './woo.ws-private';
import { WooPublicWebsocket } from './woo.ws-public';

export class Woo extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: WooPublicWebsocket;
  privateWebsocket: WooPrivateWebscoket;

  // Woo store leverage per account, not per position
  // as workaround we store the account leverage here when
  // we call the ACCOUNT endpoint, and copy this value into positions
  private accountLeverage = 1;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new WooPublicWebsocket(this);
    this.privateWebsocket = new WooPrivateWebscoket(this);
  }

  dispose = () => {
    this.isDisposed = true;
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
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

    this.store.markets = markets;
    this.store.loaded.markets = true;

    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.log(
      `Loaded ${Math.min(tickers.length, markets.length)} Woo X markerts`
    );

    this.store.tickers = tickers;
    this.store.loaded.tickers = true;

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on Woo X`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Woo X orders`);

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

        // woo doesnt provides unrealized pnl in the account endpoint
        // we are computing this from the positions polling
        balance.upnl =
          Math.round(sumBy(positions, 'unrealizedPnl') * 100) / 100;

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
    try {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Record<string, any> }>(ENDPOINTS.ACCOUNT);

      // store the account leverage
      // we will use this value to populate the positions leverage
      this.accountLeverage = data.leverage;

      const free = Math.round(data.freeCollateral * 100) / 100;
      const total = Math.round(data.totalCollateral * 100) / 100;
      const used = Math.round((total - free) * 100) / 100;

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
          limit: 500,
        },
      }
    );

    const candles: Candle[] = rows.map((r) => {
      return {
        timestamp: r.start_timestamp / 1000,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      };
    });

    return candles.reverse();
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const topic = `${reverseSymbol(opts.symbol)}@kline_${opts.interval}`;

    const subscribe = () => {
      if (!this.isDisposed) {
        const payload = { event: 'subscribe', topic };
        this.wsPublic?.send(JSON.stringify(payload));
        this.log(`Switched to [${opts.symbol}:${opts.interval}]`);
      }
    };

    const handleMessage = ({ data }: MessageEvent) => {
      if (!this.isDisposed) {
        const json = JSON.parse(data);

        if (json.topic === topic) {
          const candle: Candle = {
            timestamp: json.data.startTime / 1000,
            open: json.data.open,
            high: json.data.high,
            low: json.data.low,
            close: json.data.close,
            volume: json.data.volume,
          };

          callback(candle);
        }
      }
    };

    const connect = () => {
      if (!this.isDisposed) {
        if (this.wsPublic) {
          this.wsPublic?.close();
          this.wsPublic = undefined;
        }

        this.wsPublic = createWebSocket(
          BASE_WS_URL.public[this.options.testnet ? 'testnet' : 'livenet'] +
            this.options.applicationId
        );

        this.wsPublic?.on('open', subscribe);
        this.wsPublic?.on('message', handleMessage);
      }
    };

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
      remaining: new BigNumber(o.quantity).minus(o.executed).toNumber(),
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

    const childOrders = o.childOrders
      .filter((co: Record<string, any>) => v(co, 'triggerPrice'))
      .map((co: Record<string, any>) => {
        const filled = v(co, 'totalExecutedQuantity');

        return {
          id: `${v(co, 'algoOrderId')}`,
          parentId: `${v(o, 'algoOrderId') || v(co, 'rootAlgoOrderId')}`,
          status: OrderStatus.Open,
          symbol,
          type: ORDER_TYPE[v(co, 'algoType')],
          side: ORDER_SIDE[co.side],
          price: v(co, 'triggerPrice'),
          amount: co.quantity,
          reduceOnly: v(co, 'reduceOnly'),
          filled,
          remaining: new BigNumber(co.quantity).minus(filled).toNumber(),
        };
      });

    return childOrders;
  };

  cancelOrders = async (orders: Order[]) => {
    await forEachSeries(orders, async (order) => {
      const isAlgo = this.isAlgoOrder(order.type);

      if (isAlgo) {
        await this.cancelAlgoOrder(order);
      } else {
        await this.unlimitedXHR.delete(ENDPOINTS.CANCEL_ORDER, {
          data: omitUndefined({
            order_id: parseInt(order.id, 10),
            symbol: reverseSymbol(order.symbol),
          }),
        });
      }
    });
  };

  cancelAlgoOrder = async (order: Order) => {
    const otherOrder = this.store.orders.find(
      (o) => o.parentId === order.parentId && o.id !== order.id
    );

    await this.unlimitedXHR.delete(`${ENDPOINTS.ALGO_ORDER}/${order.parentId}`);

    if (otherOrder) {
      // TODO: Re-create the other order
      // using placeOrder, this meant this was a TP_SL pair
      // created on woo x directly
    }
  };

  private isAlgoOrder = (orderType: OrderType) => {
    return (
      orderType === OrderType.StopLoss ||
      orderType === OrderType.TakeProfit ||
      orderType === OrderType.TrailingStopLoss
    );
  };
}
