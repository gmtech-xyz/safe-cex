import type { Axios } from 'axios';
import sumBy from 'lodash/sumBy';

import type { Store } from '../../store/store.interface';
import type {
  Balance,
  ExchangeOptions,
  Market,
  Order,
  Position,
  Ticker,
} from '../../types';
import { OrderSide, OrderStatus, PositionSide } from '../../types';
import { subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './hyperliquid.api';
import { ENDPOINTS, ORDER_TYPE } from './hyperliquid.types';

export class HyperliquidExchange extends BaseExchange {
  name = 'HYPERLIQUID';

  xhr: Axios;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);
    this.xhr = createAPI(opts);
  }

  dispose = () => {
    super.dispose();
  };

  start = async () => {
    const { markets, tickers } = await this.fetchMarketsAndTickers();
    if (this.isDisposed) return;

    this.log(`Loaded ${markets.length} Hyperliquid markets`);

    this.store.update({
      markets,
      tickers,
      loaded: { ...this.store.loaded, markets: true, tickers: true },
    });

    const { balance, positions } = await this.fetchBalanceAndPositions();
    if (this.isDisposed) return;

    this.store.update({
      balance,
      positions,
      loaded: { ...this.store.loaded, balance: true, positions: true },
    });

    this.log(`Ready to trade on Bybit`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded ${orders.length} Hyperliquid orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  fetchMarketsAndTickers = async () => {
    const { data } = await this.xhr.post<
      [
        {
          universe: Array<{
            szDecimals: number;
            name: string;
            maxLeverage: number;
            onlyIsolated: false;
          }>;
        },
        Array<{
          dayNtlVlm: string;
          funding: string;
          impactPxs: [string, string] | null;
          markPx: string;
          midPx: string | null;
          openInterest: string;
          oraclePx: string;
          premium: string | null;
          prevDayPx: string;
        }>,
      ]
    >(ENDPOINTS.INFO, {
      type: 'metaAndAssetCtxs',
    });

    const markets: Market[] = data[0].universe.map((market) => {
      const sizeDecimals = 10 / 10 ** (market.szDecimals + 1);
      const priceDecimals = 10 / 10 ** (6 - market.szDecimals + 1);

      return {
        id: market.name,
        symbol: market.name,
        base: market.name,
        quote: 'USDC',
        active: true,
        precision: {
          amount: sizeDecimals,
          price: priceDecimals,
        },
        limits: {
          amount: {
            min: sizeDecimals,
            max: Infinity,
          },
          leverage: {
            min: 1,
            max: market.maxLeverage,
          },
        },
      };
    });

    const tickers: Ticker[] = data[1].map((t, idx) => {
      const last = t.midPx ? parseFloat(t.midPx) : 0;
      const prevDay = parseFloat(t.prevDayPx);
      const percentage = ((last - prevDay) / prevDay) * 100;

      const ticker = {
        id: markets[idx].id,
        symbol: markets[idx].symbol,
        bid: t.impactPxs ? parseFloat(t.impactPxs[0]) : 0,
        ask: t.impactPxs ? parseFloat(t.impactPxs[1]) : 0,
        last,
        mark: parseFloat(t.markPx),
        index: parseFloat(t.oraclePx),
        percentage,
        openInterest: parseFloat(t.openInterest),
        fundingRate: parseFloat(t.funding),
        volume: 0,
        quoteVolume: 0,
      };

      return ticker;
    });

    return {
      markets,
      tickers,
    };
  };

  fetchBalanceAndPositions = async () => {
    const { data } = await this.xhr.post<{
      withdrawable: string;
      marginSummary: {
        accountValue: string;
        totalNtlPos: string;
        totalRawUsd: string;
        totalMarginUsed: string;
      };
      assetPositions: Array<{
        position: {
          coin: string;
          entryPx: string;
          leverage: {
            rawUsd: string;
            type: string;
            value: number;
          };
          liquidationPx: string;
          marginUsed: string;
          positionValue: string;
          returnOnEquity: string;
          szi: string;
          unrealizedPnl: string;
        };
      }>;
    }>(ENDPOINTS.INFO, {
      type: 'clearinghouseState',
      user: this.options.key,
    });

    const upnl = sumBy(data.assetPositions, (p) =>
      parseFloat(p.position.unrealizedPnl)
    );

    const balance: Balance = {
      total: parseFloat(data.marginSummary.accountValue),
      upnl,
      used: parseFloat(data.marginSummary.totalMarginUsed),
      free: parseFloat(data.withdrawable),
    };

    const positions: Position[] = data.assetPositions.map((p) => {
      const contracts = parseFloat(p.position.szi);

      return {
        symbol: p.position.coin,
        contracts,
        side: contracts >= 0 ? PositionSide.Long : PositionSide.Short,
        entryPrice: parseFloat(p.position.entryPx),
        notional: parseFloat(p.position.positionValue),
        leverage: p.position.leverage.value,
        unrealizedPnl: parseFloat(p.position.unrealizedPnl),
        liquidationPrice: parseFloat(p.position.liquidationPx),
      };
    });

    return {
      balance,
      positions,
    };
  };

  fetchOrders = async () => {
    const { data } = await this.xhr.post<
      Array<{
        oid: number;
        coin: string;
        side: 'A' | 'B';
        limitPx: string;
        sz: string;
        timestamp: number;
        triggerCondition: string;
        isTrigger: boolean;
        triggerPx: string;
        isPositionTpsl: boolean;
        reduceOnly: boolean;
        orderType: string;
        origSz: string;
        tif: string;
        cloid: number | null;
      }>
    >(ENDPOINTS.INFO, {
      type: 'frontendOpenOrders',
      user: this.options.key,
    });

    const orders: Order[] = data.map((o) => {
      const amount = parseFloat(o.origSz);
      const remaining = parseFloat(o.sz);
      const filled = subtract(amount, remaining);

      return {
        id: o.oid.toString(),
        status: OrderStatus.Open,
        symbol: o.coin,
        type: ORDER_TYPE[o.orderType],
        side: o.side === 'A' ? OrderSide.Sell : OrderSide.Buy,
        price: parseFloat(o.limitPx),
        amount,
        remaining,
        filled,
        reduceOnly: o.reduceOnly,
      };
    });

    return orders;
  };
}
