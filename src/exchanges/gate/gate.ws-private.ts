import createHmac from 'create-hmac';

import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { GateExchange } from './gate.exchange';
import { BASE_WS_URL } from './gate.types';

export class GatePrivateWebsocket extends BaseWebSocket<GateExchange> {
  userId?: number;

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

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

  onMessage = ({ data }: MessageEvent) => {
    if (data.includes('"event":"update"')) {
      if (data.includes('"channel":"futures.orders"')) {
        this.handleOrdersUpdate(JSON.parse(data));
      }
    }
  };

  handleOrdersUpdate = ({ result }: Record<string, any>) => {
    console.log(result);

    result.forEach((order: Record<string, any>) => {
      if (order.finish_as === 'cancelled') {
        this.store.removeOrder({ id: `${order.id}` });
        return;
      }

      if (order.finish_as === '_new') {
        this.store.addOrUpdateOrders(this.parent.mapOrders([order]));
      }
    });
  };

  subscribe = () => {
    const time = virtualClock.getCurrentTime().unix();
    this.ws?.send?.(
      JSON.stringify({
        time,
        channel: 'futures.orders',
        event: 'subscribe',
        payload: [`${this.userId}`, '!all'],
        auth: this.generateSignature({ channel: 'futures.orders', time }),
      })
    );
  };

  private generateSignature = ({
    channel,
    time,
  }: {
    channel: string;
    time: number;
  }) => {
    const { key, secret } = this.parent.options;

    const message = `channel=${channel}&event=subscribe&time=${time}`;
    const signature = createHmac('sha512', secret)
      .update(message)
      .digest('hex');

    return { method: 'api_key', KEY: key, SIGN: signature };
  };
}
