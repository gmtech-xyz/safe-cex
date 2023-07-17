import type { OHLCVOptions, Candle, OrderBook } from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { calcOrderBookTotal, sortOrderBook } from '../../utils/orderbook';
import { BaseWebSocket } from '../base.ws';

import type { WOOXExchange } from './woo.exchange';
import { BASE_WS_URL, ENDPOINTS } from './woo.types';
import { normalizeSymbol, reverseSymbol } from './woo.utils';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

export class WooPublicWebsocket extends BaseWebSocket<WOOXExchange> {
  messageHandlers: MessageHandlers = {
    ping: () => this.handlePingEvent(),
    pong: () => this.handlePongEvent(),
    tickers: ({ data }: Data) => this.handleTickersStreamEvents(data),
    bbos: ({ data }: Data) => this.handleBBOStreamEvents(data),
    markprices: ({ data }: Data) => this.handleMarkPricesStreamEvents(data),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      const baseURL =
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet'];

      this.ws = new WebSocket(`${baseURL}${this.parent.options.applicationId}`);

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.ping();
      this.ws?.send?.(JSON.stringify({ event: 'subscribe', topic: 'tickers' }));
      this.ws?.send?.(JSON.stringify({ event: 'subscribe', topic: 'bbos' }));
      this.ws?.send?.(
        JSON.stringify({ event: 'subscribe', topic: 'markprices' })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      const handlers = Object.entries(this.messageHandlers);

      for (const [topic, handler] of handlers) {
        if (
          data.includes(`event":"${topic}`) ||
          data.includes(`topic":"${topic}`)
        ) {
          const json = jsonParse(data);
          if (json) handler(json);
          break;
        }
      }
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify({ event: 'ping' }));
    }
  };

  handlePongEvent = () => {
    const diff = performance.now() - this.pingAt;
    this.store.update({ latency: Math.round(diff / 2) });

    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId);
      this.pingTimeoutId = undefined;
    }

    this.pingTimeoutId = setTimeout(() => this.ping(), 10_000);
  };

  handlePingEvent = () => {
    this.ws?.send?.(JSON.stringify({ event: 'pong' }));
  };

  handleTickersStreamEvents = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      if (row.symbol.startsWith('PERP_')) {
        const symbol = normalizeSymbol(row.symbol);
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === symbol
        );

        if (ticker) {
          this.store.updateTicker(ticker, {
            last: row.close,
            quoteVolume: row.amount,
            volume: row.volume,
          });
        }
      }
    });
  };

  handleBBOStreamEvents = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      if (row.symbol.startsWith('PERP_')) {
        const symbol = normalizeSymbol(row.symbol);
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === symbol
        );

        if (ticker) {
          this.store.updateTicker(ticker, {
            bid: row.bid,
            ask: row.ask,
          });
        }
      }
    });
  };

  handleMarkPricesStreamEvents = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      if (row.symbol.startsWith('PERP_')) {
        const symbol = normalizeSymbol(row.symbol);
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === symbol
        );

        if (ticker) {
          this.store.updateTicker(ticker, {
            mark: row.price,
          });
        }
      }
    });
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const topic = `${reverseSymbol(opts.symbol)}@kline_${opts.interval}`;

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = (json: Data) => {
            callback({
              timestamp: json.data.startTime / 1000,
              open: json.data.open,
              high: json.data.high,
              low: json.data.low,
              close: json.data.close,
              volume: json.data.volume,
            });
          };

          const payload = { event: 'subscribe', topic };
          this.ws?.send?.(JSON.stringify(payload));
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topic];

      if (this.isConnected) {
        const payload = { event: 'unsubscribe', topic };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    let timeoutId: NodeJS.Timeout | null = null;

    const topic = `${reverseSymbol(symbol)}@orderbookupdate`;
    const orderBook: OrderBook = { bids: [], asks: [] };
    const innerState = {
      updates: [] as any[],
      isSnapshotLoaded: false,
    };

    const fetchSnapshot = async () => {
      const { data } = await this.parent.xhr.get(
        `${ENDPOINTS.ORDERBOOK}/${reverseSymbol(symbol)}`
      );

      if (!this.isDisposed) {
        orderBook.bids = data.bids.map((row: Record<string, any>) => ({
          price: row.price,
          amount: row.quantity,
          total: 0,
        }));

        orderBook.asks = data.asks.map((row: Record<string, any>) => ({
          price: row.price,
          amount: row.quantity,
          total: 0,
        }));

        // drop events where timestamp is older than the snapshot
        innerState.updates = innerState.updates.filter(
          (update: Record<string, any>) => update.ts > data.timestamp
        );

        // apply all updates
        innerState.updates.forEach((update: Record<string, any>) => {
          this.processOrderBookUpdate(orderBook, update);
        });

        sortOrderBook(orderBook);
        calcOrderBookTotal(orderBook);

        innerState.isSnapshotLoaded = true;
        innerState.updates = [];

        callback(orderBook);
      }
    };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        // 1. subscribe to the topic
        // 2. wait for the first message and send request to snapshot
        // 3. store all incoming updates in an array
        // 4. when the snapshot is received, apply all updates and send the order book to the callback
        // 5. then on each update, apply it to the order book and send it to the callback
        if (!this.isDisposed) {
          this.messageHandlers[topic] = (json: Data) => {
            if (
              !innerState.isSnapshotLoaded &&
              innerState.updates.length === 0
            ) {
              fetchSnapshot();
              innerState.updates = [json];
              return;
            }

            if (!innerState.isSnapshotLoaded) {
              innerState.updates.push(json);
              return;
            }

            // do updates
            this.processOrderBookUpdate(orderBook, json);
            sortOrderBook(orderBook);
            calcOrderBookTotal(orderBook);

            callback(orderBook);
          };

          const payload = { event: 'subscribe', topic };
          this.ws?.send?.(JSON.stringify(payload));
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topic];
      orderBook.asks = [];
      orderBook.bids = [];
      innerState.updates = [];
      innerState.isSnapshotLoaded = false;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        const payload = { event: 'unsubscribe', topic };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };

  private processOrderBookUpdate = (
    orderBook: OrderBook,
    update: Record<string, any>
  ) => {
    const sides = { bids: update.data.bids, asks: update.data.asks };

    Object.entries(sides).forEach(([side, data]) => {
      // we need this for ts compile
      if (side !== 'bids' && side !== 'asks') return;

      data.forEach(([price, amount]: [number, number]) => {
        const index = orderBook[side].findIndex((b) => b.price === price);

        if (index === -1 && amount > 0) {
          orderBook[side].push({ price, amount, total: 0 });
          return;
        }

        if (amount === 0) {
          orderBook[side].splice(index, 1);
          return;
        }

        // eslint-disable-next-line no-param-reassign
        orderBook[side][index].amount = amount;
      });
    });
  };
}
