import flatten from 'lodash/flatten';

import type { Candle, OHLCVOptions } from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { BaseWebSocket } from '../base.ws';

import type { OKXExchange } from './okx.exchange';
import { BASE_WS_URL, INTERVAL } from './okx.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};
type SubscribedTopics = {
  [id: string]: Array<{ channel: string; instId: string }>;
};

export class OKXPublicCandlesWebsocket extends BaseWebSocket<OKXExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {};

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL.public_candles[
          this.parent.options.testnet ? 'testnet' : 'livenet'
        ]
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
      this.ws?.send?.('ping');
    }
  };

  subscribe = () => {
    const topics = flatten(Object.values(this.topics));
    const payload = { op: 'subscribe', args: topics };
    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (data === 'pong') {
        this.handlePongEvent();
        return;
      }

      for (const [channel, handler] of Object.entries(this.messageHandlers)) {
        if (
          data.includes(`channel":"${channel}`) &&
          !data.includes('event":"subscribe"')
        ) {
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

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (!this.store.loaded.markets) {
      timeoutId = setTimeout(() => this.listenOHLCV(opts, callback), 100);

      return () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
    }

    const market = this.store.markets.find((m) => m.symbol === opts.symbol);
    if (!market) return () => {};

    const topic = {
      channel: `candle${INTERVAL[opts.interval]}`,
      instId: market.id,
    };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers.candle = (data: Data) => {
            const arg = data?.arg;
            const candle = data?.data?.[0];

            if (
              candle &&
              arg.instId === topic.instId &&
              arg.channel === topic.channel
            ) {
              callback({
                timestamp: parseInt(candle[0], 10) / 1000,
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[7]),
              });
            }
          };

          this.ws?.send?.(JSON.stringify({ op: 'subscribe', args: [topic] }));
          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);

          // store the topic so we can unsubscribe later
          this.topics.candle = [topic];
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers.candle;
      delete this.topics.candle;

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
