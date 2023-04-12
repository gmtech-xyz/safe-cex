import type { OHLCVOptions, Candle } from '../../types';
import { BaseWebSocket } from '../base.ws';

import type { Woo } from './woo.exchange';
import { BASE_WS_URL } from './woo.types';
import { normalizeSymbol, reverseSymbol } from './woo.utils';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

export class WooPublicWebsocket extends BaseWebSocket<Woo> {
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
          handler(JSON.parse(data));
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
    this.parent.store.latency = Math.round(diff / 2);

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
          ticker.last = row.close;
          ticker.quoteVolume = row.amount;
          ticker.volume = row.volume;
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
          ticker.bid = row.bid;
          ticker.ask = row.ask;
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
          ticker.mark = row.price;
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
}
