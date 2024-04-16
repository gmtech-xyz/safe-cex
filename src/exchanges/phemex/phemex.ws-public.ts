import type { Candle, OHLCVOptions } from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { roundUSD } from '../../utils/round-usd';
import { BaseWebSocket } from '../base.ws';

import type { PhemexExchange } from './phemex.exchange';
import { BASE_WSS_URL, INTERVAL } from './phemex.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};
type SubscribedTopics = {
  [id: string]: { method: string; params: any[] };
};

export class PhemexPublicWebsocket extends BaseWebSocket<PhemexExchange> {
  id = 0;

  topics: SubscribedTopics = {
    tickers: { method: 'perp_market24h_pack_p.subscribe', params: [] },
  };

  messageHandlers: MessageHandlers = {
    'perp_market24h_pack_p.update': (d: Data) => this.handleTickerEvents(d),
  };

  get endpoint() {
    if (this.parent.options.testnet) {
      return (
        this.parent.options.extra?.phemex?.ws?.public?.testnet ||
        BASE_WSS_URL.public.livenet
      );
    }

    return (
      this.parent.options.extra?.phemex?.ws?.public?.livenet ||
      BASE_WSS_URL.public.testnet
    );
  }

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(this.endpoint);
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
      this.ws?.send?.(
        JSON.stringify({ id: this.id++, method: 'server.ping', params: [] })
      );
    }
  };

  subscribe = () => {
    const topics = Object.values(this.topics);

    for (const topic of topics) {
      this.ws?.send?.(
        JSON.stringify({
          id: this.id++,
          method: topic.method,
          params: topic.params,
        })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (data.includes('result":"pong"')) {
      this.handlePongEvent();
      return;
    }

    if (data.includes('method":"perp_market24h_pack_p.update"')) {
      const json = jsonParse(data);
      if (json) this.handleTickerEvents(json);
      return;
    }

    if (data.includes('kline_p') && data.includes('incremental')) {
      const json = jsonParse(data);

      if (json) {
        const topicAsString = JSON.stringify({
          method: 'kline_p.subscribe',
          params: [json.symbol, json.kline_p[0][1]],
        });

        if (topicAsString in this.messageHandlers) {
          this.messageHandlers[topicAsString](json);
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

  handleTickerEvents = ({ data }: Data) => {
    for (const update of data) {
      const [
        symbol,
        openRp,
        ,
        ,
        lastRp,
        volumeRq,
        turnoverRv,
        openInterestRv,
        ,
        markRp,
        fundingRateRr,
      ] = update;

      const open = parseFloat(openRp);
      const last = parseFloat(lastRp);
      const percentage = roundUSD(((last - open) / open) * 100);

      this.store.updateTicker(
        { id: symbol },
        {
          last,
          percentage,
          mark: parseFloat(markRp),
          volume: parseFloat(volumeRq),
          quoteVolume: parseFloat(turnoverRv),
          openInterest: parseFloat(openInterestRv),
          fundingRate: parseFloat(fundingRateRr),
        }
      );
    }
  };

  listenOHLCV = (opts: OHLCVOptions, callback: (candle: Candle) => void) => {
    let timeoutId: NodeJS.Timeout | null = null;

    const interval = INTERVAL[opts.interval];
    const topic = {
      method: 'kline_p.subscribe',
      params: [opts.symbol, interval],
    };

    const topicAsString = JSON.stringify(topic);

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers[topicAsString] = (data: Data) => {
            const candle = data.kline_p[0];

            if (candle) {
              callback({
                timestamp: candle[0],
                open: parseFloat(candle[3]),
                high: parseFloat(candle[4]),
                low: parseFloat(candle[5]),
                close: parseFloat(candle[6]),
                volume: parseFloat(candle[8]),
              });
            }
          };

          this.ws?.send?.(
            JSON.stringify({
              id: this.id++,
              method: topic.method,
              params: topic.params,
            })
          );

          this.parent.log(`Switched to [${opts.symbol}:${opts.interval}]`);
          this.topics[topicAsString] = topic;
        }
      } else {
        timeoutId = setTimeout(waitForConnectedAndSubscribe, 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers[topicAsString];
      delete this.topics[topicAsString];

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        this.ws?.send?.(
          JSON.stringify({
            id: this.id++,
            method: 'kline_p.unsubscribe',
            params: [opts.symbol],
          })
        );
      }
    };
  };
}
