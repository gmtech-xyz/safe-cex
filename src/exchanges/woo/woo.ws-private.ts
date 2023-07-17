import createHmac from 'create-hmac';

import { v } from '../../utils/get-key';
import { jsonParse } from '../../utils/json-parse';
import { virtualClock } from '../../utils/virtual-clock';
import { BaseWebSocket } from '../base.ws';

import type { WOOXExchange } from './woo.exchange';
import { BASE_WS_URL, ORDER_SIDE } from './woo.types';
import { normalizeSymbol } from './woo.utils';

export class WooPrivateWebscoket extends BaseWebSocket<WOOXExchange> {
  connectAndSubscribe = () => {
    if (!this.isDisposed) {
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
    if (!this.isDisposed) {
      const timestamp = virtualClock.getCurrentTime().valueOf();
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
    }
  };

  subscribe = () => {
    if (!this.isDisposed) {
      this.ws?.send(
        JSON.stringify({ topic: 'executionreport', event: 'subscribe' })
      );
      this.ws?.send(
        JSON.stringify({ topic: 'algoexecutionreportv2', event: 'subscribe' })
      );
    }
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      const json = jsonParse(data);

      if (json?.event === 'ping') {
        this.ws?.send?.(JSON.stringify({ event: 'pong' }));
      }

      if (json?.event === 'auth' && json?.success) {
        this.subscribe();
        return;
      }

      if (json?.topic === 'executionreport') {
        this.handleExecutionReport(json?.data);
        return;
      }

      if (json?.topic === 'algoexecutionreportv2') {
        this.handleAlgoExecutionReport(json?.data);
      }
    }
  };

  handleExecutionReport = (data: Record<string, any>) => {
    const updatedOrder = this.parent.mapLimitOrder(data);

    const price = v(data, 'executedPrice');
    const amount = v(data, 'executedQuantity');

    if (
      data.status === 'REPLACED' ||
      data.status === 'NEW' ||
      data.status === 'PARTIAL_FILLED'
    ) {
      if (updatedOrder) {
        this.store.addOrUpdateOrder(updatedOrder);
      }
    }

    if (data.status === 'CANCELLED' || data.status === 'FILLED') {
      this.store.removeOrder({ id: `${data.orderId}` });
    }

    if (updatedOrder) {
      if (data.status === 'FILLED' || data.status === 'PARTIALLY_FILLED') {
        this.parent.emitter.emit('fill', {
          side: updatedOrder.side,
          symbol: updatedOrder.symbol,
          price,
          amount,
        });
      }
    }
  };

  handleAlgoExecutionReport = (data: Array<Record<string, any>>) => {
    data.forEach((row) => {
      const status = v(row, 'algoStatus');

      if (
        status === 'NEW' ||
        status === 'REPLACED' ||
        status === 'PARTIAL_FILLED'
      ) {
        const [updatedOrder] = this.parent.mapAlgoOrder(row);

        if (updatedOrder) {
          this.store.addOrUpdateOrder(updatedOrder);
        }
      }

      if (status === 'FILLED') {
        this.parent.emitter.emit('fill', {
          side: ORDER_SIDE[row.side],
          symbol: normalizeSymbol(row.symbol),
          price: row.averageExecutedPrice,
          amount: row.totalExecutedQuantity,
        });
      }

      if (status === 'CANCELLED' || status === 'FILLED') {
        this.store.removeOrder({ id: `${v(row, 'algoOrderId')}` });
      }
    });
  };
}
