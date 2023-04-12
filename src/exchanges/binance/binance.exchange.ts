import type { Axios } from 'axios';
import rateLimit from 'axios-rate-limit';
import BigNumber from 'bignumber.js';
import { chunk, groupBy, omit, times } from 'lodash';
import { forEachSeries } from 'p-iteration';
import { v4 } from 'uuid';

import type {
  Balance,
  Candle,
  ExchangeOptions,
  Market,
  OHLCVOptions,
  Order,
  PlaceOrderOpts,
  Position,
  Ticker,
  UpdateOrderOpts,
} from '../../types';
import {
  OrderTimeInForce,
  PositionSide,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../../types';
import { adjust } from '../../utils/adjust';
import { v } from '../../utils/get-key';
import { inverseObj } from '../../utils/inverse-obj';
import { loop } from '../../utils/loop';
import { omitUndefined } from '../../utils/omit-undefined';
import { BaseExchange } from '../base';

import { createAPI } from './binance.api';
import {
  ORDER_TYPE,
  ORDER_SIDE,
  POSITION_SIDE,
  ENDPOINTS,
  TIME_IN_FORCE,
} from './binance.types';
import { BinancePrivateWebsocket } from './binance.ws-private';
import { BinancePublicWebsocket } from './binance.ws-public';

export class Binance extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  publicWebsocket: BinancePublicWebsocket;
  privateWebsocket: BinancePrivateWebsocket;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);

    this.publicWebsocket = new BinancePublicWebsocket(this);
    this.privateWebsocket = new BinancePrivateWebsocket(this);
  }

  dispose = () => {
    super.dispose();
    this.publicWebsocket.dispose();
    this.privateWebsocket.dispose();
  };

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.ACCOUNT);
      return '';
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return err?.message?.toLowerCase()?.includes?.('network error')
        ? 'Error while contacting Binance API'
        : err?.response?.data?.msg || 'Invalid API key or secret';
    }
  };

  start = async () => {
    // load initial market data
    // then we can poll for live data
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.store.markets = markets;
    this.store.loaded.markets = true;

    // load initial tickers data
    // then we use websocket for live data
    const tickers = await this.fetchTickers();
    if (this.isDisposed) return;

    this.log(
      `Loaded ${Math.min(tickers.length, markets.length)} Binance markets`
    );

    this.store.tickers = tickers;
    this.store.loaded.tickers = true;

    // start websocket streams
    this.publicWebsocket.connectAndSubscribe();
    this.privateWebsocket.connectAndSubscribe();

    // fetch current position mode (Hedge/One-way)
    this.store.options.isHedged = await this.fetchPositionMode();

    // start ticking live data
    // balance, tickers, positions
    await this.tick();
    if (this.isDisposed) return;

    this.log(`Ready to trade on Binance`);

    // fetch unfilled orders
    const orders = await this.fetchOrders();
    if (this.isDisposed) return;

    this.log(`Loaded Binance orders`);

    this.store.orders = orders;
    this.store.loaded.orders = true;
  };

  tick = async () => {
    if (!this.isDisposed) {
      try {
        const balance = await this.fetchBalance();
        if (this.isDisposed) return;

        const positions = await this.fetchPositions();
        if (this.isDisposed) return;

        this.store.balance = balance;
        this.store.positions = positions;

        this.store.loaded.balance = true;
        this.store.loaded.positions = true;
      } catch (err: any) {
        this.emitter.emit('error', err?.message);
      }

      loop(() => this.tick());
    }
  };

  fetchBalance = async () => {
    try {
      const { data } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.BALANCE
      );

      const usdt = data.find(({ asset }) => asset === 'USDT')!;
      const busd = data.find(({ asset }) => asset === 'BUSD')!;

      const balances = [usdt, busd].map((margin) => {
        const free = parseFloat(margin.availableBalance);
        const total = parseFloat(margin.balance);
        const upnl = parseFloat(margin.crossUnPnl);
        const used = total - free;
        return { free, total, used, upnl };
      });

      return balances.reduce(
        (acc: Balance, curr: Balance) => {
          return {
            free: acc.free + curr.free,
            total: acc.total + curr.total,
            used: acc.used + curr.used,
            upnl: acc.upnl + curr.upnl,
          };
        },
        { free: 0, total: 0, used: 0, upnl: 0 }
      );
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.balance;
    }
  };

  fetchMarkets = async () => {
    try {
      const {
        data: { symbols },
      } = await this.xhr.get<{ symbols: Array<Record<string, any>> }>(
        ENDPOINTS.MARKETS
      );

      const { data } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.LEVERAGE_BRACKET
      );

      const markets: Market[] = symbols
        .filter(
          (m) =>
            v(m, 'contractType') === 'PERPETUAL' &&
            (v(m, 'marginAsset') === 'BUSD' || v(m, 'marginAsset') === 'USDT')
        )
        .map((m) => {
          const p = m.filters.find(
            (f: any) => v(f, 'filterType') === 'PRICE_FILTER'
          );

          const amt = m.filters.find(
            (f: any) => v(f, 'filterType') === 'LOT_SIZE'
          );

          const mAmt = m.filters.find(
            (f: any) => v(f, 'filterType') === 'MARKET_LOT_SIZE'
          );

          const { brackets } = data.find((b) => b.symbol === m.symbol)!;
          const baseAsset = v(m, 'baseAsset');
          const quoteAsset = v(m, 'quoteAsset');
          const marginAsset = v(m, 'marginAsset');

          return {
            id: `${baseAsset}/${quoteAsset}:${marginAsset}`,
            symbol: m.symbol,
            base: baseAsset,
            quote: quoteAsset,
            active: m.status === 'TRADING',
            precision: {
              amount: parseFloat(v(amt, 'stepSize')),
              price: parseFloat(v(p, 'tickSize')),
            },
            limits: {
              amount: {
                min: Math.max(
                  parseFloat(v(amt, 'minQty')),
                  parseFloat(v(mAmt, 'minQty'))
                ),
                max: Math.min(
                  parseFloat(v(amt, 'maxQty')),
                  parseFloat(v(mAmt, 'maxQty'))
                ),
              },
              leverage: {
                min: 1,
                max: v(brackets[0], 'initialLeverage'),
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
      const { data: dailys } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.TICKERS_24H
      );

      const { data: books } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.TICKERS_BOOK
      );

      const { data: prices } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.TICKERS_PRICE
      );

      const tickers: Ticker[] = books.reduce((acc: Ticker[], book) => {
        const market = this.store.markets.find((m) => m.symbol === book.symbol);

        const daily = dailys.find((d) => d.symbol === book.symbol)!;
        const price = prices.find((p) => p.symbol === book.symbol)!;

        if (!market || !daily || !price) return acc;

        const ticker = {
          id: market.id,
          symbol: market.symbol,
          bid: parseFloat(v(book, 'bidPrice')),
          ask: parseFloat(v(book, 'askPrice')),
          last: parseFloat(v(daily, 'lastPrice')),
          mark: parseFloat(v(price, 'markPrice')),
          index: parseFloat(v(price, 'indexPrice')),
          percentage: parseFloat(v(daily, 'priceChangePercent')),
          fundingRate: parseFloat(v(price, 'lastFundingRate')),
          volume: parseFloat(daily.volume),
          quoteVolume: parseFloat(v(daily, 'quoteVolume')),
          openInterest: 0, // Binance doesn't provides all tickers data
        };

        return [...acc, ticker];
      }, []);

      return tickers;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.tickers;
    }
  };

  fetchPositions = async () => {
    try {
      const { data } = await this.xhr.get<Array<Record<string, any>>>(
        ENDPOINTS.POSITIONS
      );

      // We need to filter out positions that corresponds to
      // markets that are not supported by safe-cex

      const supportedPositions = data.filter((p) =>
        this.store.markets.some((m) => m.symbol === p.symbol)
      );

      const positions: Position[] = supportedPositions.map((p) => {
        const entryPrice = parseFloat(v(p, 'entryPrice'));
        const contracts = parseFloat(v(p, 'positionAmt'));
        const upnl = parseFloat(v(p, 'unRealizedProfit'));
        const pSide = v(p, 'positionSide');

        // If account is not on hedge mode,
        // we need to define the side of the position with the contracts amount
        const side =
          (pSide in POSITION_SIDE && POSITION_SIDE[pSide]) ||
          (contracts > 0 ? PositionSide.Long : PositionSide.Short);

        return {
          symbol: p.symbol,
          side,
          entryPrice,
          notional: Math.abs(contracts) * entryPrice + upnl,
          leverage: parseFloat(p.leverage),
          unrealizedPnl: upnl,
          contracts: Math.abs(contracts),
          liquidationPrice: parseFloat(v(p, 'liquidationPrice')),
        };
      });

      return positions;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      return this.store.positions;
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
        price: parseFloat(o.price) || parseFloat(v(o, 'stopPrice')),
        amount: parseFloat(v(o, 'origQty')),
        reduceOnly: v(o, 'reduceOnly') || false,
        filled: parseFloat(v(o, 'executedQty')),
        remaining: new BigNumber(v(o, 'origQty'))
          .minus(v(o, 'executedQty'))
          .toNumber(),
      };

      return order;
    });

    return orders;
  };

  fetchOHLCV = async (opts: OHLCVOptions) => {
    const { data } = await this.xhr.get<any[][]>(ENDPOINTS.KLINE, {
      params: {
        symbol: opts.symbol,
        interval: opts.interval,
        limit: 500,
      },
    });

    const candles: Candle[] = data.map(
      ([time, open, high, low, close, volume]) => {
        return {
          timestamp: time / 1000,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
        };
      }
    );

    return candles;
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    return this.publicWebsocket.listenOHLCV(opts, callback);
  };

  fetchPositionMode = async () => {
    const { data } = await this.xhr.get(ENDPOINTS.HEDGE_MODE);
    return data.dualSidePosition === true;
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
      await this.xhr.post(ENDPOINTS.HEDGE_MODE, {
        dualSidePosition: hedged ? 'true' : 'false',
      });
      this.store.options.isHedged = hedged;
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  setLeverage = async (symbol: string, inputLeverage: number) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    const position = this.store.positions.find((p) => p.symbol === symbol);

    if (!market) throw new Error(`Market ${symbol} not found`);
    if (!position) throw new Error(`Position ${symbol} not found`);

    const leverage = Math.min(
      Math.max(inputLeverage, market.limits.leverage.min),
      market.limits.leverage.max
    );

    if (position.leverage !== leverage) {
      try {
        await this.xhr.post(ENDPOINTS.SET_LEVERAGE, {
          symbol,
          leverage,
        });

        this.store.positions = this.store.positions.map((p) =>
          p.symbol === symbol ? { ...p, leverage } : p
        );
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    }
  };

  cancelOrders = async (orders: Order[]) => {
    try {
      const groupedBySymbol = groupBy(orders, 'symbol');
      const requests = Object.entries(groupedBySymbol).map(
        ([symbol, symbolOrders]) => ({
          symbol,
          origClientOrderIdList: symbolOrders.map((o) => o.id),
        })
      );

      await forEachSeries(requests, async (request) => {
        if (request.origClientOrderIdList.length === 1) {
          await this.xhr.delete(ENDPOINTS.ORDER, {
            params: {
              symbol: request.symbol,
              origClientOrderId: request.origClientOrderIdList[0],
            },
          });
        } else {
          const lots = chunk(request.origClientOrderIdList, 10);
          await forEachSeries(lots, async (lot) => {
            await this.xhr.delete(ENDPOINTS.BATCH_ORDERS, {
              params: {
                symbol: request.symbol,
                origClientOrderIdList: JSON.stringify(lot),
              },
            });
          });
        }

        this.store.orders = this.store.orders.filter(
          (o) => !request.origClientOrderIdList.includes(o.id)
        );
      });
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  cancelSymbolOrders = async (symbol: string) => {
    try {
      await this.xhr.delete(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
        params: { symbol },
      });

      this.store.orders = this.store.orders.filter((o) => o.symbol !== symbol);
    } catch (err: any) {
      this.emitter.emit('error', err?.response?.data?.msg || err?.message);
    }
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    const newOrder = {
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      price: order.price,
      amount: order.amount,
      reduceOnly: order.reduceOnly || false,
    };

    if ('price' in update) newOrder.price = update.price;
    if ('amount' in update) newOrder.amount = update.amount;

    await this.cancelOrders([order]);
    return await this.placeOrder(newOrder);
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const payloads = this.formatCreateOrder(opts);
    return await this.placeOrderBatch(payloads);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const requests = orders.flatMap((o) => this.formatCreateOrder(o));
    return await this.placeOrderBatch(requests);
  };

  // eslint-disable-next-line complexity
  private formatCreateOrder = (opts: PlaceOrderOpts) => {
    if (opts.type === OrderType.TrailingStopLoss) {
      return this.formatCreateTrailingStopLossOrder(opts);
    }

    const market = this.store.markets.find(({ symbol }) => {
      return symbol === opts.symbol;
    });

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const isStopOrTP =
      opts.type === OrderType.StopLoss || opts.type === OrderType.TakeProfit;

    const pSide = this.getOrderPositionSide(opts);

    const maxSize = market.limits.amount.max;
    const pPrice = market.precision.price;

    const pAmount = market.precision.amount;
    const amount = adjust(opts.amount, pAmount);

    // We use price only for limit orders
    // Market order should not define price
    const price =
      opts.price && opts.type !== OrderType.Market
        ? adjust(opts.price, pPrice)
        : undefined;

    // Binance stopPrice only for SL or TP orders
    const priceField = isStopOrTP ? 'stopPrice' : 'price';

    const reduceOnly = !this.store.options.isHedged && opts.reduceOnly;
    const timeInForce = opts.timeInForce
      ? inverseObj(TIME_IN_FORCE)[opts.timeInForce]
      : inverseObj(TIME_IN_FORCE)[OrderTimeInForce.GoodTillCancel];

    const req = omitUndefined({
      symbol: opts.symbol,
      positionSide: pSide,
      side: inverseObj(ORDER_SIDE)[opts.side],
      type: inverseObj(ORDER_TYPE)[opts.type],
      quantity: amount ? `${amount}` : undefined,
      [priceField]: price ? `${price}` : undefined,
      timeInForce: opts.type === OrderType.Limit ? timeInForce : undefined,
      closePosition: isStopOrTP ? 'true' : undefined,
      reduceOnly: reduceOnly && !isStopOrTP ? 'true' : undefined,
    });

    const lots = amount > maxSize ? Math.ceil(amount / maxSize) : 1;
    const rest = amount > maxSize ? adjust(amount % maxSize, pAmount) : 0;

    const lotSize = adjust((amount - rest) / lots, pAmount);

    const payloads: Array<Record<string, any>> = times(lots, () => ({
      ...req,
      quantity: `${lotSize}`,
    }));

    if (rest) {
      payloads.push({ ...req, quantity: `${rest}` });
    }

    if (opts.stopLoss) {
      payloads.push({
        ...omit(req, 'price'),
        side: inverseObj(ORDER_SIDE)[
          opts.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy
        ],
        type: inverseObj(ORDER_TYPE)[OrderType.StopLoss],
        stopPrice: `${opts.stopLoss}`,
        timeInForce: 'GTC',
        closePosition: 'true',
      });
    }

    if (opts.takeProfit) {
      payloads.push({
        ...omit(req, 'price'),
        side: inverseObj(ORDER_SIDE)[
          opts.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy
        ],
        type: inverseObj(ORDER_TYPE)[OrderType.TakeProfit],
        stopPrice: `${opts.takeProfit}`,
        timeInForce: 'GTC',
        closePosition: 'true',
      });
    }

    // We need to set orderId for each order
    // otherwise Binance will duplicate the IDs
    // when its sent in batches
    for (const payload of payloads) {
      payload.newClientOrderId = v4().replace(/-/g, '');
    }

    return payloads;
  };

  private formatCreateTrailingStopLossOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    const ticker = this.store.tickers.find((t) => t.symbol === opts.symbol);

    const pSide =
      opts.side === OrderSide.Buy ? PositionSide.Short : PositionSide.Long;

    const position = this.store.positions.find(
      (p) => p.symbol === opts.symbol && p.side === pSide
    );

    if (!market) throw new Error(`Market ${opts.symbol} not found`);
    if (!ticker) throw new Error(`Ticker ${opts.symbol} not found`);

    if (!position) {
      throw new Error(`Position ${opts.symbol} and side ${pSide} not found`);
    }

    const priceDistance = adjust(
      Math.max(ticker.last, opts.price!) - Math.min(ticker.last, opts.price!),
      market.precision.price
    );

    const distancePercentage =
      Math.round(((priceDistance * 100) / ticker.last) * 10) / 10;

    const payload = {
      symbol: opts.symbol,
      positionSide: this.getOrderPositionSide(opts),
      side: inverseObj(ORDER_SIDE)[opts.side],
      type: inverseObj(ORDER_TYPE)[OrderType.TrailingStopLoss],
      quantity: `${position.contracts}`,
      callbackRate: `${distancePercentage}`,
      priceProtect: 'true',
      newClientOrderId: v4().replace(/-/g, ''),
    };

    return [payload];
  };

  private getOrderPositionSide = (opts: PlaceOrderOpts) => {
    let positionSide = 'BOTH';

    // We need to specify side of the position to interract with
    // if we are in hedged mode on the binance account
    if (this.store.options.isHedged) {
      positionSide = opts.side === OrderSide.Buy ? 'LONG' : 'SHORT';

      if (
        opts.type === OrderType.StopLoss ||
        opts.type === OrderType.TakeProfit ||
        opts.type === OrderType.TrailingStopLoss ||
        opts.reduceOnly
      ) {
        positionSide = positionSide === 'LONG' ? 'SHORT' : 'LONG';
      }
    }

    return positionSide;
  };

  private placeOrderBatch = async (payloads: any[]) => {
    const lots = chunk(payloads, 5);
    const orderIds = [] as string[];

    for (const lot of lots) {
      if (lot.length === 1) {
        try {
          await this.unlimitedXHR.post(ENDPOINTS.ORDER, lot[0]);
          orderIds.push(lot[0].newClientOrderId);
        } catch (err: any) {
          this.emitter.emit('error', err?.response?.data?.msg || err?.message);
        }
      }

      if (lot.length > 1) {
        const { data } = await this.unlimitedXHR.post(ENDPOINTS.BATCH_ORDERS, {
          batchOrders: JSON.stringify(lot),
        });

        data?.forEach?.((o: any) => {
          if (o.code) {
            this.emitter.emit('error', o.msg);
          } else {
            orderIds.push(o.clientOrderId);
          }
        });
      }
    }

    return orderIds;
  };
}
