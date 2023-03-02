import type { Axios } from 'axios';
import axiosRateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import { forEachSeries } from 'p-iteration';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  Ticker,
} from '../../types';
import { OrderStatus } from '../../types';
import { v } from '../../utils/get-key';
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

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = axiosRateLimit(createAPI(opts), { maxRPS: 3 });
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

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on Binance spot`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Binance spot orders`);

    this.store.orders = orders;
    this.store.loaded.orders = true;
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const balance = await this.fetchBalance();
        if (this.isDisposed) return;

        const tickers = await this.fetchTickers();
        if (this.isDisposed) return;

        this.store.balance = balance;
        this.store.tickers = tickers;
        this.store.positions = [];

        this.store.loaded.balance = true;
        this.store.loaded.tickers = true;
        this.store.loaded.positions = true;
      } catch (error: any) {
        this.emitter.emit('error', error?.response?.data);
      }
    }
  };

  fetchBalance = async () => {
    try {
      const {
        data: { price },
      } = await this.xhr.get(ENDPOINTS.AVG_PRICE, {
        params: { symbol: 'BTCUSDT' },
      });

      const { data } = await this.xhr.post<Array<Record<string, any>>>(
        ENDPOINTS.BALANCE,
        { needBtcValuation: true }
      );

      const stables = data.filter(({ asset }) =>
        ['USDT', 'USDC', 'BUSD'].includes(asset)
      );

      const free = stables.reduce<number>((acc, { btcValuation }) => {
        return acc + btcValuation * price;
      }, 0);

      const total = data.reduce<number>((acc, { btcValuation }) => {
        return acc + btcValuation * price;
      }, 0);

      const balance: Balance = {
        free,
        total,
        used: total - free,
        // Implement by fetching past orders and calculating
        // average entry price on each spot position
        upnl: 0,
      };

      return balance;
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data);
      return this.store.balance;
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

  fetchTickers = async () => {
    try {
      const { data } = await this.unlimitedXHR.get<Array<Record<string, any>>>(
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
    try {
      await this.xhr.delete(ENDPOINTS.ORDER, {
        data: { symbol: order.symbol, origClientOrderId: order.id },
      });

      this.removeOrderFromStore(order.id);
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data);
    }
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      await this.xhr.delete(ENDPOINTS.OPEN_ORDERS, {
        data: { symbol },
      });

      this.removeOrdersFromStore(
        this.store.orders.filter((o) => o.symbol === symbol).map((o) => o.id)
      );
    } catch (error: any) {
      this.emitter.emit('error', error?.response?.data);
    }
  };
}
