import { BaseWebSocket } from '../base.ws';

import type { Woo } from './woo.exchange';
import { BASE_WS_URL } from './woo.types';

export class WooPublicWebsocket extends BaseWebSocket<Woo> {
  constructor(parent: Woo) {
    super(parent);
    this.connectAndSubscribe();
  }

  connectAndSubscribe = () => {
    if (!this.parent.isDisposed) {
      const baseURL =
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet'];

      this.ws = new WebSocket(`${baseURL}${this.parent.options.applicationId}`);

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    this.ws?.send?.(JSON.stringify({ event: 'subscribe', topic: 'tickers' }));
    this.ws?.send?.(JSON.stringify({ event: 'subscribe', topic: 'bbos' }));
    this.ws?.send?.(
      JSON.stringify({ event: 'subscribe', topic: 'markprices' })
    );
  };

  onMessage = ({ data }: MessageEvent) => {
    const json = JSON.parse(data);

    if (json.event === 'ping') {
      this.ws?.send?.(JSON.stringify({ event: 'pong' }));
    }

    if (json.topic === 'tickers') {
      this.handleTickersStreamEvents(json.data);
    }

    if (json.topic === 'bbos') {
      this.handleBBOStreamEvents(json.data);
    }

    if (json.topic === 'markprices') {
      this.handleMarkPricesStreamEvents(json.data);
    }
  };

  handleTickersStreamEvents = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      if (row.symbol.startsWith('PERP_')) {
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === row.symbol
        );

        if (ticker) {
          ticker.last = row.close;
          ticker.quoteVolume = row.volume;
          ticker.volume = row.amount;
        }
      }
    });
  };

  handleBBOStreamEvents = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      if (row.symbol.startsWith('PERP_')) {
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === row.symbol
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
        const ticker = this.parent.store.tickers.find(
          (t) => t.symbol === row.symbol
        );

        if (ticker) {
          ticker.mark = row.price;
        }
      }
    });
  };
}
