import type { Axios } from 'axios';

import type { Store } from '../../store/store.interface';
import type { ExchangeOptions, Market, Ticker } from '../../types';
import { roundUSD } from '../../utils/round-usd';
import { BaseExchange } from '../base';

import { createAPI } from './phemex.api';
import { ENDPOINTS } from './phemex.types';

export class PhemexExchange extends BaseExchange {
  xhr: Axios;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.name = 'PHEMEX';
    this.xhr = createAPI(opts);
  }

  getAccount = async () => {
    const err = await this.validateAccount();

    return err
      ? { userId: '', affiliateId: '' }
      : { userId: this.options.key, affiliateId: '' };
  };

  validateAccount = async () => {
    try {
      const { data } = await this.xhr.get(ENDPOINTS.SPOT_WALLETS);

      if (data?.code !== 0) return data?.msg;
      if (data?.code === 0) return '';

      return 'Invalide API key or secret';
    } catch (err: any) {
      return err?.response?.data?.msg || err.message;
    }
  };

  dispose = () => {
    super.dispose();
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
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { data },
      } = await this.xhr.get<{
        data: { perpProductsV2: Array<Record<string, any>> };
      }>(ENDPOINTS.MARKETS);

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
        data: { result },
      } = await this.xhr.get<{ result: Array<Record<string, any>> }>(
        ENDPOINTS.TICKERS
      );

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
}
