import type { Axios } from 'axios';
import axiosRateLimit from 'axios-rate-limit';

import type { Store } from '../../store/store.interface';
import type { ExchangeOptions, Market, Ticker } from '../../types';
import { BaseExchange } from '../base';

import { createAPI } from './gate.api';
import { ENDPOINTS } from './gate.types';
import { GatePublicWebsocket } from './gate.ws-public';

export class GateExchange extends BaseExchange {
  xhr: Axios;

  publicWebsocket: GatePublicWebsocket;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = axiosRateLimit(createAPI(opts), { maxRPS: 3 });
    this.publicWebsocket = new GatePublicWebsocket(this);
  }

  validateAccount = async () => {
    return await Promise.resolve('');
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

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    this.log(`Loaded ${Math.min(tickers.length, markets.length)} markets`);

    this.publicWebsocket.connectAndSubscribe();
  };

  fetchMarkets = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.MARKETS
    );

    const markets: Market[] = data.map((m) => {
      const [base, quote] = m.name.split('_');

      return {
        id: m.name,
        symbol: `${base}${quote}`,
        base,
        quote,
        active: true,
        precision: {
          amount: parseFloat(m.quanto_multiplier),
          price: parseFloat(m.order_price_round),
        },
        limits: {
          amount: {
            min: parseFloat(m.quanto_multiplier),
            max: parseFloat(m.order_size_max),
          },
          leverage: {
            min: 1,
            max: parseFloat(m.leverage_max),
          },
        },
      };
    });

    return markets;
  };

  fetchTickers = async () => {
    const { data } = await this.xhr.get<Array<Record<string, any>>>(
      ENDPOINTS.TICKERS
    );

    return this.mapTickers(data);
  };

  mapTickers = (data: Array<Record<string, any>>) => {
    return data.reduce<Ticker[]>((acc, t) => {
      const market = this.store.markets.find((m) => m.id === t.contract);
      if (!market) return acc;

      const ticker = {
        id: market.id,
        symbol: market.symbol,
        bid: parseFloat(t.highest_bid),
        ask: parseFloat(t.lowest_ask),
        last: parseFloat(t.last),
        mark: parseFloat(t.mark_price),
        index: parseFloat(t.index_price),
        percentage: parseFloat(t.change_percentage),
        fundingRate: parseFloat(t.funding_rate),
        volume: parseFloat(t.volume_24h_base),
        quoteVolume: parseFloat(t.volume_24h_quote),
        openInterest: 0,
      };

      return [...acc, ticker];
    }, []);
  };
}
