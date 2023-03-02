import type { Axios } from 'axios';
import axiosRateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import { partition } from 'lodash';
import { forEachSeries } from 'p-iteration';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  Position,
  Ticker,
} from '../../types';
import { PositionSide, OrderStatus } from '../../types';
import { v } from '../../utils/get-key';
import { createWebSocket } from '../../utils/universal-ws';
import { BaseBinanceExchange } from '../base.binance';

import { createAPI } from './binance-spot.api';
import {
  BASE_WS_URL,
  ENDPOINTS,
  ORDER_SIDE,
  ORDER_TYPE,
} from './binance-spot.types';

export class BinanceSpot extends BaseBinanceExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  tickersWS?: ReturnType<typeof createWebSocket>;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = axiosRateLimit(createAPI(opts), { maxRPS: 2 });
    this.unlimitedXHR = createAPI(opts);

    this.store.options.isSpot = true;
    this.store.options.isHedged = false;
  }

  validateAccount = async () => {
    try {
      const { data } = await this.xhr.get(ENDPOINTS.ACCOUNT);
      return data.data === 'Normal'
        ? ''
        : 'Your account does not allow trading';
    } catch (error: any) {
      return 'Invalid API key or secret';
    }
  };

  start = async () => {
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.log(`Loaded ${markets.length} Binance spot markets`);

    this.store.markets = markets;
    this.store.loaded.markets = true;

    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.store.tickers = tickers;
    this.store.loaded.tickers = true;

    this.listenMarkets();

    const { balance, positions } = await this.fetchBalanceAndPositions();
    if (this.isDisposed) return;

    this.store.balance = balance;
    this.store.positions = positions;

    this.store.loaded.balance = true;
    this.store.loaded.positions = true;

    this.log(`Ready to trade on Binance spot`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Binance spot orders`);

    this.store.orders = orders;
    this.store.loaded.orders = true;
  };

  fetchBalanceAndPositions = async () => {
    try {
      const { data } = await this.xhr.post<Array<Record<string, any>>>(
        ENDPOINTS.BALANCE
      );

      const [stables, others] = partition(data, (p) =>
        ['USDT', 'USDC', 'BUSD'].includes(p.asset)
      );

      const free = stables.reduce<number>((acc, p) => {
        return acc + parseFloat(p.free);
      }, 0);

      const used = others.reduce<number>((acc, p) => {
        const ticker = this.store.tickers.find(
          (t) => t.symbol === `${p.asset}USDT`
        );

        return acc + parseFloat(p.free) * (ticker?.last ?? 0);
      }, 0);

      const balance: Balance = {
        free,
        used,
        total: free + used,
        // Implement by fetching past orders and calculating
        // average entry price on each spot position
        upnl: 0,
      };

      const positions = others.reduce<Position[]>((acc, p) => {
        const ticker = this.store.tickers.find(
          (t) => t.symbol === `${p.asset}USDT`
        );

        if (!ticker) {
          return acc;
        }

        const position = {
          symbol: `${p.asset}USDT`,
          side: PositionSide.Long,
          notional: parseFloat(p.free) * ticker.last,
          contracts: parseFloat(p.free),
          leverage: 1,
          unrealizedPnl: 0,
          entryPrice: 0,
          liquidationPrice: 0,
        };

        return [...acc, position];
      }, []);

      return { balance, positions };
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data || error?.message);

      return {
        balance: this.store.balance,
        positions: this.store.positions,
      };
    }
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { symbols },
      } = await this.xhr.get<{
        symbols: Array<Record<string, any>>;
      }>(ENDPOINTS.MARKETS, { params: { permissions: 'SPOT' } });

      const markets: Market[] = symbols
        .filter(({ status }) => status === 'TRADING')
        .map((m) => {
          const priceFilter = m.filters.find(
            (f: any) => v(f, 'filterType') === 'PRICE_FILTER'
          );

          const lotSize = m.filters.find(
            (f: any) => v(f, 'filterType') === 'LOT_SIZE'
          );

          const notional = m.filters.find(
            (f: any) => v(f, 'filterType') === 'MIN_NOTIONAL'
          );

          const baseAsset = v(m, 'baseAsset');
          const quoteAsset = v(m, 'quoteAsset');

          return {
            id: `${baseAsset}/${quoteAsset}:SPOT`,
            symbol: m.symbol,
            base: baseAsset,
            quote: quoteAsset,
            active: true,
            precision: {
              amount: parseFloat(v(lotSize, 'stepSize')),
              price: parseFloat(v(priceFilter, 'tickSize')),
            },
            limits: {
              amount: {
                min: Math.max(
                  parseFloat(v(lotSize, 'minQty')),
                  parseFloat(v(notional, 'minQty'))
                ),
                max: Math.min(
                  parseFloat(v(lotSize, 'maxQty')),
                  parseFloat(v(notional, 'maxQty'))
                ),
              },
              leverage: {
                min: 1,
                max: 1,
              },
            },
          };
        });

      return markets;
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data);
      return this.store.markets;
    }
  };

  listenMarkets = () => {
    this.tickersWS = createWebSocket(
      BASE_WS_URL[this.options.testnet ? 'testnet' : 'livenet']
    );

    this.tickersWS.on('open', () => {
      const payload = { method: 'SUBSCRIBE', params: ['!ticker@arr'], id: 1 };
      if (this.tickersWS) this.tickersWS.send(JSON.stringify(payload));
    });

    this.tickersWS.on('message', (event) => {
      const tickers: Array<Record<string, any>> = JSON.parse(event.data);

      if (Array.isArray(tickers)) {
        tickers.forEach((tickerUpdate) => {
          const tickerIdx = this.store.tickers.findIndex(
            (t) => t.symbol === tickerUpdate.s
          );

          if (tickerIdx) {
            const price = parseFloat(v(tickerUpdate, 'c'));
            this.store.tickers[tickerIdx] = {
              ...this.store.tickers[tickerIdx],
              bid: parseFloat(v(tickerUpdate, 'b')),
              ask: parseFloat(v(tickerUpdate, 'a')),
              percentage: parseFloat(v(tickerUpdate, 'P')),
              volume: parseFloat(v(tickerUpdate, 'v')),
              quoteVolume: parseFloat(v(tickerUpdate, 'q')),
              last: price,
              mark: price,
              index: price,
            };
          }
        });
      }
    });
  };

  fetchTickers = async () => {
    try {
      const { data } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.TICKERS
      );

      const tickers = data.reduce<Ticker[]>((acc, t) => {
        const market = this.store.markets.find((m) => m.symbol === t.symbol);

        if (!market) {
          return acc;
        }

        const last = parseFloat(v(t, 'lastPrice'));
        const ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: parseFloat(v(t, 'bidPrice')),
          ask: parseFloat(v(t, 'askPrice')),
          last,
          percentage: parseFloat(v(t, 'priceChangePercent')),
          volume: parseFloat(v(t, 'volume')),
          quoteVolume: parseFloat(v(t, 'quoteVolume')),
          mark: last, // mark price is last price on SPOT
          index: last, // index price is last price on SPOT
          fundingRate: 0, //  not on SPOT
          openInterest: 0, // not on SPOT
        };

        return [...acc, ticker];
      }, []);

      return tickers;
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data);
      return this.store.tickers;
    }
  };

  fetchOrders = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.OPEN_ORDERS
    );

    const orders: Order[] = data.map((o) => {
      const order = {
        id: v(o, 'clientOrderId'),
        status: OrderStatus.Open,
        symbol: o.symbol,
        type: ORDER_TYPE[o.type],
        side: ORDER_SIDE[o.side],
        price: parseFloat(v(o, 'stopPrice')) || parseFloat(v(o, 'price')),
        amount: parseFloat(v(o, 'origQty')),
        filled: parseFloat(v(o, 'executedQty')),
        remaining: new BigNumber(v(o, 'origQty'))
          .minus(v(o, 'executedQty'))
          .toNumber(),
      };

      return order;
    });

    return orders;
  };

  fetchOHLCV = (opts: OHLCVOptions) => {
    return this._fetchOHLCV(ENDPOINTS.KLINE, opts);
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const endpoint = BASE_WS_URL[this.options.testnet ? 'testnet' : 'livenet'];
    return this._listenOHLCV(endpoint, opts, callback);
  };

  cancelOrders = async (orders: Order[]) => {
    await forEachSeries(orders, (order) => this.cancelOrder(order));
  };

  cancelOrder = async (order: Order) => {
    await this.xhr.delete(ENDPOINTS.ORDER, {
      data: { symbol: order.symbol, origClientOrderId: order.id },
    });

    this.removeOrderFromStore(order.id);
  };

  cancelSymbolOrders = async (symbol: string) => {
    await this.xhr.delete(ENDPOINTS.OPEN_ORDERS, {
      data: { symbol },
    });

    this.removeOrdersFromStore(
      this.store.orders.filter((o) => o.symbol === symbol).map((o) => o.id)
    );
  };

  dispose() {
    super.dispose();

    this.tickersWS?.close?.();
    this.tickersWS = undefined;
  }
}
