import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import chunk from 'lodash/chunk';
import flatten from 'lodash/flatten';
import sumBy from 'lodash/sumBy';
import times from 'lodash/times';
import { forEachSeries, mapSeries } from 'p-iteration';

import type { Store } from '../../store/store.interface';
import { OrderStatus, OrderType, PositionSide } from '../../types';
import type {
  Balance,
  Candle,
  ExchangeOptions,
  OHLCVOptions,
  Order,
  OrderBook,
  PlaceOrderOpts,
  Position,
  Ticker,
  Writable,
} from '../../types';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { roundUSD } from '../../utils/round-usd';
import { adjust, divide, multiply, subtract } from '../../utils/safe-math';
import { BaseExchange } from '../base';

import { createAPI } from './okx.api';
import {
  ENDPOINTS,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  REVERSE_ORDER_TYPE,
} from './okx.types';
import { OKXPrivateWebsocket } from './okx.ws-private';
import { OKXPublicWebsocket } from './okx.ws-public';

export class OKXExchange extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: OKXPublicWebsocket;
  privateWebsocket: OKXPrivateWebsocket;

  leverageHash: Record<string, number> = {};

  constructor(opts: ExchangeOptions, store: Store) {
    super(opts, store);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new OKXPublicWebsocket(this);
    this.privateWebsocket = new OKXPrivateWebsocket(this);
  }

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.BALANCE);
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return err?.response?.data?.msg || err?.message;
    }
  };

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
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

    // Start websocket
    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    // fetch current position mode (Hedge/One-way)
    this.store.setSetting('isHedged', await this.fetchPositionMode());

    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on OKX`);

    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded ${orders.length} OKX orders`);

    this.store.update({
      orders,
      loaded: { ...this.store.loaded, orders: true },
    });
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const { balance, positions } = await this.fetchBalanceAndPositions();
        if (this.isDisposed) return;

        // fetch leverage for each symbols
        if (!this.store.loaded.positions) {
          this.fetchLeverageAndEditPositions(positions);
        }

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
    try {
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
          symbol: m.instId.replace(/-SWAP$/, '').replace(/-/g, ''),
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
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.markets;
    }
  };

  fetchTickers = async () => {
    try {
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
            volume: parseFloat(t.volCcy24h),
            quoteVolume: parseFloat(t.vol24h),
            openInterest: 0,
          };

          return [...acc, ticker];
        },
        []
      );

      return tickers;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.tickers;
    }
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

          const contracts = multiply(
            parseFloat(p.pos),
            market.precision.amount
          );

          const notional = multiply(
            parseFloat(p.notionalUsd),
            market.precision.amount
          );

          const position: Position = {
            symbol: market.symbol,
            side: contracts > 0 ? PositionSide.Long : PositionSide.Short,
            entryPrice: parseFloat(p.avgPx),
            notional: Math.abs(notional),
            leverage: parseFloat(p.lever) || this.leverageHash[market.id] || 0,
            unrealizedPnl: parseFloat(p.upl),
            contracts: Math.abs(contracts),
            liquidationPrice: parseFloat(p.liqPx || '0'),
          };

          return [...acc, position];
        },
        []
      );

      // We create fake positions for the leverage setting
      // since the API doesn't return it for positions with 0 contracts
      const fakePositions: Position[] = this.store.markets.reduce(
        (acc: Position[], m) => {
          const hasPosition = positions.find((p) => p.symbol === m.symbol);
          if (hasPosition) return acc;

          const fakeMarketPositions: Position[] = [
            {
              symbol: m.symbol,
              side: PositionSide.Long,
              entryPrice: 0,
              notional: 0,
              leverage: this.leverageHash[m.id] || 0,
              unrealizedPnl: 0,
              contracts: 0,
              liquidationPrice: 0,
            },
          ];

          if (this.store.options.isHedged) {
            fakeMarketPositions.push({
              symbol: m.symbol,
              side: PositionSide.Short,
              entryPrice: 0,
              notional: 0,
              leverage: this.leverageHash[m.id] || 0,
              unrealizedPnl: 0,
              contracts: 0,
              liquidationPrice: 0,
            });
          }

          return [...acc, ...fakeMarketPositions];
        },
        []
      );

      return {
        balance,
        positions: [...positions, ...fakePositions],
      };
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
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

  fetchLeverageAndEditPositions = async (
    positions: Array<Writable<Position>>
  ) => {
    const responses = flatten(
      await mapSeries(chunk(this.store.markets, 20), async (batch) => {
        const {
          data: { data },
        } = await this.xhr.get(ENDPOINTS.LEVERAGE, {
          params: {
            instId: batch.map((m) => m.id).join(','),
            mgnMode: 'cross',
          },
        });

        return data;
      })
    );

    responses.forEach((r: Record<string, any>) => {
      this.leverageHash[r.instId] = parseFloat(r.lever);

      const idx = positions.findIndex(
        (p) => p.symbol === r.instId.replace(/-SWAP$/, '').replace(/-/g, '')
      );

      if (idx !== -1) {
        // eslint-disable-next-line no-param-reassign
        positions[idx].leverage = this.leverageHash[r.instId];
      }
    });
  };

  fetchOrders = async () => {
    const orders = await this.fetchNormalOrders();
    const ocoOrders = await this.fetchAlgoOrders('oco');
    const conditionalOrders = await this.fetchAlgoOrders('conditional');
    const trailingOrders = await this.fetchAlgoOrders('move_order_stop');
    return [...orders, ...ocoOrders, ...trailingOrders, ...conditionalOrders];
  };

  fetchNormalOrders = async () => {
    const recursiveFetch = async (
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.UNFILLED_ORDERS,
        {
          params: {
            instType: 'SWAP',
            after: orders.length ? orders[orders.length - 1].ordId : undefined,
          },
        }
      );

      if (data.length === 100) {
        return recursiveFetch([...orders, ...data]);
      }

      return [...orders, ...data];
    };

    const okxOrders = await recursiveFetch();
    const orders = this.mapOrders(okxOrders);

    return orders;
  };

  fetchAlgoOrders = async (type: 'conditional' | 'move_order_stop' | 'oco') => {
    const recursiveFetch = async (
      orders: Array<Record<string, any>> = []
    ): Promise<Array<Record<string, any>>> => {
      const {
        data: { data },
      } = await this.xhr.get<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.UNFILLED_ALGO_ORDERS,
        {
          params: {
            instType: 'SWAP',
            ordType: type,
            after: orders.length ? orders[orders.length - 1].algoId : undefined,
          },
        }
      );

      if (data.length === 100) {
        return recursiveFetch([...orders, ...data]);
      }

      return [...orders, ...data];
    };

    const okxOrders = await recursiveFetch();
    const orders = this.mapOrders(okxOrders);

    return orders;
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (market) {
      try {
        const {
          data: { data },
        } = await this.xhr.get(ENDPOINTS.KLINE, {
          params: { instId: market.id, bar: opts.interval, limit: 300 },
        });

        const candles: Candle[] = data.map((c: string[]) => {
          return {
            timestamp: parseInt(c[0], 10),
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[7]),
          };
        });

        candles.sort((a, b) => a.timestamp - b.timestamp);

        return candles;
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
        return [];
      }
    }

    this.emitter.emit('error', `Market ${opts.symbol} not found on OKX`);
    return [];
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

  // TODO: Cancel algo orders
  cancelOrders = async (orders: Order[]) => {
    const batches = orders
      .filter((o) => o.type === OrderType.Limit)
      .reduce((acc: Array<Record<string, any>>, o) => {
        const market = this.store.markets.find((m) => m.symbol === o.symbol);
        if (!market) return acc;
        return [...acc, { instId: market.id, ordId: o.id }];
      }, []);

    await forEachSeries(chunk(batches, 20), async (batch) => {
      await this.unlimitedXHR.post(ENDPOINTS.CANCEL_ORDERS, batch);
    });
  };

  cancelSymbolOrders = async (symbol: string) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    if (!market) return;

    const orders = this.store.orders.filter(
      (o) => o.symbol === symbol && o.type === OrderType.Limit
    );

    const batches = orders.map((o) => ({ instId: market.id, ordId: o.id }));
    await forEachSeries(chunk(batches, 20), async (batch) => {
      await this.unlimitedXHR.post(ENDPOINTS.CANCEL_ORDERS, batch);
    });
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    if (!market) throw new Error(`Market ${symbol} not found on OKX`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    await this.xhr.post(ENDPOINTS.SET_LEVERAGE, {
      instId: market.id,
      lever: `${leverage}`,
      mgnMode: 'cross',
    });

    this.leverageHash[market.id] = leverage;
    this.store.updatePositions([
      [{ symbol, side: PositionSide.Long }, { leverage }],
      [{ symbol, side: PositionSide.Short }, { leverage }],
    ]);
  };

  fetchPositionMode = async () => {
    const {
      data: {
        data: [{ posMode }],
      },
    } = await this.xhr.get(ENDPOINTS.ACCOUNT_CONFIG);
    return posMode === 'long_short_mode';
  };

  changePositionMode = async (hedged: boolean) => {
    if (this.store.positions.filter((p) => p.contracts > 0).length > 0) {
      this.emitter.emit(
        'error',
        'Please close all positions before switching position mode'
      );
      return;
    }

    try {
      await this.xhr.post(ENDPOINTS.SET_POSITION_MODE, {
        posMode: hedged ? 'long_short_mode' : 'net_mode',
      });
      this.store.setSetting('isHedged', hedged);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const payloads = this.formatCreateOrder(opts);
    return await this.placeOrderBatch(payloads);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const requests = orders.flatMap((o) => this.formatCreateOrder(o));
    return await this.placeOrderBatch(requests);
  };

  formatCreateOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found on OKX`);
    }

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;
    const pAmount = market.precision.amount;

    const amount = divide(opts.amount, pAmount);

    const price = opts.price ? adjust(opts.price, pPrice) : null;

    const req = omitUndefined({
      instId: market.id,
      tdMode: 'cross',
      side: inverseObj(ORDER_SIDE)[opts.side],
      ordType: REVERSE_ORDER_TYPE[opts.type],
      sz: amount,
      px: opts.type === OrderType.Limit ? `${price}` : undefined,
      reduceOnly: opts.reduceOnly || undefined,
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);
    const payloads: Array<Record<string, any>> = times(lots, () => {
      return { ...req, qty: lotSize };
    });

    if (rest) payloads.push({ ...req, qty: rest });

    if (opts.takeProfit) {
      payloads[0].tpTriggerPx = `${adjust(opts.takeProfit, pPrice)}`;
      payloads[0].tpOrdPx = '-1';
      payloads[0].tpTriggerPxType = 'mark';
    }

    if (opts.stopLoss) {
      payloads[0].slTriggerPx = `${adjust(opts.stopLoss, pPrice)}`;
      payloads[0].slOrdPx = '-1';
      payloads[0].slTriggerPxType = 'mark';
    }

    return payloads;
  };

  placeOrderBatch = async (payloads: Array<Record<string, any>>) => {
    const batches = chunk(payloads, 20);
    const responses = await mapSeries(batches, async (batch) => {
      const {
        data: { data },
      } = await this.unlimitedXHR.post<{ data: Array<Record<string, any>> }>(
        ENDPOINTS.PLACE_ORDERS,
        batch
      );
      return data.map((o) => o.ordId);
    });

    return flatten(responses);
  };

  mapOrders = (orders: Array<Record<string, any>>) => {
    return orders.reduce<Order[]>((acc, o: Record<string, any>) => {
      const market = this.store.markets.find((m) => m.id === o.instId);
      if (!market) return acc;

      if (o.ordType === 'oco' || o.ordType === 'conditional') {
        const newOrders: Order[] = [];

        if (o.slTriggerPx) {
          newOrders.push({
            id: `${o.algoId}_sl`,
            status: OrderStatus.Open,
            symbol: market.symbol,
            type: OrderType.StopLoss,
            side: ORDER_SIDE[o.side],
            price: parseFloat(o.slTriggerPx),
            amount: 0,
            filled: 0,
            remaining: 0,
            reduceOnly: true,
          });
        }

        if (o.tpTriggerPx) {
          newOrders.push({
            id: `${o.algoId}_tp`,
            status: OrderStatus.Open,
            symbol: market.symbol,
            type: OrderType.TakeProfit,
            side: ORDER_SIDE[o.side],
            price: parseFloat(o.tpTriggerPx),
            amount: 0,
            filled: 0,
            remaining: 0,
            reduceOnly: true,
          });
        }

        return [...acc, ...newOrders];
      }

      const amount = multiply(parseFloat(o.sz), market.precision.amount);
      const filled = multiply(parseFloat(o.accFillSz), market.precision.amount);
      const remaining = subtract(amount, filled);

      const order = {
        id: o.ordId,
        status: ORDER_STATUS[o.state],
        symbol: market.symbol,
        type: ORDER_TYPE[o.ordType],
        side: ORDER_SIDE[o.side],
        price: parseFloat(o.px),
        amount,
        filled,
        remaining,
        reduceOnly: o.reduceOnly === 'true',
      };

      return [...acc, order];
    }, []);
  };
}
