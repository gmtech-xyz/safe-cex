import createHmac from 'create-hmac';
import { multiply } from 'lodash';

import { OrderSide } from '../../types';
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
      this.ping();
      this.subscribe();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      const time = virtualClock.getCurrentTime().unix();
      const payload = { time, channel: 'futures.ping' };
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify(payload));
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (data.includes('futures.pong')) {
        this.handlePongEvent();
        return;
      }

      if (data.includes('"event":"update"')) {
        if (data.includes('"channel":"futures.orders"')) {
          this.handleOrdersUpdate(JSON.parse(data));
          return;
        }
        if (data.includes('"channel":"futures.autoorders"')) {
          this.handleAlgoOrdersUpdate(JSON.parse(data));
        }
      }
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

  handleOrdersUpdate = ({ result }: Record<string, any>) => {
    result.forEach((order: Record<string, any>) => {
      if (order.finish_as === 'cancelled' || order.finish_as === 'succeeded') {
        this.store.removeOrder({ id: `${order.id}` });
        return;
      }

      if (order.finish_as === '_new') {
        this.store.addOrUpdateOrders(this.parent.mapOrders([order]));
      }

      if (order.finish_as === 'filled') {
        const market = this.parent.store.markets.find(
          (m) => m.id === order.contract
        );

        if (market) {
          this.emitter.emit('fill', {
            side: parseFloat(order.size) > 0 ? OrderSide.Buy : OrderSide.Sell,
            symbol: order.contract.replace('_', ''),
            price: parseFloat(order.fill_price),
            amount: multiply(
              Math.abs(parseFloat(order.size)),
              market.precision.amount
            ),
          });
        }
      }
    });
  };

  handleAlgoOrdersUpdate = ({ result }: Record<string, any>) => {
    result.forEach((order: Record<string, any>) => {
      if (order.finish_as === 'cancelled' || order.finish_as === 'succeeded') {
        this.store.removeOrder({ id: `${order.id}` });
      }

      if (order.finish_as === '') {
        this.store.addOrUpdateOrders(this.parent.mapAlgoOrders([order]));
      }

      if (order.finish_as === 'succeeded') {
        const market = this.parent.store.markets.find(
          (m) => m.id === order.contract
        );

        if (market) {
          this.emitter.emit('fill', {
            side: parseFloat(order.size) > 0 ? OrderSide.Buy : OrderSide.Sell,
            symbol: order.contract.replace('_', ''),
            price: 0,
            amount: multiply(
              Math.abs(parseFloat(order.size)),
              market.precision.amount
            ),
          });
        }
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
    this.ws?.send?.(
      JSON.stringify({
        time,
        channel: 'futures.autoorders',
        event: 'subscribe',
        payload: [`${this.userId}`, '!all'],
        auth: this.generateSignature({ channel: 'futures.autoorders', time }),
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
