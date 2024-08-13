import type { Axios } from 'axios';
import groupBy from 'lodash/groupBy';
import sumBy from 'lodash/sumBy';
import times from 'lodash/times';
import { map } from 'p-iteration';

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
  PlaceOrderOpts,
  OrderBook,
} from '../../types';
import { omitUndefined } from '../../utils/omit-undefined';
import { roundUSD } from '../../utils/round-usd';
import { adjust, multiply, subtract } from '../../utils/safe-math';
import { uuid } from '../../utils/uuid';
import { BaseExchange } from '../base';

import { createAPI } from './phemex.api';
import type { PhemexApiResponse } from './phemex.types';
import { BROKER_ID, ENDPOINTS, INTERVAL, ORDER_TYPE } from './phemex.types';
import { PhemexPrivateWebsocket } from './phemex.ws-private';
import { PhemexPublicWebsocket } from './phemex.ws-public';

export class PhemexExchange extends BaseExchange {
  name = 'PHEMEX';

  xhr: Axios;
  publicWebsocket: PhemexPublicWebsocket;
  privateWebsocket: PhemexPrivateWebsocket;

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

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
          leverage: 10,
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

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    return this.publicWebsocket.listenOrderBook(symbol, callback);
  };

  cancelOrders = async (orders: Order[]) => {
    const symbolSideGrouped = groupBy(
      orders,
      (o) => `${o.symbol}_${this.getPosSideFromOrder(o)}`
    );

    await Promise.all(
      Object.keys(symbolSideGrouped).map(async (symbolSide) => {
        const groupedOrders = symbolSideGrouped[symbolSide];
        const [symbol, side] = symbolSide.split('_');

        try {
          const { data } = await this.xhr.delete<PhemexApiResponse<any>>(
            ENDPOINTS.CANCEL_ORDERS,
            {
              params: {
                symbol,
                posSide: side,
                orderID: groupedOrders.map((o) => o.id).join(','),
              },
            }
          );

          if (data.code !== 0) {
            this.emitter.emit('error', data.msg);
          }
        } catch (err: any) {
          this.emitter.emit('error', err?.response?.data?.msg || err.message);
        }
      })
    );
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      const { data } = await this.xhr.delete<PhemexApiResponse<any>>(
        ENDPOINTS.CANCEL_ALL_ORDERS,
        { params: { symbol } }
      );

      if (data.code !== 0) {
        this.emitter.emit('error', data.msg);
      }
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err.message);
    }
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.id === symbol);
    const position = this.store.positions.find((p) => p.symbol === symbol);

    if (!market) throw new Error(`Market ${symbol} not found`);
    if (!position) throw new Error(`Position ${symbol} not found`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    if (position.leverage !== leverage) {
      try {
        const { data } = await this.xhr.put<PhemexApiResponse<any>>(
          ENDPOINTS.SET_LEVERAGE,
          undefined,
          {
            params: {
              symbol,
              longLeverageRr: -leverage,
              shortLeverageRr: -leverage,
            },
          }
        );

        if (data.code !== 0) {
          this.emitter.emit('error', data.msg);
        } else {
          this.store.updatePositions([
            [{ symbol, side: PositionSide.Long }, { leverage }],
            [{ symbol, side: PositionSide.Short }, { leverage }],
          ]);
        }
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err.message);
      }
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const payloads =
      opts.type === OrderType.Limit || opts.type === OrderType.Market
        ? this.formatNormalOrder(opts)
        : this.formatAlgoOrder(opts);

    const orderIds = await map(payloads, async (payload) => {
      try {
        const { data } = await this.xhr.put<
          PhemexApiResponse<{ data: { orderID: string } }>
        >(ENDPOINTS.CREATE_ORDER, undefined, { params: payload });

        if (data.code !== 0) {
          this.emitter.emit('error', data.msg);
          return null;
        }

        return data.data.orderID;
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err.message);
        return null;
      }
    });

    return orderIds.filter((id) => id !== null) as string[];
  };

  formatNormalOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    if (!market) throw new Error(`Market ${opts.symbol} not found`);

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = adjust(opts.amount, pAmount);
    const price = opts.price ? adjust(opts.price, pPrice) : undefined;

    const req: Record<string, any> = omitUndefined({
      clOrdID: `${BROKER_ID}_${uuid()}`,
      symbol: opts.symbol,
      orderQtyRq: `${amount}`,
      ordType: ORDER_TYPE[opts.type],
      priceRp: opts.price ? `${price}` : undefined,
      side: opts.side === OrderSide.Buy ? 'Buy' : 'Sell',
      posSide: this.getPosSideFromOrder(opts),
      reduceOnly: opts.reduceOnly,
    });

    if (opts.stopLoss) {
      req.stopLossRp = `${adjust(opts.stopLoss, pPrice)}`;
    }

    if (opts.takeProfit) {
      req.takeProfitRp = `${adjust(opts.takeProfit, pPrice)}`;
    }

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);
    const payloads = times(lots, () => {
      return { ...req, orderQtyRq: `${lotSize}` };
    });

    if (rest) payloads.push({ ...req, orderQtyRq: `${rest}` });

    return payloads;
  };

  formatAlgoOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    if (!market) throw new Error(`Market ${opts.symbol} not found`);

    const pPrice = market.precision.price;
    const price = adjust(opts.price ?? 0, pPrice);

    const req: Record<string, any> = omitUndefined({
      clOrdID: `${BROKER_ID}_${uuid()}`,
      symbol: opts.symbol,
      ordType: ORDER_TYPE[opts.type],
      priceRp: `${price}`,
      side: opts.side === OrderSide.Buy ? 'Buy' : 'Sell',
      posSide: this.getPosSideFromOrder(opts),
      closeOnTrigger: true,
      triggerType: 'ByMarkPrice',
      stopPxRp: `${price}`,
    });

    return [req];
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

      let reduceOnly = o.execInst === 'ReduceOnly' || false;
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

  private getPosSideFromOrder = (
    order: Pick<Order, 'side' | 'type'> & { reduceOnly?: boolean }
  ) => {
    if (
      (order.reduceOnly === true &&
        (order.type === OrderType.Limit || order.type === OrderType.Market)) ||
      order.type === OrderType.StopLoss ||
      order.type === OrderType.TrailingStopLoss ||
      order.type === OrderType.TakeProfit
    ) {
      return order.side === OrderSide.Buy ? 'Short' : 'Long';
    }

    return order.side === OrderSide.Buy ? 'Long' : 'Short';
  };
}
