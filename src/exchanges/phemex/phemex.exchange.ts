import type { Axios } from 'axios';
import sumBy from 'lodash/sumBy';

import type { Store } from '../../store/store.interface';
import { OrderSide, OrderStatus, OrderType, PositionSide } from '../../types';
import type {
  Candle,
  OHLCVOptions,
  ExchangeOptions,
  Market,
  Position,
  Ticker,
  Order,
} from '../../types';
import { omitUndefined } from '../../utils/omit-undefined';
import { roundUSD } from '../../utils/round-usd';
import { multiply, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './phemex.api';
import type { PhemexApiResponse } from './phemex.types';
import { ENDPOINTS, INTERVAL } from './phemex.types';
import { PhemexPrivateWebsocket } from './phemex.ws-private';
import { PhemexPublicWebsocket } from './phemex.ws-public';

export class PhemexExchange extends BaseExchange {
  xhr: Axios;
  publicWebsocket: PhemexPublicWebsocket;
  privateWebsocket: PhemexPrivateWebsocket;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.name = 'PHEMEX';
    this.xhr = createAPI(opts);
    this.publicWebsocket = new PhemexPublicWebsocket(this);
    this.privateWebsocket = new PhemexPrivateWebsocket(this);
  }

  getAccount = async () => {
    const err = await this.validateAccount();

    return err
      ? { userId: '', affiliateId: '' }
      : { userId: this.options.key, affiliateId: '' };
  };

  validateAccount = async () => {
    try {
      const {
        data: { code, msg },
      } = await this.xhr.get<PhemexApiResponse<any>>(ENDPOINTS.SPOT_WALLETS);

      if (code !== 0) return msg;
      if (code === 0) return '';

      return 'Invalide API key or secret';
    } catch (err: any) {
      return err?.response?.data?.msg || err.message;
    }
  };

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
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
      `Loaded ${Math.min(markets.length, tickers.length)} Phemex markets`
    );

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    const { balance, positions } = await this.fetchBalanceAndPositions();
    if (this.isDisposed) return;

    this.store.update({
      balance,
      positions,
      loaded: { ...this.store.loaded, balance: true, positions: true },
    });

    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    this.log(`Ready to trade on Phemex`);
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { code, msg, data },
      } = await this.xhr.get<
        PhemexApiResponse<{
          data: { perpProductsV2: Array<Record<string, any>> };
        }>
      >(ENDPOINTS.MARKETS);

      if (code !== 0) {
        this.emitter.emit('error', msg);
        return this.store.markets;
      }

      const markets: Market[] = data.perpProductsV2
        .filter((m) => m.status === 'Listed')
        .map((m) => {
          return {
            id: m.symbol,
            symbol: m.symbol,
            base: m.contractUnderlyingAssets,
            quote: m.quoteCurrency,
            active: m.status === 'Listed',
            precision: {
              amount: parseFloat(m.qtyStepSize),
              price: parseFloat(m.tickSize),
            },
            limits: {
              amount: {
                min: parseFloat(m.qtyStepSize),
                max: parseFloat(m.maxOrderQtyRq),
              },
              leverage: {
                min: 1,
                max: m.maxLeverage,
              },
            },
          };
        });

      return markets;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err.message);
      return this.store.markets;
    }
  };

  fetchTickers = async () => {
    try {
      const {
        data: { id, error, result },
      } = await this.xhr.get<{
        id: number;
        error: string | null;
        result: Array<Record<string, any>>;
      }>(ENDPOINTS.TICKERS);

      if (id !== 0) {
        this.emitter.emit('error', error);
        return this.store.tickers;
      }

      const tickers: Ticker[] = result.reduce(
        (acc: Ticker[], t: Record<string, any>) => {
          const market = this.store.markets.find((m) => m.id === t.symbol);
          if (!market) return acc;

          const open = parseFloat(t.openRp);
          const last = parseFloat(t.lastRp);
          const percentage = roundUSD(((last - open) / open) * 100);

          const ticker = {
            id: t.symbol,
            symbol: t.symbol,
            bid: parseFloat(t.bidRp),
            ask: parseFloat(t.askRp),
            last,
            mark: parseFloat(t.markRp),
            index: parseFloat(t.indexRp),
            percentage,
            fundingRate: parseFloat(t.predFundingRateRr),
            volume: parseFloat(t.volumeRq),
            quoteVolume: parseFloat(t.turnoverRv),
            openInterest: parseFloat(t.openInterestRv),
          };

          return [...acc, ticker];
        },
        []
      );

      return tickers;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err.message);
      return this.store.tickers;
    }
  };

  fetchBalanceAndPositions = async () => {
    try {
      const {
        data: { code, msg, data },
      } = await this.xhr.get<
        PhemexApiResponse<{
          data: {
            account: Record<string, any>;
            positions: Array<Record<string, any>>;
          };
        }>
      >(ENDPOINTS.POSITIONS, {
        params: { currency: 'USDT' },
      });

      if (code !== 0) {
        this.emitter.emit('error', msg);
        return {
          balance: this.store.balance,
          positions: this.store.positions,
        };
      }

      const positions: Position[] = this.mapPositions(data.positions);
      const fakePositions = this.store.markets.reduce((acc: Position[], m) => {
        const hasPosition = positions.some((p) => p.symbol === m.symbol);
        if (hasPosition) return acc;

        const fakeMarketPositions: Position = {
          symbol: m.symbol,
          side: PositionSide.Long,
          entryPrice: 0,
          notional: 0,
          leverage: 1,
          unrealizedPnl: 0,
          contracts: 0,
          liquidationPrice: 0,
        };

        return [...acc, fakeMarketPositions];
      }, []);

      const total = parseFloat(data.account.accountBalanceRv);
      const used = parseFloat(data.account.totalUsedBalanceRv);
      const free = subtract(total, used);
      const upnl = sumBy(positions, 'unrealizedPnl');

      return {
        balance: { total, free, used, upnl },
        positions: [...positions, ...fakePositions],
      };
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err.message);

      return {
        balance: this.store.balance,
        positions: this.store.positions,
      };
    }
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const interval = INTERVAL[opts.interval];

    try {
      const { data } = await this.xhr.get<
        PhemexApiResponse<{ data: { rows: any[] } }>
      >(ENDPOINTS.KLINE, {
        params: omitUndefined({
          symbol: opts.symbol,
          from: opts.from ? opts.from / 1000 : undefined,
          to: opts.to ? opts.to / 1000 : undefined,
          resolution: interval,
        }),
      });

      if (data.code !== 0) {
        this.emitter.emit('error', data.msg);
        return [];
      }

      const candles: Candle[] = data.data.rows.map((c: any[]) => {
        return {
          timestamp: c[0],
          open: parseFloat(c[3]),
          high: parseFloat(c[4]),
          low: parseFloat(c[5]),
          close: parseFloat(c[6]),
          volume: parseFloat(c[8]),
        };
      });

      return candles;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err.message);
      return [];
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    return this.publicWebsocket.listenOHLCV(opts, callback);
  };

  mapPositions = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Position[], p: Record<string, any>) => {
      const market = this.store.markets.find((m) => m.id === p.symbol);
      if (!market) return acc;

      const side =
        p.posSide === 'Long' ? PositionSide.Long : PositionSide.Short;

      const contracts = parseFloat(p.size);
      const markPrice = parseFloat(p.markPriceRp);
      const entryPrice = parseFloat(p.avgEntryPriceRp);
      const notional = multiply(contracts, markPrice);

      const unrealizedPnl =
        side === PositionSide.Long
          ? subtract(notional, multiply(contracts, entryPrice))
          : subtract(multiply(contracts, entryPrice), notional);

      const position: Position = {
        symbol: market.symbol,
        side,
        entryPrice,
        notional,
        leverage: Math.abs(parseFloat(p.leverageRr)),
        unrealizedPnl,
        contracts,
        liquidationPrice: parseFloat(p.liquidationPriceRp),
      };

      return [...acc, position];
    }, []);
  };

  mapOrders = (data: Array<Record<string, any>>) => {
    return data.reduce((acc: Order[], o: Record<string, any>) => {
      const market = this.store.markets.find((m) => m.id === o.symbol);
      if (!market) return acc;

      let type = OrderType.Limit;
      if (o.ordType === 'MarketIfTouched') type = OrderType.TakeProfit;
      if (o.ordType === 'Stop') type = OrderType.StopLoss;

      const amount = parseFloat(o.orderQty);
      const remaining = parseFloat(o.leavesQty);
      const filled = subtract(amount, remaining);

      let reduceOnly = o.reduceOnly || false;
      if (o.ordType === 'Stop' || o.ordType === 'MarketIfTouched') {
        reduceOnly = true;
      }

      const order: Order = {
        id: o.orderID,
        symbol: o.symbol,
        status: OrderStatus.Open,
        type,
        side: o.side === 'Sell' ? OrderSide.Sell : OrderSide.Buy,
        price: parseFloat(o.priceRp) || parseFloat(o.stopPxRp),
        amount,
        remaining,
        filled,
        reduceOnly,
      };

      return [...acc, order];
    }, []);
  };
}
