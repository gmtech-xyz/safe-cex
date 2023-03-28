import createHmac from 'create-hmac';

import { v } from '../../utils/get-key';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { Woo } from './woo.exchange';
import { BASE_WS_URL } from './woo.types';

export class WooPrivateWebscoket extends BaseWebSocket<Woo> {
  constructor(parent: Woo) {
    super(parent);
    this.connectAndSubscribe();
  }

  connectAndSubscribe = () => {
    if (!this.parent.isDisposed) {
      const baseURL =
        BASE_WS_URL.private[
          this.parent.options.testnet ? 'testnet' : 'livenet'
        ];

      this.ws = new WebSocket(`${baseURL}${this.parent.options.applicationId}`);

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    const timestamp = virtualClock.getCurrentTime();
    const signature = createHmac('sha256', this.parent.options.secret)
      .update(`|${timestamp}`)
      .digest('hex');

    this.ws?.send?.(
      JSON.stringify({
        event: 'auth',
        params: {
          apikey: this.parent.options.key,
          sign: signature,
          timestamp,
        },
      })
    );
  };

  subscribe = () => {
    this.ws?.send(
      JSON.stringify({ topic: 'executionreport', event: 'subscribe' })
    );
    this.ws?.send(
      JSON.stringify({ topic: 'algoexecutionreportv2', event: 'subscribe' })
    );
  };

  onMessage = ({ data }: MessageEvent) => {
    const json = JSON.parse(data);

    if (json.event === 'auth' && json.success) {
      this.subscribe();
    }

    if (json.topic === 'executionreport') {
      this.handleExecutionReport(json.data);
    }

    if (json.topic === 'algoexecutionreportv2') {
      this.handleAlgoExecutionReport(json.data);
    }
  };

  handleExecutionReport = (data: Record<string, any>) => {
    const orderIdx = this.parent.store.orders.findIndex(
      (o) => o.id === v(data, 'orderId')
    );

    if (data.status === 'REPLACED') {
      if (orderIdx > -1) {
        const updatedOrder = this.parent.mapLimitOrder(data);
        if (updatedOrder !== null) {
          this.parent.store.orders[orderIdx] = updatedOrder;
        }
      }
    }
  };

  handleAlgoExecutionReport = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      const orderIdx = this.parent.store.orders.findIndex(
        (o) => o.id === `${v(row, 'algoOrderId')}`
      );

      if (orderIdx > -1 && v(row, 'algoStatus') === 'NEW') {
        const [updatedOrder] = this.parent.mapAlgoOrder({
          symbol: row.symbol,
          childOrders: [row],
        });

        if (updatedOrder) {
          this.parent.store.orders[orderIdx] = updatedOrder;
        }
      }
    });
  };
}
