import type { Candle, OHLCVOptions, Ticker, Writable } from '../../types';
import { BaseWebSocket } from '../base.ws';

import type { BitgetExchange } from './bitget.exchange';
import { BASE_WS_URL, INTERVAL } from './bitget.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [topic: string]: (json: Data) => void;
};

type SubscribedTopics = {
  [id: string]: string[];
};

export class BitgetPublicWebsocket extends BaseWebSocket<BitgetExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {};

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.topics.ticker = this.parent.store.markets.map((m) => m.symbol);

      this.ws = new WebSocket(BASE_WS_URL);
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
    const args = Object.entries(this.topics).flatMap(([channel, symbols]) =>
      symbols.map((instId) => ({ instType: 'mc', channel, instId }))
    );

    this.ws?.send?.(JSON.stringify({ op: 'subscribe', args }));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (
        data.includes('"action":"snapshot"') &&
        data.includes('"channel":"ticker"')
      ) {
        this.handleTickerSnapshot(JSON.parse(data));
      }

      if (
        data.includes('"action":"update"') &&
        data.includes('"channel":"candle')
      ) {
        const json = JSON.parse(data);

        const interval = json.arg.channel.replace('candle', '');
        const topic = `candle_${json.arg.instId}_${interval}`;

        if (this.messageHandlers[topic]) {
          this.messageHandlers[topic](json);
        }
      }
    }
  };

  handleTickerSnapshot = (json: Record<string, any>) => {
    const [data] = json.data;
    const ticker = this.parent.store.tickers.find(
      (t) => t.symbol === data.instId
    );

    if (ticker) {
      const update: Partial<Writable<Ticker>> = {
        bid: parseFloat(data.bestBid),
        ask: parseFloat(data.bestAsk),
        last: parseFloat(data.last),
        index: parseFloat(data.indexPrice),
        percentage: parseFloat(data.chgUTC) * 100,
        fundingRate: parseFloat(data.fundingRate),
        volume: parseFloat(data.baseVolume),
        quoteVolume: parseFloat(data.quoteVolume),
      };

      this.parent.store.updateTicker(ticker, update);
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    const interval = INTERVAL[opts.interval];
    const topic = `candle_${opts.symbol}_${interval}`;

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topic] = ({ data: [c] }: Data) => {
            const candle: Candle = {
              timestamp: c[0],
              open: parseFloat(c[1]),
              high: parseFloat(c[2]),
              low: parseFloat(c[3]),
              close: parseFloat(c[4]),
              volume: parseFloat(c[6]),
            };
            callback(candle);
          };

          const payload = {
            op: 'subscribe',
            args: [
              {
                instType: 'mc',
                channel: `candle${interval}`,
                instId: opts.symbol,
              },
            ],
          };

          this.ws?.send?.(JSON.stringify(payload));
          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);
        }
      } else {
        setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topic];

      if (this.isConnected) {
        this.ws?.send?.(
          JSON.stringify({
            op: 'unsubscribe',
            args: [
              {
                instType: 'mc',
                channel: `candle${interval}`,
                instId: opts.symbol,
              },
            ],
          })
        );
      }
    };
  };
}
