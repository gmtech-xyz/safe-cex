import { OrderSide, OrderType } from '../../types';

export const RECV_WINDOW = 5000;
export const BROKER_ID = '0527c685-d30d-4a1f-9807-99cc29e930ea';
export const TESTNET_BROKER_ID = 'e708a644-9ce5-46c6-b50c-74b15f62d8ca';

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
  CANCEL_ORDERS: '/v3/orders/pending',
  CANCEL_ALGO_ORDERS: '/v3/algo/orders/pending',
  CANCEL_SYMBOL_ORDERS: '/v1/orders',
  // v1
  MARKETS: '/v1/public/info',
  TICKERS: '/v1/public/futures',
  ORDERS: '/v1/orders',
  KLINE: '/v1/kline',
  CANCEL_ORDER: '/v1/order',
  PLACE_ORDER: '/v1/order',
  LEVERAGE: '/v1/client/leverage',
  ORDERBOOK: '/v1/public/orderbook',
};

export const ORDER_TYPE: Record<string, OrderType> = {
  LIMIT: OrderType.Limit,
  MARKET: OrderType.Market,
  TAKE_PROFIT: OrderType.TakeProfit,
  STOP_LOSS: OrderType.StopLoss,
  TRAILING_STOP: OrderType.TrailingStopLoss,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  BUY: OrderSide.Buy,
  SELL: OrderSide.Sell,
};
