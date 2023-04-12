/* eslint-disable no-param-reassign */
import BigNumber from 'bignumber.js';

import type { OrderBook } from '../types';

export const sortOrderBook = (orderBook: OrderBook) => {
  orderBook.asks.sort((a, b) => a.price - b.price);
  orderBook.bids.sort((a, b) => b.price - a.price);
};

export const calcOrderBookTotal = (orderBook: OrderBook) => {
  Object.values(orderBook).forEach((orders) => {
    orders.forEach((order, idx) => {
      order.total =
        idx === 0
          ? order.amount
          : new BigNumber(order.amount).plus(orders[idx - 1].total).toNumber();
    });
  });
};
