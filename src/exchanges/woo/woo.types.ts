import { OrderSide, OrderType } from '../../types';

export const RECV_WINDOW = 5000;

export const BASE_URL = {
  livenet: 'https://api.woo.org',
  testnet: 'https://api.staging.woo.org',
};

export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wss.woo.org/ws/stream/',
    testnet: 'wss://wss.staging.woo.org/ws/stream/',
  },
  private: {
    livenet: 'wss://wss.woo.org/v2/ws/private/stream/',
    testnet: 'wss://wss.staging.woo.org/v2/ws/private/stream/',
  },
};

export const ENDPOINTS = {
  // v3
  ACCOUNT: '/v3/accountinfo',
  BALANCE: '/v3/balances',
  POSITIONS: '/v3/positions',
  ALGO_ORDERS: '/v3/algo/orders',
  UPDATE_ORDER: '/v3/order',
  ALGO_ORDER: '/v3/algo/order',
  // v1
  MARKETS: '/v1/public/info',
  TICKERS: '/v1/public/futures',
  ORDERS: '/v1/orders',
  KLINE: '/v1/kline',
  CANCEL_ORDER: '/v1/order',
};

export const ORDER_TYPE: Record<string, OrderType> = {
  LIMIT: OrderType.Limit,
  MARKET: OrderType.Market,
  TAKE_PROFIT: OrderType.TakeProfit,
  STOP_LOSS: OrderType.StopLoss,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  BUY: OrderSide.Buy,
  SELL: OrderSide.Sell,
};
