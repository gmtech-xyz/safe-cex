import BigNumber from 'bignumber.js';
import { flatten } from 'lodash';

import type { Candle, OHLCVOptions, OrderBook } from '../../types';
import { BaseWebSocket } from '../base.ws';

import type { Bybit } from './bybit.exchange';
import { BASE_WS_URL, INTERVAL } from './bybit.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

type SubscribedTopics = {
  [id: string]: string[] | string;
};

export class BybitPublicWebsocket extends BaseWebSocket<Bybit> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {
    instrument_info: (d: Data) => this.handleInstrumentInfoEvents(d),
    pong: () => this.handlePongEvent(),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      // add instrument_info topics to subscribe on
      this.topics.instrumentInfos = this.parent.store.markets.map(
        (m) => `instrument_info.100ms.${m.symbol}`
      );

      this.ws = new WebSocket(
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.subscribe();
      this.ping();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify({ op: 'ping' }));
    }
  };

  subscribe = () => {
    const topics = flatten(Object.values(this.topics));
    const payload = { op: 'subscribe', args: topics };
    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      const handlers = Object.entries(this.messageHandlers);

      for (const [topic, handler] of handlers) {
        if (data.includes(`topic":"${topic}`)) {
          handler(JSON.parse(data));
          break;
        }
      }
    }
  };

  handlePongEvent = () => {
    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId);
      this.pingTimeoutId = undefined;
    }

    this.pingTimeoutId = setTimeout(() => this.ping(), 10_000);
  };

  handleInstrumentInfoEvents = (json: Record<string, any>) => {
    const d = json?.data?.update?.[0];
    const ticker = this.parent.store.tickers.find(
      (t) => t.symbol === d?.symbol
    );

    if (ticker) {
      if (d.bid1_price) ticker.bid = parseFloat(d.bid1_price);
      if (d.ask1_price) ticker.ask = parseFloat(d.ask1_price);
      if (d.last_price) ticker.last = parseFloat(d.last_price);
      if (d.mark_price) ticker.mark = parseFloat(d.mark_price);
      if (d.index_price) ticker.index = parseFloat(d.index_price);

      if (d.price_24h_pcnt_e6) {
        ticker.percentage = parseFloat(d.price_24h_pcnt_e6) / 10e3;
      }

      if (d.open_interest_e8) {
        ticker.openInterest = parseFloat(d.open_interest_e8) / 10e7;
      }

      if (d.funding_rate_e6) {
        ticker.fundingRate = parseFloat(d.funding_rate_e6) / 10e5;
      }

      if (d.volume_24h_e8) {
        ticker.volume = parseFloat(d.volume_24h_e8) / 10e7;
      }

      if (d.last_price || d.volume_24h_e8) {
        ticker.quoteVolume = ticker.volume * ticker.last;
      }
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const topic = `candle.${INTERVAL[opts.interval]}.${opts.symbol}`;

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = ({ data: [candle] }: Data) => {
            callback({
              timestamp: candle.start,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: parseFloat(candle.volume),
            });
          };

          const payload = { op: 'subscribe', args: [topic] };
          this.ws?.send?.(JSON.stringify(payload));
          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);

          // store subscribed topic to re-subscribe on reconnect
          this.topics.ohlcv = topic;
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      if (this.isConnected) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }

      delete this.messageHandlers[topic];
      delete this.topics.ohlcv;
    };
  };

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    const topic = `orderBook_200.100ms.${symbol}`;

    const orderBook: OrderBook = {
      bids: [],
      asks: [],
    };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = (data: Data) => {
            if (data.type === 'snapshot') {
              orderBook.bids = [];
              orderBook.asks = [];
              data.data.order_book.forEach((order: Data) => {
                const key = order.side === 'Buy' ? 'bids' : 'asks';
                orderBook[key].push({
                  price: parseFloat(order.price),
                  amount: order.size,
                  total: 0,
                });
              });
            }

            if (data.type === 'delta') {
              const toDelete = data.data.delete || [];
              const toUpdate = data.data.update || [];
              const toInsert = data.data.insert || [];

              toDelete.forEach((order: Data) => {
                const key = order.side === 'Buy' ? 'bids' : 'asks';
                const index = orderBook[key].findIndex(
                  (o) => o.price === parseFloat(order.price)
                );

                if (index > -1) orderBook[key].splice(index, 1);
              });

              toUpdate.forEach((order: Data) => {
                const key = order.side === 'Buy' ? 'bids' : 'asks';
                const index = orderBook[key].findIndex(
                  (o) => o.price === parseFloat(order.price)
                );

                if (index > -1) orderBook[key][index].amount = order.size;
              });

              toInsert.forEach((order: Data) => {
                const key = order.side === 'Buy' ? 'bids' : 'asks';
                orderBook[key].push({
                  price: parseFloat(order.price),
                  amount: order.size,
                  total: 0,
                });
              });
            }

            orderBook.asks.sort((a, b) => a.price - b.price);
            orderBook.bids.sort((a, b) => b.price - a.price);

            orderBook.asks.forEach((ask, idx) => {
              orderBook.asks[idx].total =
                idx === 0
                  ? ask.amount
                  : new BigNumber(ask.amount)
                      .plus(orderBook.asks[idx - 1].total)
                      .toNumber();
            });

            orderBook.bids.forEach((ask, idx) => {
              orderBook.bids[idx].total =
                idx === 0
                  ? ask.amount
                  : new BigNumber(ask.amount)
                      .plus(orderBook.bids[idx - 1].total)
                      .toNumber();
            });

            callback(orderBook);
          };

          const payload = { op: 'subscribe', args: [topic] };
          this.ws?.send?.(JSON.stringify(payload));

          // store subscribed topic to re-subscribe on reconnect
          this.topics.orderBook = topic;
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      if (this.isConnected) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }

      delete this.messageHandlers[topic];
      delete this.topics.orderBook;

      orderBook.asks = [];
      orderBook.bids = [];
    };
  };
}
