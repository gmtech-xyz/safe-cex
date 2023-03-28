import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import { sumBy } from 'lodash';

import type {
  ExchangeOptions,
  Market,
  Order,
  Position,
  Ticker,
} from '../../types';
import { OrderStatus, PositionSide } from '../../types';
import { v } from '../../utils/get-key';
import { loop } from '../../utils/loop';
import { BaseExchange } from '../base';

import { createAPI } from './woo.api';
import { ENDPOINTS, ORDER_SIDE, ORDER_TYPE } from './woo.types';
import { normalizeSymbol } from './woo.utils';
import { WooPublicWebsocket } from './woo.ws-public';

export class Woo extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: WooPublicWebsocket;

  // Woo store leverage per account, not per position
  // as workaround we store the account leverage here when
  // we call the ACCOUNT endpoint, and copy this value into positions
  private accountLeverage = 1;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new WooPublicWebsocket(this);
  }

  dispose = () => {
    this.isDisposed = true;
    this.publicWebsocket.dispose();
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
          volume: v(row, '24h_amount'),
          quoteVolume: v(row, '24h_volume'),
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

  private fetchLimitOrders = async () => {
    try {
      const { data } = await this.xhr.get<{ rows: Array<Record<string, any>> }>(
        ENDPOINTS.ORDERS,
        { params: { status: 'INCOMPLETE' } }
      );

      const orders: Order[] = data.rows.reduce<Order[]>((acc, o) => {
        const symbol = normalizeSymbol(o.symbol);
        const market = this.store.markets.find((m) => m.symbol === symbol);

        if (!market) {
          return acc;
        }

        const order: Order = {
          id: v(o, 'order_id'),
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

        return [...acc, order];
      }, []);

      return orders;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };

  private fetchAlgoOrders = async () => {
    try {
      const {
        data: {
          data: { rows },
        },
      } = await this.xhr.get<{
        data: { rows: Array<Record<string, any>> };
      }>(ENDPOINTS.ALGO_ORDERS, { params: { status: 'INCOMPLETE' } });

      const orders = rows.reduce<Order[]>((acc, o) => {
        const symbol = normalizeSymbol(o.symbol);
        const market = this.store.markets.find((m) => m.symbol === symbol);

        if (!market) {
          return acc;
        }

        const childOrders = o.childOrders.map((co: Record<string, any>) => {
          const filled = v(co, 'totalExecutedQuantity');

          return {
            id: v(co, 'algoOrderId'),
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

        return [...acc, ...childOrders];
      }, []);

      return orders;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.message || err?.message);
      return [];
    }
  };
}
