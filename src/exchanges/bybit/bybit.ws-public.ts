import type { Candle, OHLCVOptions } from '../../types';
import { BaseWebSocket } from '../base.ws';

import type { Bybit } from './bybit.exchange';
import { BASE_WS_URL, INTERVAL } from './bybit.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

export class BybitPublicWebsocket extends BaseWebSocket<Bybit> {
  messageHandlers: MessageHandlers = {
    instrument_info: (d: Data) => this.handleInstrumentInfoEvents(d),
    pong: () => this.handlePongEvent(),
  };

  connectAndSubscribe = () => {
    if (!this.parent.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.parent.isDisposed) {
      this.subscribe();
      this.ping();
    }
  };

  ping = () => {
    if (!this.parent.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify({ op: 'ping' }));
    }
  };

  subscribe = () => {
    const payload = {
      op: 'subscribe',
      args: this.parent.store.markets.map(
        (m) => `instrument_info.100ms.${m.symbol}`
      ),
    };

    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.parent.isDisposed) {
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
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (!this.parent.isDisposed) {
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
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }

      delete this.messageHandlers[topic];
    };
  };
}
