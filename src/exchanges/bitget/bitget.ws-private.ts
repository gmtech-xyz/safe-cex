import createHmac from 'create-hmac';

import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { BitgetExchange } from './bitget.exchange';
import { BASE_WS_URL } from './bitget.types';

export class BitgetPrivateWebsocket extends BaseWebSocket<BitgetExchange> {
  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(BASE_WS_URL);
      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.auth();
      this.ping();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.('ping');
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (data === 'pong') {
        this.handlePongEvent();
        return;
      }

      if (data === '{"event":"login","code":0}') {
        this.subscribe();
        return;
      }
    }

    const json = JSON.parse(data);

    if (json.arg.channel === 'orders' && json.event !== 'subscribe') {
      this.handleOrderTopic(json);
      return;
    }

    if (json.arg.channel === 'positions' && json.event !== 'subscribe') {
      //
    }
  };

  handlePongEvent = () => {
    const diff = performance.now() - this.pingAt;
    this.store.update({ latency: Math.round(diff / 2) });

    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId);
      this.pingTimeoutId = undefined;
    }

    this.pingTimeoutId = setTimeout(() => this.ping(), 10_000);
  };

  handleOrderTopic = (data: Record<string, any>) => {
    const [order] = data.data;

    if (order.status === 'cancelled') {
      this.store.removeOrder({ id: order.ordId });
      return;
    }

    if (order.status === 'new') {
      console.log(order);

      this.store.addOrUpdateOrder(this.parent.mapOrder(order));
      return;
    }

    if (order.status === 'filled') {
      //
    }
  };

  private auth = () => {
    const timestamp = virtualClock.getCurrentTime().unix();
    const sign = createHmac('sha256', this.parent.options.secret)
      .update(`${timestamp}GET/user/verify`)
      .digest('base64');

    const payload = {
      op: 'login',
      args: [
        {
          apiKey: this.parent.options.key,
          passphrase: this.parent.options.passphrase,
          timestamp,
          sign,
        },
      ],
    };

    this.ws?.send?.(JSON.stringify(payload));
  };

  private subscribe = () => {
    const payload = {
      op: 'subscribe',
      args: [
        {
          instType: this.parent.apiProductType.toUpperCase(),
          channel: 'account',
          instId: 'default',
        },
        {
          instType: this.parent.apiProductType.toUpperCase(),
          channel: 'positions',
          instId: 'default',
        },
        {
          instType: this.parent.apiProductType.toUpperCase(),
          channel: 'orders',
          instId: 'default',
        },
      ],
    };

    this.ws?.send?.(JSON.stringify(payload));
  };
}
