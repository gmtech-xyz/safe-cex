import createHmac from 'create-hmac';

import { PositionSide, type Position } from '../../types';
import { toBase64 } from '../../utils/base64';
import { jsonParse } from '../../utils/json-parse';
import { multiply, subtract } from '../../utils/safe-math';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { BlofinExchange } from './blofin.exchange';
import { BASE_WS_URL } from './blofin.types';

export class BlofinPrivateWebsocket extends BaseWebSocket<BlofinExchange> {
  channels = ['positions', 'orders', 'orders-algo', 'account'];

  get endpoint() {
    return (
      this.parent.options.extra?.blofin?.ws?.private?.livenet ||
      BASE_WS_URL.private
    );
  }

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(this.endpoint);
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
    const timestamp = virtualClock.getCurrentTime().valueOf().toString();
    const signature = toBase64(
      createHmac('sha256', this.parent.options.secret)
        .update(['/users/self/verify', 'GET', timestamp, timestamp].join(''))
        .digest('hex')
    );

    this.ws?.send(
      JSON.stringify({
        op: 'login',
        args: [
          {
            apiKey: this.parent.options.key,
            passphrase: this.parent.options.passphrase,
            timestamp,
            sign: signature,
            nonce: timestamp,
          },
        ],
      })
    );
  };

  subscribe = () => {
    for (const channel of this.channels) {
      this.ws?.send?.(JSON.stringify({ op: 'subscribe', args: [{ channel }] }));
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (data.includes('event":"subscribe"')) {
      return;
    }

    if (data === 'pong') {
      this.handlePongEvent();
      return;
    }

    if (data === '{"event":"login","code":"0","msg":""}') {
      this.subscribe();
      return;
    }

    if (data.includes('"channel":"positions"')) {
      const json = jsonParse<{ data: Array<Record<string, any>> }>(data);
      if (json) this.handlePositionsTopic(json);
      return;
    }

    if (data.includes('"channel":"account"')) {
      const json = jsonParse<{ data: Array<Record<string, any>> }>(data);
      if (json) this.handleAccountTopic(json);
      return;
    }

    if (
      data.includes('"channel":"orders"') ||
      data.includes('"channel":"orders-algo"')
    ) {
      const json = jsonParse<{ data: Array<Record<string, any>> }>(data);
      if (json) this.handleOrdersTopic(json);
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

  handlePositionsTopic = ({ data }: { data: Array<Record<string, any>> }) => {
    const positions = this.parent.mapPositions(data);

    // When closing a position, Blofin doesn't send a position with 0 contracts
    // it just removes it from the positions data.
    // We need to generate the fake positions in order to keep track of closed.
    const fakePositions = this.store.markets.reduce((acc: Position[], m) => {
      const hasPosition = positions.some((p) => p.symbol === m.symbol);
      if (hasPosition) return acc;

      const fakeMarketPositions: Position = {
        symbol: m.symbol,
        side: PositionSide.Long,
        entryPrice: 0,
        notional: 0,
        leverage: this.parent.leverageHash[m.id] || 1,
        unrealizedPnl: 0,
        contracts: 0,
        liquidationPrice: 0,
      };

      return [...acc, fakeMarketPositions];
    }, []);

    this.store.updatePositions(
      [...positions, ...fakePositions].map((p) => [p, p])
    );
  };

  handleAccountTopic = ({ data }: { data: Record<string, any> }) => {
    const usdt = data.details.find((d: any) => d.currency === 'USDT');

    if (usdt) {
      const upnl = parseFloat(usdt.unrealizedPnl);
      const total = parseFloat(usdt.balance);
      const free = parseFloat(usdt.available);
      const used = subtract(total, free);
      this.store.update({ balance: { total, free, used, upnl } });
    }
  };

  handleOrdersTopic = ({ data }: { data: Array<Record<string, any>> }) => {
    for (const o of data) {
      const orders = this.parent.mapOrders([o]);

      if (orders.length) {
        if (o.state === 'filled' || o.state === 'canceled') {
          this.store.removeOrders(orders);
        }

        if (o.state === 'live' || o.state === 'partially_filled') {
          this.store.addOrUpdateOrders(orders);
        }

        if (o.state === 'filled' || o.state === 'partially_filled') {
          const market = this.store.markets.find((m) => m.id === o.instId);

          if (market) {
            this.emitter.emit('fill', {
              side: orders[0].side,
              symbol: orders[0].symbol,
              price: parseFloat(o.averagePrice),
              amount: multiply(
                parseFloat(o.filledSize),
                market.precision.amount
              ),
            });
          }
        }
      }
    }
  };
}
