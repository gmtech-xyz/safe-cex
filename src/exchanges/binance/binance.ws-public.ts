import type { OHLCVOptions, Candle } from '../../types';
import { v } from '../../utils/get-key';
import { BaseWebSocket } from '../base.ws';

import type { Binance } from './binance.exchange';
import { BASE_WS_URL } from './binance.types';

type Data = Array<Record<string, any>>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

export class BinancePublicWebsocket extends BaseWebSocket<Binance> {
  messageHandlers: MessageHandlers = {
    '24hrTicker': (d: Data) => this.handleTickerStreamEvents(d),
    bookTicker: (d: Data) => this.handleBookTickersStreamEvents(d),
    markPriceUpdate: (d: Data) => this.handleMarkPriceStreamEvents(d),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
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
      const payload = {
        method: 'SUBSCRIBE',
        params: ['!ticker@arr', '!bookTicker', '!markPrice@arr@1s'],
      };

      this.ws?.send?.(JSON.stringify(payload));
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      const handlers = Object.entries(this.messageHandlers);

      for (const [topic, handler] of handlers) {
        if (data.includes(`e":"${topic}`)) {
          const json = JSON.parse(data);
          handler(Array.isArray(json) ? json : [json]);
          break;
        }
      }
    }
  };

  handleTickerStreamEvents = (events: Array<Record<string, any>>) => {
    events.forEach((event) => {
      const ticker = this.parent.store.tickers.find(
        (t) => t.symbol === event.s
      );

      if (ticker) {
        ticker.last = parseFloat(v(event, 'c'));
        ticker.percentage = parseFloat(v(event, 'P'));
        ticker.volume = parseFloat(v(event, 'v'));
        ticker.quoteVolume = parseFloat(v(event, 'q'));
      }
    });
  };

  handleBookTickersStreamEvents = (events: Array<Record<string, any>>) => {
    events.forEach((event) => {
      const ticker = this.parent.store.tickers.find(
        (t) => t.symbol === event.s
      );

      if (ticker) {
        ticker.bid = parseFloat(v(event, 'b'));
        ticker.ask = parseFloat(v(event, 'a'));
      }
    });
  };

  handleMarkPriceStreamEvents = (events: Array<Record<string, any>>) => {
    events.forEach((event) => {
      const ticker = this.parent.store.tickers.find(
        (t) => t.symbol === event.s
      );

      if (ticker) {
        ticker.mark = parseFloat(v(event, 'p'));
        ticker.index = parseFloat(v(event, 'i'));
        ticker.fundingRate = parseFloat(v(event, 'r'));
      }
    });
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const topic = `${opts.symbol.toLowerCase()}@kline_${opts.interval}`;

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        this.messageHandlers.kline = ([json]: Data) => {
          callback({
            timestamp: json.k.t / 1000,
            open: parseFloat(json.k.o),
            high: parseFloat(json.k.h),
            low: parseFloat(json.k.l),
            close: parseFloat(json.k.c),
            volume: parseFloat(json.k.v),
          });
        };

        const payload = { method: 'SUBSCRIBE', params: [topic], id: 1 };
        this.ws?.send?.(JSON.stringify(payload));
        this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      if (this.isConnected) {
        const payload = { method: 'UNSUBSCRIBE', params: [topic], id: 1 };
        this.ws?.send?.(JSON.stringify(payload));
      }

      delete this.messageHandlers.kline;
    };
  };
}
