import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';

import type { Store } from '../../store/store.interface';
import type { ExchangeOptions } from '../../types';
import { BaseExchange } from '../base';

import { createAPI } from './okx.api';
import { ENDPOINTS } from './okx.types';

export class OKXExchange extends BaseExchange {
  xhr: Axios;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);
    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
  }

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
  };

  fetchMarkets = async () => {
    const {
      data: { data },
    } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
      ENDPOINTS.MARKETS,
      { params: { instType: 'SWAP' } }
    );

    const markets = data.map((m) => {
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
        symbol: m.instFamily.replace(/-/g, ''),
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
  };
}
