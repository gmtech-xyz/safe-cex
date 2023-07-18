import createHmac from 'create-hmac';

import type { Position } from '../../types';
import { v } from '../../utils/get-key';
import { jsonParse } from '../../utils/json-parse';
import { BaseWebSocket } from '../base.ws';

import type { BybitExchange } from './bybit.exchange';
import { BASE_WS_URL } from './bybit.types';

export class BybitPrivateWebsocket extends BaseWebSocket<BybitExchange> {
  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL.private[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.auth();
      this.subscribe();
      this.ping();
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      const json = jsonParse(data);

      if (json?.topic === 'order') {
        this.handleOrderTopic(json.data);
      }

      if (json?.topic === 'position') {
        this.handlePositionTopic(json.data);
      }

      if (json?.op === 'pong') {
        const diff = performance.now() - this.pingAt;
        this.store.update({ latency: Math.round(diff / 2) });

        if (this.pingTimeoutId) {
          clearTimeout(this.pingTimeoutId);
          this.pingTimeoutId = undefined;
        }

        this.pingTimeoutId = setTimeout(() => this.ping(), 10_000);
      }
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(JSON.stringify({ op: 'ping' }));
    }
  };

  handleOrderTopic = (data: Array<Record<string, any>>) => {
    data.forEach((order: Record<string, any>) => {
      const orders = this.parent.mapOrder(order);

      const price = parseFloat(v(order, 'price'));
      const amount = parseFloat(v(order, 'qty'));

      if (order.orderStatus === 'PartiallyFilled') {
        // False positive when order is replaced
        // it emits a partially filled with 0 amount & price
        if (price <= 0 && amount <= 0) return;
      }

      if (
        order.orderStatus === 'Filled' ||
        order.orderStatus === 'PartiallyFilled'
      ) {
        this.emitter.emit('fill', {
          side: orders[0].side,
          symbol: orders[0].symbol,
          price,
          amount,
        });
      }

      if (
        order.orderStatus === 'Cancelled' ||
        order.orderStatus === 'Filled' ||
        order.orderStatus === 'Deactivated'
      ) {
        // We remove the order and its stop loss and take profit
        // if they exists, because they will be replaced with correct IDs
        this.store.removeOrders([
          { id: orders[0].id },
          { id: `${orders[0].id}__stop_loss` },
          { id: `${orders[0].id}__take_profit` },
        ]);
      }

      if (
        order.orderStatus === 'New' ||
        order.orderStatus === 'Untriggered' ||
        order.orderStatus === 'PartiallyFilled'
      ) {
        this.store.addOrUpdateOrders(orders);
      }
    });
  };

  handlePositionTopic = (data: Array<Record<string, any>>) => {
    const positions: Position[] = data.map(this.parent.mapPosition);
    const updates: Array<[Position, Position]> = positions.map((p) => [p, p]);
    this.store.updatePositions(updates);
  };

  private auth = () => {
    const expires = new Date().getTime() + 10_000;
    const signature = createHmac('sha256', this.parent.options.secret)
      .update(`GET/realtime${expires}`)
      .digest('hex');

    const payload = {
      op: 'auth',
      args: [this.parent.options.key, expires.toFixed(0), signature],
    };

    this.ws?.send?.(JSON.stringify(payload));
  };

  private subscribe = () => {
    const payload = { op: 'subscribe', args: ['order', 'position'] };
    this.ws?.send?.(JSON.stringify(payload));
  };
}
