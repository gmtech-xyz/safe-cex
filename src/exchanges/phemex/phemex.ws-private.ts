import createHmac from 'create-hmac';
import sumBy from 'lodash/sumBy';

import { OrderSide } from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { subtract } from '../../utils/safe-math';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { PhemexExchange } from './phemex.exchange';
import { BASE_WSS_URL, OPEN_PHEMEX_ORDERS, RECV_WINDOW } from './phemex.types';

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

    if (data.includes('"result":"pong"')) {
      this.handlePongEvent();
      return;
    }

    if (data.includes('"type":"snapshot"')) {
      const json = jsonParse(data);
      if (json) this.handleSnapshotEvent(json);
      return;
    }

    if (data.includes('"type":"incremental"')) {
      const json = jsonParse(data);
      if (json) this.handleIncrementalEvent(json);
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

  handleSnapshotEvent = (data: Data) => {
    // 1. handle snapshot of orders
    const dataOrders = data.orders_p || [];
    const openOrders = dataOrders.filter((o: Record<string, any>) =>
      OPEN_PHEMEX_ORDERS.includes(o.ordStatus)
    );

    this.store.update({
      orders: this.parent.mapOrders(openOrders),
      loaded: { ...this.store.loaded, orders: true },
    });

    this.parent.log(`Loaded ${this.store.orders.length} Phemex orders`);
  };

  handleIncrementalEvent = (data: Data) => {
    // 1. handle banlance updates
    const accounts = data.accounts_p || [];
    const usdtAccount = accounts.find((a: any) => a.currency === 'USDT');

    if (usdtAccount) {
      const total = parseFloat(usdtAccount.accountBalanceRv);
      const used = parseFloat(usdtAccount.totalUsedBalanceRv);
      const free = subtract(total, used);

      this.store.update({
        balance: { total, free, used, upnl: this.store.balance.upnl },
      });
    }

    // 2. handle orders updates
    const dataOrders = data.orders_p || [];

    if (dataOrders.length > 0) {
      dataOrders.forEach((o: Record<string, any>) => {
        // add or update new orders & partially filled
        if (OPEN_PHEMEX_ORDERS.includes(o.ordStatus)) {
          this.store.addOrUpdateOrders(this.parent.mapOrders([o]));
        }

        // remove cancelled and filled orders
        if (
          o.ordStatus === 'Canceled' ||
          o.ordStatus === 'Deactivated' ||
          o.ordStatus === 'Filled'
        ) {
          this.store.removeOrder({ id: o.orderID });
        }

        // emit event for filled / partially filled orders
        if (o.ordStatus === 'Filled' || o.ordStatus === 'PartiallyFilled') {
          this.parent.emitter.emit('fill', {
            side: o.side === 'Sell' ? OrderSide.Sell : OrderSide.Buy,
            symbol: o.symbol,
            price: parseFloat(o.priceRp) || parseFloat(o.stopPxRp),
            amount: parseFloat(o.execQty),
          });
        }
      });
    }

    // 3. handle positions updates
    const dataPositions = data.positions_p || [];
    const positions = this.parent.mapPositions(dataPositions);

    if (positions.length > 0) {
      this.store.updatePositions(positions.map((p) => [p, p]));

      // update balance upnl after positions update
      const upnl = sumBy(positions, 'unrealizedPnl');
      this.store.update({ balance: { ...this.store.balance, upnl } });
    }
  };
}
