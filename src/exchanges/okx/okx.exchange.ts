import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import sumBy from 'lodash/sumBy';

import type { Store } from '../../store/store.interface';
import { PositionSide } from '../../types';
import type { Balance, ExchangeOptions, Position, Ticker } from '../../types';
import { loop } from '../../utils/loop';
import { roundUSD } from '../../utils/round-usd';
import { multiply, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './okx.api';
import { ENDPOINTS } from './okx.types';

export class OKXExchange extends BaseExchange {
  xhr: Axios;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);
    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
  }

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.BALANCE);
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data || err?.message);
      return JSON.stringify(err?.response?.data || err?.message);
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

    this.log(`Loaded ${Math.min(tickers.length, markets.length)} OKX markets`);

    this.store.update({
      tickers,
      loaded: { ...this.store.loaded, tickers: true },
    });

    // TODO: Start websocket

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on OKX`);

    // TODO: Fetch orders
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const { balance, positions } = await this.fetchBalanceAndPositions();
        if (this.isDisposed) return;

        this.store.update({
          balance,
          positions,
          loaded: { ...this.store.loaded, balance: true, positions: true },
        });
      } catch (err: any) {
        this.emitter.emit('error', err?.message);
      }

      loop(() => this.tick());
    }
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

  fetchTickers = async () => {
    const {
      data: { data },
    } = await this.xhr.get(ENDPOINTS.TICKERS, {
      params: {
        instType: 'SWAP',
      },
    });

    const tickers: Ticker[] = data.reduce(
      (acc: Ticker[], t: Record<string, any>) => {
        const market = this.store.markets.find((m) => m.id === t.instId);

        if (!market) return acc;

        const open = parseFloat(t.open24h);
        const last = parseFloat(t.last);
        const percentage = roundUSD(((last - open) / open) * 100);

        const ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: parseFloat(t.bidPx),
          ask: parseFloat(t.askPx),
          last,
          mark: last,
          index: last,
          percentage,
          fundingRate: 0,
          volume: parseFloat(t.vol24h),
          quoteVolume: parseFloat(t.volCcy24h),
          openInterest: 0,
        };

        return [...acc, ticker];
      },
      []
    );

    return tickers;
  };

  fetchBalanceAndPositions = async () => {
    try {
      const {
        data: {
          data: [{ balData: bal }],
        },
      } = await this.xhr.get<{
        data: Array<Record<string, Array<Record<string, any>>>>;
      }>(ENDPOINTS.BALANCE, { params: { instType: 'SWAP' } });

      const {
        data: { data: pData },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.POSITIONS,
        { params: { instType: 'SWAP' } }
      );

      const totalCollateral = roundUSD(sumBy(bal, (b) => parseFloat(b.disEq)));
      const used = roundUSD(sumBy(pData, (p) => parseFloat(p.mmr)));
      const upnl = roundUSD(sumBy(pData, (p) => parseFloat(p.upl)));

      const balance: Balance = {
        used,
        free: subtract(totalCollateral, used),
        total: totalCollateral,
        upnl,
      };

      const positions: Position[] = pData.reduce(
        (acc: Position[], p: Record<string, any>) => {
          const market = this.store.markets.find((m) => m.id === p.instId);

          if (!market) return acc;
          const position: Position = {
            symbol: market.symbol,
            side:
              parseFloat(p.pos) > 0 ? PositionSide.Long : PositionSide.Short,
            entryPrice: parseFloat(p.avgPx),
            notional: Math.abs(
              multiply(parseFloat(p.notionalUsd), market.precision.amount)
            ),
            leverage: parseFloat(p.lever) || 1,
            unrealizedPnl: parseFloat(p.upl),
            contracts: Math.abs(
              multiply(parseFloat(p.pos), market.precision.amount)
            ),
            liquidationPrice: parseFloat(p.liqPx || '0'),
          };

          return [...acc, position];
        },
        []
      );

      return {
        balance,
        positions,
      };
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data || err?.message);
      return {
        balance: this.store.balance,
        positions: this.store.positions,
      };
    }
  };

  fetchPositions = async () => {
    const { positions } = await this.fetchBalanceAndPositions();
    return positions;
  };

  fetchBalance = async () => {
    const { balance } = await this.fetchBalanceAndPositions();
    return balance;
  };

  // fetchOHLCV = async (opts: OHLCVOptions) => {};
}
