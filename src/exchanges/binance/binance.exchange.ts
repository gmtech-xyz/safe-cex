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
import { PositionSide, OrderSide, OrderStatus, OrderType } from '../../types';
import { adjust } from '../../utils/adjust';
import { v } from '../../utils/get-key';
import { inverseObj } from '../../utils/inverse-obj';
import { omitUndefined } from '../../utils/omit-undefined';
import { createWebSocket } from '../../utils/universal-ws';
import { BaseExchange } from '../base';

import { createAPI } from './binance.api';
import {
  BASE_WS_URL,
  ORDER_TYPE,
  ORDER_SIDE,
  POSITION_SIDE,
  ENDPOINTS,
} from './binance.types';

export class Binance extends BaseExchange {
  xhr: Axios;
  unlimitedXHR: Axios;

  constructor(opts: ExchangeOptions) {
    super(opts);

    this.xhr = rateLimit(createAPI(opts), { maxRPS: 3 });
    this.unlimitedXHR = createAPI(opts);
  }

  validateAccount = async () => {
    try {
      await this.xhr.get(ENDPOINTS.ACCOUNT);
      return '';
    } catch (err: any) {
      return err?.message?.toLowerCase()?.includes?.('network error')
        ? 'Error while contacting Binance API'
        : 'Invalid API key or secret';
    }
  };

  start = async () => {
    // load initial market data
    // then we can poll for live data
    const markets = await this.fetchMarkets();
    if (this.isDisposed) return;

    this.log(`Loaded ${markets.length} Binance markets`);

    this.store.markets = markets;
    this.store.loaded.markets = true;

    // set hedge mode before fetching positions
    await this.setHedgeMode();
    if (this.isDisposed) return;

    // listen to websocket
    this.listenWS();

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

        const tickers = await this.fetchTickers();
        if (this.isDisposed) return;

        const positions = await this.fetchPositions();
        if (this.isDisposed) return;

        this.store.balance = balance;
        this.store.tickers = tickers;
        this.store.positions = positions;

        this.store.loaded.balance = true;
        this.store.loaded.tickers = true;
        this.store.loaded.positions = true;
      } catch (err: any) {
        this.emitter.emit('error', err?.message);
      }

      if (typeof window === 'undefined') {
        setTimeout(() => this.tick(), 0);
      } else {
        requestAnimationFrame(() => this.tick());
      }
    }
  };

  listenWS = async () => {
    if (!this.isDisposed) {
      const listenKey = await this.fetchListenKey();

      const key = this.options.testnet ? 'testnet' : 'livenet';
      const base = BASE_WS_URL.private[key];

      const url = this.options.testnet
        ? `${base}/${listenKey}`
        : `${base}/${listenKey}?listenKey=${listenKey}`;

      const handleMessage = ({ data }: MessageEvent) => {
        if (!this.isDisposed) {
          const json = JSON.parse(data);
          if (json.e === 'ACCOUNT_UPDATE') this.handlePositionTopic(json.a.P);
          if (json.e === 'ORDER_TRADE_UPDATE') this.handleOrderTopic(json.o);
        }
      };

      const connect = () => {
        if (!this.isDisposed) {
          this.wsPrivate = createWebSocket(
            url,
            // use this send data as ping command
            JSON.stringify({ method: 'LIST_SUBSCRIPTIONS' })
          );

          this.wsPrivate.on('message', handleMessage);
          this.wsPrivate.once('open', () => {
            this.ping();
            this.log(`Listening to Binance positions updates`);
            this.log(`Listening to Binance orders updates`);
          });
        }
      };

      connect();
    }
  };

  handleOrderTopic = (data: Record<string, any>) => {
    if (data.X === 'PARTIALLY_FILLED' || data.X === 'FILLED') {
      this.emitter.emit('fill', {
        side: ORDER_SIDE[data.S],
        symbol: data.s,
        price: parseFloat(data.ap),
        amount: parseFloat(data.l),
      });
    }

    if (data.X === 'NEW') {
      this.addOrReplaceOrderFromStore({
        id: data.c,
        status: OrderStatus.Open,
        symbol: data.s,
        type: ORDER_TYPE[data.ot],
        side: ORDER_SIDE[data.S],
        price: parseFloat(data.p) || parseFloat(data.sp),
        amount: parseFloat(data.q),
        filled: parseFloat(data.z),
        remaining: parseFloat(data.q) - parseFloat(data.z),
      });
    }

    if (data.X === 'PARTIALLY_FILLED') {
      const order = this.store.orders.find((o) => o.id === data.c);

      if (order) {
        order.filled = parseFloat(data.z);
        order.remaining = parseFloat(data.q) - parseFloat(data.z);
      }
    }

    if (data.X === 'CANCELED' || data.X === 'FILLED') {
      this.removeOrderFromStore(data.c);
    }
  };

  handlePositionTopic = (data: Array<Record<string, any>>) => {
    data.forEach((p: any) => {
      const symbol = p.s;
      const side = POSITION_SIDE[p.ps];

      const position = this.store.positions.find(
        (p2) => p2.symbol === symbol && p2.side === side
      );

      if (position) {
        const entryPrice = parseFloat(p.ep);
        const contracts = parseFloat(p.pa);
        const upnl = parseFloat(p.up);

        position.entryPrice = entryPrice;
        position.contracts = contracts;
        position.notional = contracts * entryPrice + upnl;
        position.unrealizedPnl = upnl;
      }
    });
  };

  fetchListenKey = async () => {
    const {
      data: { listenKey },
    } = await this.xhr.post<{ listenKey: string }>(ENDPOINTS.LISTEN_KEY);

    // keep connection alive with a 30 minute interval
    setTimeout(() => this.updateListenKey(), 1000 * 60 * 30);

    return listenKey;
  };

  updateListenKey = async () => {
    if (!this.isDisposed) {
      await this.xhr.put(ENDPOINTS.LISTEN_KEY);
      setTimeout(() => this.updateListenKey(), 1000 * 60 * 30);
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
        const market = this.store.markets.find(
          (m) => m.symbol === book.symbol
        )!;
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
      const { data } = await this.xhr.get<{
        positions: Array<Record<string, any>>;
      }>(ENDPOINTS.ACCOUNT);

      const positions: Position[] = data.positions.map((p) => {
        const entryPrice = parseFloat(v(p, 'entryPrice'));
        const contracts = parseFloat(v(p, 'positionAmt'));
        const upnl = parseFloat(v(p, 'unrealizedProfit'));
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
          liquidationPrice: 0, // Binance doesn't provides on all positions data
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
    const subscribe = () => {
      if (!this.isDisposed) {
        const topic = `${opts.symbol.toLowerCase()}@kline_${opts.interval}`;
        const payload = { method: 'SUBSCRIBE', params: [topic], id: 1 };
        this.wsPublic?.send?.(JSON.stringify(payload));
        this.log(`Switched to [${opts.symbol}:${opts.interval}]`);
      }
    };

    const handleMessage = ({ data }: MessageEvent) => {
      if (!this.isDisposed) {
        const json = JSON.parse(data);

        if (json.s === opts.symbol && json.e === 'kline') {
          const candle: Candle = {
            timestamp: json.k.t / 1000,
            open: parseFloat(json.k.o),
            high: parseFloat(json.k.h),
            low: parseFloat(json.k.l),
            close: parseFloat(json.k.c),
            volume: parseFloat(json.k.v),
          };

          callback(candle);
        }
      }
    };

    const connect = () => {
      if (!this.isDisposed) {
        if (this.wsPublic) {
          this.wsPublic.close();
          this.wsPublic = undefined;
        }

        this.wsPublic = createWebSocket(
          BASE_WS_URL.public[this.options.testnet ? 'testnet' : 'livenet']
        );

        this.wsPublic.on('open', () => subscribe());
        this.wsPublic.on('message', handleMessage);
      }
    };

    const dispose = () => {
      if (this.wsPublic) {
        this.wsPublic.off('message', handleMessage);
        this.wsPublic = undefined;
      }
    };

    connect();

    return dispose;
  };

  setHedgeMode = async () => {
    try {
      await this.xhr.post(ENDPOINTS.POSITION_SIDE, {
        dualSidePosition: 'true',
      });
    } catch {
      // do nothing, hedge mode is already set
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
        await this.xhr.delete(ENDPOINTS.BATCH_ORDERS, { params: request });
      }

      this.store.orders = this.store.orders.filter(
        (o) => !request.origClientOrderIdList.includes(o.id)
      );
    });
  };

  cancelSymbolOrders = async (symbol: string) => {
    await this.xhr.delete(ENDPOINTS.CANCEL_SYMBOL_ORDERS, {
      params: { symbol },
    });

    this.store.orders = this.store.orders.filter((o) => o.symbol !== symbol);
  };

  updateOrder = async ({ order, update }: UpdateOrderOpts) => {
    const newOrder = {
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      price: order.price,
      amount: order.amount,
    };

    if ('price' in update) newOrder.price = update.price;
    if ('amount' in update) newOrder.amount = update.amount;

    await this.cancelOrders([order]);
    await this.placeOrder(newOrder);
  };

  placeOrder = async (opts: PlaceOrderOpts) => {
    const payloads = this.formatCreateOrder(opts);
    await this.placeOrderBatch(payloads);
  };

  placeOrders = async (orders: PlaceOrderOpts[]) => {
    const requests = orders.flatMap((o) => this.formatCreateOrder(o));
    await this.placeOrderBatch(requests);
  };

  // eslint-disable-next-line complexity
  private formatCreateOrder = (opts: PlaceOrderOpts) => {
    const market = this.store.markets.find(({ symbol }) => {
      return symbol === opts.symbol;
    });

    if (!market) {
      throw new Error(`Market ${opts.symbol} not found`);
    }

    const isStopOrTP =
      opts.type === OrderType.StopLoss || opts.type === OrderType.TakeProfit;

    let pSide = opts.side === OrderSide.Buy ? 'LONG' : 'SHORT';

    if (isStopOrTP || opts.reduceOnly) {
      pSide = pSide === 'LONG' ? 'SHORT' : 'LONG';
    }

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

    const req = omitUndefined({
      symbol: opts.symbol,
      positionSide: pSide,
      side: inverseObj(ORDER_SIDE)[opts.side],
      type: inverseObj(ORDER_TYPE)[opts.type],
      quantity: amount ? `${amount}` : undefined,
      [priceField]: price ? `${price}` : undefined,
      timeInForce: opts.type === OrderType.Limit ? 'GTC' : undefined,
      closePosition: isStopOrTP ? 'true' : undefined,
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

  private placeOrderBatch = async (payloads: any[]) => {
    const lots = chunk(payloads, 5);

    await forEachSeries(lots, async (lot) => {
      try {
        if (lot.length === 1) {
          await this.unlimitedXHR.post(ENDPOINTS.ORDER, lot[0]);
        } else {
          const { data } = await this.unlimitedXHR.post(
            ENDPOINTS.BATCH_ORDERS,
            { batchOrders: JSON.stringify(lot) }
          );

          data?.forEach?.((o: any) => {
            if (o.code) this.emitter.emit('error', o.msg);
          });
        }
      } catch (err: any) {
        this.emitter.emit('error', err?.response?.data?.msg || err?.message);
      }
    });
  };
}
