import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { GateExchange } from './gate.exchange';
import { BASE_WS_URL } from './gate.types';

type SubscribedTopics = Array<Record<string, any>>;

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};

export class GatePublicWebsocket extends BaseWebSocket<GateExchange> {
  topics: SubscribedTopics = [];
  messageHandlers: MessageHandlers = {
    tickers: (d: Data) => this.handleTickerEvents(d),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.topics.push({
        channel: 'futures.tickers',
        payload: this.store.markets.map((m) => m.id),
      });
    }

    this.ws?.addEventListener('open', this.onOpen);
    this.ws?.addEventListener('message', this.onMessage);
    this.ws?.addEventListener('close', this.onClose);
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.subscribe();
    }
  };

  subscribe = () => {
    for (const topic of this.topics) {
      this.ws?.send(
        JSON.stringify({
          ...topic,
          event: 'subscribe',
          time: virtualClock.getCurrentTime().valueOf(),
        })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
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

  handleTickerEvents = ({ result }: Data) => {
    const tickers = this.parent.mapTickers(result);
    this.store.addOrUpdateTickers(tickers);
  };
}
