import flatten from 'lodash/flatten';

import type { Candle, OHLCVOptions } from '../../types';
import { roundUSD } from '../../utils/round-usd';
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
    let timeoutId: NodeJS.Timeout | null = null;

    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    if (!market) return () => {};

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
        const payload = { op: 'unsubscribe', args: topic };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };
}
