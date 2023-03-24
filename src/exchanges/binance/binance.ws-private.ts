import { OrderStatus } from '../../types';
import { BaseWebSocket } from '../base.ws';

import type { Binance } from './binance.exchange';
import {
  BASE_WS_URL,
  ENDPOINTS,
  ORDER_SIDE,
  ORDER_TYPE,
  POSITION_SIDE,
} from './binance.types';

export class BinancePrivateWebsocket extends BaseWebSocket<Binance> {
  constructor(parent: Binance) {
    super(parent);
    this.connectAndSubscribe();
  }

  connectAndSubscribe = async () => {
    const listenKey = await this.fetchListenKey();

    const key = this.parent.options.testnet ? 'testnet' : 'livenet';
    const base = BASE_WS_URL.private[key];

    const url = this.parent.options.testnet
      ? `${base}/${listenKey}`
      : `${base}/${listenKey}?listenKey=${listenKey}`;

    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', this.onMessage);
    this.ws.addEventListener('close', this.onClose);
    this.ws.addEventListener('open', this.onOpen);
  };

  onOpen = () => {
    this.ping();
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.parent.isDisposed) {
      const json = JSON.parse(data);

      if (json.e === 'ACCOUNT_UPDATE') this.handleAccountEvents([json]);
      if (json.e === 'ORDER_TRADE_UPDATE') this.handleOrderEvents([json]);

      if (json.id === 42) {
        const diff = performance.now() - this.pingAt;
        this.parent.store.latency = Math.round(diff / 2);
        setTimeout(() => this.ping(), 10_000);
      }
    }
  };

  ping = () => {
    if (!this.parent.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify({ id: 42, method: 'LIST_SUBSCRIPTIONS' }));
    }
  };

  handleOrderEvents = (events: Array<Record<string, any>>) => {
    events.forEach(({ o: data }) => {
      if (data.X === 'PARTIALLY_FILLED' || data.X === 'FILLED') {
        this.parent.emitter.emit('fill', {
          side: ORDER_SIDE[data.S],
          symbol: data.s,
          price: parseFloat(data.ap),
          amount: parseFloat(data.l),
        });
      }

      if (data.X === 'NEW') {
        this.parent.addOrReplaceOrderFromStore({
          id: data.c,
          status: OrderStatus.Open,
          symbol: data.s,
          type: ORDER_TYPE[data.ot],
          side: ORDER_SIDE[data.S],
          price: parseFloat(data.p) || parseFloat(data.sp),
          amount: parseFloat(data.q),
          filled: parseFloat(data.z),
          remaining: parseFloat(data.q) - parseFloat(data.z),
          reduceOnly: data.R || false,
        });
      }

      if (data.X === 'CANCELED' || data.X === 'FILLED') {
        this.parent.removeOrderFromStore(data.c);
      }
    });
  };

  handleAccountEvents = (events: Array<Record<string, any>>) => {
    events.forEach((event) =>
      event.a.B.forEach((p: Record<string, any>) => {
        const symbol = p.s;
        const side = POSITION_SIDE[p.ps];

        const position = this.parent.store.positions.find(
          (p2) => p2.symbol === symbol && p2.side === side
        );

        if (position) {
          const entryPrice = parseFloat(p.ep);
          const contracts = parseFloat(p.pa);
          const upnl = parseFloat(p.up);

          position.entryPrice = entryPrice;
          position.contracts = contracts;
          position.notional = contracts * entryPrice + upnl;
          position.unrealizedPnl = upnl;
        }
      })
    );
  };

  private fetchListenKey = async () => {
    const { data } = await this.parent.xhr.post(ENDPOINTS.LISTEN_KEY);
    setTimeout(() => this.updateListenKey(), 30 * 60 * 1000);
    return data.listenKey;
  };

  private updateListenKey = async () => {
    if (!this.parent.isDisposed) {
      await this.parent.xhr.put(ENDPOINTS.LISTEN_KEY);
      setTimeout(() => this.updateListenKey(), 30 * 60 * 1000);
    }
  };
}
