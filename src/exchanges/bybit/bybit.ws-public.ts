import flatten from 'lodash/flatten';

import type {
  Candle,
  OHLCVOptions,
  OrderBook,
  Ticker,
  Writable,
} from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { calcOrderBookTotal, sortOrderBook } from '../../utils/orderbook';
import { BaseWebSocket } from '../base.ws';

import type { BybitExchange } from './bybit.exchange';
import { BASE_WS_URL, INTERVAL } from './bybit.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

type SubscribedTopics = {
  [id: string]: string[] | string;
};

export class BybitPublicWebsocket extends BaseWebSocket<BybitExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {
    tickers: (d: Data) => this.handleTickersEvent(d),
    pong: () => this.handlePongEvent(),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      // add instrument_info topics to subscribe on
      this.topics.tickers = this.parent.store.markets.map(
        (m) => `tickers.${m.symbol}`
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
          const json = jsonParse(data);
          if (json) handler(json);
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

  handleTickersEvent = (json: Record<string, any>) => {
    const d = json.data;
    const ticker = this.parent.store.tickers.find(
      (t) => t.symbol === d?.symbol
    );

    if (ticker) {
      const update: Partial<Writable<Ticker>> = {};

      if (d.bid1Price) update.bid = parseFloat(d.bid1Price);
      if (d.ask1Price) update.ask = parseFloat(d.ask1Price);
      if (d.lastPrice) update.last = parseFloat(d.lastPrice);
      if (d.markPrice) update.mark = parseFloat(d.markPrice);
      if (d.indexPrice) update.index = parseFloat(d.indexPrice);

      if (d.price24hPcnt) {
        update.percentage = parseFloat(d.price24hPcnt) * 100;
      }

      if (d.openInterest) {
        update.openInterest = parseFloat(d.openInterest);
      }

      if (d.fundingRate) {
        update.fundingRate = parseFloat(d.fundingRate);
      }

      if (d.volume24h) {
        update.volume = parseFloat(d.volume24h);
      }

      if (d.turnover24h) {
        update.quoteVolume = parseFloat(d.turnover24h);
      }

      this.parent.store.updateTicker(ticker, update);
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const topic = `kline.${INTERVAL[opts.interval]}.${opts.symbol}`;

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = ({ data: [candle] }: Data) => {
            callback({
              timestamp: candle.start / 1000,
              open: parseFloat(candle.open),
              high: parseFloat(candle.high),
              low: parseFloat(candle.low),
              close: parseFloat(candle.close),
              volume: parseFloat(candle.turnover),
            });
          };

          const payload = { op: 'subscribe', args: [topic] };
          this.ws?.send?.(JSON.stringify(payload));
          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);

          // store subscribed topic to re-subscribe on reconnect
          this.topics[topic] = topic;
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topic];
      delete this.topics[topic];

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
    let timeoutId: NodeJS.Timeout | null = null;

    const topic = `orderbook.500.${symbol}`;
    const orderBook: OrderBook = { bids: [], asks: [] };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = (data: Data) => {
            if (data.type === 'snapshot') {
              orderBook.bids = [];
              orderBook.asks = [];

              Object.entries(data.data).forEach(([side, orders]: any) => {
                if (side !== 'a' && side !== 'b') return;

                const key = side === 'a' ? 'asks' : 'bids';
                orders.forEach((order: Data) => {
                  orderBook[key].push({
                    price: parseFloat(order[0]),
                    amount: parseFloat(order[1]),
                    total: 0,
                  });
                });
              });
            }

            if (data.type === 'delta') {
              Object.entries(data.data).forEach(([side, orders]: any) => {
                if (side !== 'a' && side !== 'b') return;

                const key = side === 'a' ? 'asks' : 'bids';
                orders.forEach((order: Data) => {
                  const price = parseFloat(order[0]);
                  const amount = parseFloat(order[1]);

                  const index = orderBook[key].findIndex(
                    (o) => o.price === price
                  );

                  if (index === -1 && amount > 0) {
                    orderBook[key].push({ price, amount, total: 0 });
                    return;
                  }

                  if (amount === 0) {
                    orderBook[key].splice(index, 1);
                    return;
                  }

                  orderBook[key][index].amount = amount;
                });
              });
            }

            sortOrderBook(orderBook);
            calcOrderBookTotal(orderBook);

            callback(orderBook);
          };

          const payload = { op: 'subscribe', args: [topic] };
          this.ws?.send?.(JSON.stringify(payload));

          // store subscribed topic to re-subscribe on reconnect
          this.topics.orderBook = topic;
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topic];
      delete this.topics.orderBook;
      orderBook.asks = [];
      orderBook.bids = [];

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
