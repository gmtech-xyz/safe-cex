import type { OHLCVOptions, Candle } from '../types';
import { createWebSocket } from '../utils/universal-ws';

import { BaseExchange } from './base';

export class BaseBinanceExchange extends BaseExchange {
  _fetchOHLCV = async (endpoint: string, opts: OHLCVOptions) => {
    const { data } = await this.xhr.get<any[][]>(endpoint, {
      params: {
        symbol: opts.symbol,
        interval: opts.interval,
        limit: 500,
      },
    });

    const candles: Candle[] = data.map(
      ([time, open, high, low, close, volume]) => {
        return {
          timestamp: time / 1000,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseFloat(volume),
        };
      }
    );

    return candles;
  };

  _listenOHLCV = (
    endpoint: string,
    opts: OHLCVOptions,
    callback: (candle: Candle) => void
  ) => {
    const subscribe = () => {
      if (!this.isDisposed) {
        const topic = `${opts.symbol.toLowerCase()}@kline_${opts.interval}`;
        const payload = { method: 'SUBSCRIBE', params: [topic], id: 1 };
        this.wsPublic?.send?.(JSON.stringify(payload));
        this.log(`Switched to [${opts.symbol}:${opts.interval}]`);
      }
    };

    const handleMessage = ({ data }: MessageEvent) => {
      if (!this.isDisposed) {
        const json = JSON.parse(data);

        if (json.s === opts.symbol && json.e === 'kline') {
          const candle: Candle = {
            timestamp: json.k.t / 1000,
            open: parseFloat(json.k.o),
            high: parseFloat(json.k.h),
            low: parseFloat(json.k.l),
            close: parseFloat(json.k.c),
            volume: parseFloat(json.k.v),
          };

          callback(candle);
        }
      }
    };

    const connect = () => {
      if (!this.isDisposed) {
        if (this.wsPublic) {
          this.wsPublic.close();
          this.wsPublic = undefined;
        }

        this.wsPublic = createWebSocket(endpoint);

        this.wsPublic.on('open', () => subscribe());
        this.wsPublic.on('message', handleMessage);
      }
    };

    const dispose = () => {
      if (this.wsPublic) {
        this.wsPublic.off('message', handleMessage);
        this.wsPublic = undefined;
      }
    };

    connect();

    return dispose;
  };
}
