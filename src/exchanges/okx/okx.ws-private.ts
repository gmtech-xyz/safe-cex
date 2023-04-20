import createHmac from 'create-hmac';
import { sumBy } from 'lodash';

import { roundUSD } from '../../utils/round-usd';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { OKXExchange } from './okx.exchange';
import { BASE_WS_URL } from './okx.types';

export class OKXPrivateWebsocket extends BaseWebSocket<OKXExchange> {
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
      this.ping();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.('ping');
    }
  };

  auth = () => {
    const timestamp = virtualClock.getCurrentTime().unix();
    const signature = createHmac('sha256', this.parent.options.secret)
      .update([timestamp, 'GET', '/users/self/verify'].join(''))
      .digest('base64');

    this.ws?.send?.(
      JSON.stringify({
        op: 'login',
        args: [
          {
            apiKey: this.parent.options.key,
            passphrase: this.parent.options.passphrase,
            timestamp,
            sign: signature,
          },
        ],
      })
    );
  };

  subscribe = () => {
    this.ws?.send?.(
      JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'orders', instType: 'SWAP' },
          { channel: 'orders-algo', instType: 'SWAP' },
          { channel: 'algo-advance', instType: 'SWAP' },
          { channel: 'positions', instType: 'SWAP' },
        ],
      })
    );
  };

  onMessage = ({ data }: MessageEvent) => {
    if (data.includes('event":"subscribe"')) {
      return;
    }

    if (data === 'pong') {
      this.handlePongEvent();
      return;
    }

    if (data === '{"event":"login", "msg" : "", "code": "0"}') {
      this.subscribe();
      return;
    }

    if (
      data.includes('"channel":"orders"') ||
      data.includes('"channel":"orders-algo"') ||
      data.includes('"channel":"algo-advance"')
    ) {
      this.handleOrderTopic(JSON.parse(data));
      return;
    }

    if (data.includes('"channel":"positions"')) {
      this.handlePositionTopic(JSON.parse(data));
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

  handleOrderTopic = ({ data: okxOrders }: Record<string, any>) => {
    for (const o of okxOrders) {
      const orders = this.parent.mapOrders([o]);

      if (orders.length) {
        if (o.state === 'filled' || o.state === 'canceled') {
          this.store.removeOrders(orders);
        }

        if (o.state === 'live' || o.state === 'partially_filled') {
          this.store.addOrUpdateOrders(orders);
        }

        if (o.state === 'filled' || o.state === 'partially_filled') {
          this.emitter.emit('fill', {
            side: orders[0].side,
            symbol: orders[0].symbol,
            price: orders[0].price,
            amount: orders[0].amount,
          });
        }
      }
    }
  };

  handlePositionTopic = ({
    data: okxPositions,
  }: {
    data: Array<Record<string, any>>;
  }) => {
    const positions = this.parent.mapPositions(okxPositions);

    if (positions.length) {
      const used = roundUSD(sumBy(okxPositions, (p) => parseFloat(p.mmr)));
      const upnl = roundUSD(sumBy(okxPositions, (p) => parseFloat(p.upl)));

      this.store.update({
        positions,
        balance: { ...this.store.balance, used: used || 0, upnl: upnl || 0 },
      });
    }
  };
}
