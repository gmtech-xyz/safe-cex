import { groupBy } from 'lodash';

import { v } from '../../utils/get-key';

import type { Binance } from './binance.exchange';
import { BASE_WS_URL } from './binance.types';

export class BinancePublicWebsocket {
  ws?: WebSocket;
  parent: Binance;

  constructor(parent: Binance) {
    this.parent = parent;
    this.connectAndSubscribe();
  }

  connectAndSubscribe = () => {
    this.ws = new WebSocket(
      BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet']
    );

    this.ws.addEventListener('open', this.onOpen);
    this.ws.addEventListener('message', this.onMessage);
    this.ws.addEventListener('close', this.onClose);
  };

  onOpen = () => {
    const payload = {
      method: 'SUBSCRIBE',
      params: ['!ticker@arr', '!bookTicker', '!markPrice@arr@1s'],
    };

    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.parent.isDisposed) {
      const json = JSON.parse(data);
      const events = groupBy(Array.isArray(json) ? json : [json], 'e');
      this.handleTickerStreamEvents(events['24hrTicker'] || []);
      this.handleBookTickersStreamEvents(events.bookTicker || []);
      this.handleMarkPriceStreamEvents(events.markPriceUpdate || []);
    }
  };

  onClose = () => {
    this.ws?.removeEventListener?.('open', this.onOpen);
    this.ws?.removeEventListener?.('message', this.onMessage);
    this.ws?.removeEventListener?.('close', this.onClose);
    this.ws = undefined;

    if (!this.parent.isDisposed) {
      this.connectAndSubscribe();
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

  dispose = () => {
    this.ws?.close?.();
  };
}
