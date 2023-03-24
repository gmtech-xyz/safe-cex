import { subscribe } from 'valtio/vanilla';

import { BaseWebSocket } from '../base.ws';

import type { Bybit } from './bybit.exchange';
import { BASE_WS_URL } from './bybit.types';

export class BybitPublicWebsocket extends BaseWebSocket<Bybit> {
  constructor(parent: Bybit) {
    super(parent);

    // we use this little trick to make sure we connect and subscribe
    // after loaded the markets and tickers first with xhr API
    const unsubscribe = subscribe(this.parent.store.loaded, () => {
      if (
        this.parent.store.loaded.markets &&
        this.parent.store.loaded.tickers
      ) {
        unsubscribe();
        this.connectAndSubscribe();
      }
    });

    if (this.parent.isDisposed) {
      unsubscribe();
    }
  }

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
      const json = JSON.parse(data);

      if (
        json?.topic?.startsWith?.('instrument_info.100ms') &&
        json?.data?.update?.[0]
      ) {
        this.handleInstrumentInfoStreamEvents(json.data.update[0]);
      }
    }
  };

  handleInstrumentInfoStreamEvents = (d: Record<string, any>) => {
    const ticker = this.parent.store.tickers.find((t) => t.symbol === d.symbol);

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
}
