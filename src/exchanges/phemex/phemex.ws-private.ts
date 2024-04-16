import createHmac from 'create-hmac';

import { jsonParse } from '../../utils/json-parse';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { PhemexExchange } from './phemex.exchange';
import { BASE_WSS_URL, RECV_WINDOW } from './phemex.types';

type Data = Record<string, any>;

export class PhemexPrivateWebsocket extends BaseWebSocket<PhemexExchange> {
  id = 1;

  get endpoint() {
    if (this.parent.options.testnet) {
      return (
        this.parent.options.extra?.phemex?.ws?.private?.testnet ||
        BASE_WSS_URL.private.livenet
      );
    }

    return (
      this.parent.options.extra?.phemex?.ws?.private?.livenet ||
      BASE_WSS_URL.private.testnet
    );
  }

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      // reset id so we can wait for the auth response
      this.id = 1;

      // connect to the websocket
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

  auth = () => {
    const timeout = this.parent.options?.extra?.recvWindow ?? RECV_WINDOW;
    const expiry = virtualClock.getCurrentTime().unix() + timeout / 1000;
    const toSign = [this.parent.options.key, expiry].join('');
    const signature = createHmac('sha256', this.parent.options.secret)
      .update(toSign)
      .digest('hex');

    this.ws?.send?.(
      JSON.stringify({
        id: this.id++,
        method: 'user.auth',
        params: ['API', this.parent.options.key, signature, expiry],
      })
    );
  };

  ping = () => {
    if (!this.isDisposed) {
      this.pingAt = performance.now();
      this.ws?.send?.(
        JSON.stringify({ id: this.id++, method: 'server.ping', params: [] })
      );
    }
  };

  subscribe = () => {
    if (!this.isDisposed) {
      this.ws?.send?.(
        JSON.stringify({
          id: this.id++,
          method: 'aop_p.subscribe',
          params: [],
        })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (data === '{"error":null,"id":1,"result":{"status":"success"}}') {
      // auth was successfull so we can now subscribe to topics
      this.subscribe();
      return;
    }

    if (data.includes('result":"pong"')) {
      this.handlePongEvent();
      return;
    }

    if (data.includes('type":"snapshot')) {
      const json = jsonParse(data);
      if (json) this.handleSnapshotEvent(json);
      return;
    }

    console.log(data);
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

  handleSnapshotEvent = (data: Data) => {
    const openOrders = data.orders_p.filter((o: Record<string, any>) =>
      ['New', 'PartiallyFilled', 'Untriggered'].includes(o.ordStatus)
    );

    this.store.update({
      orders: this.parent.mapOrders(openOrders),
      loaded: { ...this.store.loaded, orders: true },
    });

    this.parent.log(`Loaded ${this.store.orders.length} Phemex orders`);
  };
}
