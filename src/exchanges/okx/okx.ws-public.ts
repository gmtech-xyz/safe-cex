import flatten from 'lodash/flatten';

import type {
  Candle,
  OHLCVOptions,
  OrderBook,
  OrderBookOrders,
} from '../../types';
import { calcOrderBookTotal, sortOrderBook } from '../../utils/orderbook';
import { roundUSD } from '../../utils/round-usd';
import { multiply } from '../../utils/safe-math';
import { BaseWebSocket } from '../base.ws';

import type { OKXExchange } from './okx.exchange';
import { BASE_WS_URL } from './okx.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};
type SubscribedTopics = {
  [id: string]: Array<{ channel: string; instId: string }>;
};

export class OKXPublicWebsocket extends BaseWebSocket<OKXExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {
    tickers: (d: Data) => this.handleTickerEvents(d),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.topics.tickers = this.store.markets.map((m) => ({
        channel: 'tickers',
        instId: m.id,
      }));

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.subscribe();
    }
  };

  subscribe = () => {
    const topics = flatten(Object.values(this.topics));
    const payload = { op: 'subscribe', args: topics };
    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      for (const [channel, handler] of Object.entries(this.messageHandlers)) {
        if (
          data.includes(`channel":"${channel}`) &&
          !data.includes('event":"subscribe"')
        ) {
          handler(JSON.parse(data));
          break;
        }
      }
    }
  };

  handleTickerEvents = ({ data: [update] }: Data) => {
    const open = parseFloat(update.open24h);
    const last = parseFloat(update.last);
    const percentage = roundUSD(((last - open) / open) * 100);

    this.store.updateTicker(
      { id: update.instId },
      {
        bid: parseFloat(update.bidPx),
        ask: parseFloat(update.askPx),
        last,
        mark: last,
        index: last,
        percentage,
        volume: parseFloat(update.volCcy24h),
        quoteVolume: parseFloat(update.vol24h),
      }
    );
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    if (!market) return () => {};

    let timeoutId: NodeJS.Timeout | null = null;

    const topic = {
      channel: `candle${opts.interval}`,
      instId: market.id,
    };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers.candle = ({ data: [c] }: Data) => {
            callback({
              timestamp: parseInt(c[0], 10),
              open: parseFloat(c[1]),
              high: parseFloat(c[2]),
              low: parseFloat(c[3]),
              close: parseFloat(c[4]),
              volume: parseFloat(c[7]),
            });
          };

          this.ws?.send?.(JSON.stringify({ op: 'subscribe', args: [topic] }));
          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers.candle;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    const market = this.store.markets.find((m) => m.symbol === symbol);
    if (!market) return () => {};

    let timeoutId: NodeJS.Timeout | null = null;
    const sides = ['bids', 'asks'] as const;
    const orderBook: OrderBook = { bids: [], asks: [] };
    const topic = { channel: 'books', instId: market.id };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers.books = (data: Data) => {
            if (data.action === 'snapshot') {
              const {
                data: [snapshot],
              } = data;

              sides.forEach((side) => {
                orderBook[side] = snapshot[side].reduce(
                  (acc: OrderBookOrders[], [price, amount]: string[]) => {
                    if (parseFloat(amount) === 0) return acc;
                    return [
                      ...acc,
                      {
                        price: parseFloat(price),
                        amount: multiply(
                          parseFloat(amount),
                          market.precision.amount
                        ),
                      },
                    ];
                  },
                  []
                );
              });
            }

            if (data.action === 'update') {
              const {
                data: [update],
              } = data;

              sides.forEach((side) => {
                for (const [rPrice, rAmount] of update[side]) {
                  const price = parseFloat(rPrice);
                  const amount = parseFloat(rAmount);

                  const index = orderBook[side].findIndex(
                    (b) => b.price === price
                  );

                  if (amount === 0 && index !== -1) {
                    orderBook[side].splice(index, 1);
                    return;
                  }

                  if (amount !== 0) {
                    if (index === -1) {
                      orderBook[side].push({
                        price,
                        amount: multiply(amount, market.precision.amount),
                        total: 0,
                      });
                      return;
                    }

                    orderBook[side][index].amount = multiply(
                      amount,
                      market.precision.amount
                    );
                  }
                }
              });
            }

            sortOrderBook(orderBook);
            calcOrderBookTotal(orderBook);

            callback(orderBook);
          };

          const payload = JSON.stringify({ op: 'subscribe', args: [topic] });
          this.ws?.send?.(payload);
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      orderBook.bids = [];
      orderBook.asks = [];

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };
}
