/* eslint-disable no-param-reassign */
import type { OrderBook } from '../types';

import { add } from './safe-math';

export const sortOrderBook = (orderBook: OrderBook) => {
  orderBook.asks.sort((a, b) => a.price - b.price);
  orderBook.bids.sort((a, b) => b.price - a.price);
};

export const calcOrderBookTotal = (orderBook: OrderBook) => {
  Object.values(orderBook).forEach((orders) => {
    orders.forEach((order, idx) => {
      order.total =
        idx === 0 ? order.amount : add(order.amount, orders[idx - 1].total);
    });
  });
};
