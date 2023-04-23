import type { OHLCVOptions, Candle } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { GateExchange } from './gate.exchange';
import { BASE_WS_URL } from './gate.types';

type SubscribedTopics = {
  [id: string]: Record<string, any>;
};

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};

export class GatePublicWebsocket extends BaseWebSocket<GateExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {
    tickers: (d: Data) => this.handleTickerEvents(d),
  };

  get time() {
    return virtualClock.getCurrentTime().valueOf();
  }

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.topics.tickers = {
        channel: 'futures.tickers',
        payload: this.store.markets.map((m) => m.id),
      };
    }

    this.ws?.addEventListener('open', this.onOpen);
    this.ws?.addEventListener('message', this.onMessage);
    this.ws?.addEventListener('close', this.onClose);
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.ping();
      this.subscribe();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      const time = virtualClock.getCurrentTime().unix();
      const payload = { time, channel: 'futures.ping' };
      this.ws?.send?.(JSON.stringify(payload));
    }
  };

  subscribe = () => {
    for (const topic of Object.values(this.topics)) {
      this.ws?.send(
        JSON.stringify({
          ...topic,
          event: 'subscribe',
          time: this.time,
        })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (data.includes('futures.pong')) {
        this.handlePongEvent();
        return;
      }

      for (const [channel, handler] of Object.entries(this.messageHandlers)) {
        if (
          data.includes(`"channel":"futures.${channel}"`) &&
          data.includes(`"event":"update"`)
        ) {
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

  handleTickerEvents = ({ result }: Data) => {
    const tickers = this.parent.mapTickers(result);
    this.store.addOrUpdateTickers(tickers);
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    let timeoutId: NodeJS.Timeout | null = null;

    const topic = {
      channel: 'futures.candlesticks',
      payload: [opts.interval, opts.symbol.replace(/USDT$/, '_USDT')],
    };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers.candlesticks = ({ result: [c] }: Data) => {
            callback({
              timestamp: c.t,
              open: parseFloat(c.o),
              high: parseFloat(c.h),
              low: parseFloat(c.l),
              close: parseFloat(c.c),
              volume: parseFloat(c.v),
            });
          };

          const payload = { ...topic, event: 'subscribe', time: this.time };
          this.ws?.send?.(JSON.stringify(payload));
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers.candlesticks;
      delete this.topics.candlesticks;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        const payload = { ...topic, time: this.time, event: 'unsubscribe' };
        this.ws?.send(JSON.stringify(payload));
      }
    };
  };
}
