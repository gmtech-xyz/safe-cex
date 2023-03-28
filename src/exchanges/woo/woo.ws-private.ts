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
      return;
    }

    if (json.topic === 'executionreport') {
      this.handleExecutionReport(json.data);
      return;
    }

    if (json.topic === 'algoexecutionreportv2') {
      this.handleAlgoExecutionReport(json.data);
    }
  };

  handleExecutionReport = (data: Record<string, any>) => {
    if (data.status === 'REPLACED' || data.status === 'NEW') {
      const updatedOrder = this.parent.mapLimitOrder(data);

      if (updatedOrder) {
        this.parent.addOrReplaceOrderFromStore(updatedOrder);
      }
    }

    if (data.status === 'CANCELLED') {
      this.parent.removeOrderFromStore(`${data.orderId}`);
    }
  };

  handleAlgoExecutionReport = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      const status = v(row, 'algoStatus');

      if (status === 'NEW') {
        const [updatedOrder] = this.parent.mapAlgoOrder({
          symbol: row.symbol,
          childOrders: [row],
        });

        if (updatedOrder) {
          this.parent.addOrReplaceOrderFromStore(updatedOrder);
        }
      }

      if (status === 'CANCELLED' || !row.activated) {
        this.parent.removeOrderFromStore(`${v(row, 'algoOrderId')}`);
      }
    });
  };
}
