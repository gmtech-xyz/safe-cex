import { OrderSide, OrderStatus, OrderType } from '../../types';

export const RECV_WINDOW = 5000;

// OKX requires CORS
// OKX needs to add a custom header for WSS testnet, so we reverse_proxy

export const BASE_URL = 'https://okx.tuleep.trade';
export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/public',
    testnet: 'wss://okx-testnet-wss.tuleep.trade/ws/v5/public?brokerId=9999',
  },
  private: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/private',
    testnet: 'wss://okx-testnet-wss.tuleep.trade/ws/v5/private?brokerId=9999',
  },
};

export const ENDPOINTS = {
  MARKETS: '/api/v5/public/instruments',
  TICKERS: '/api/v5/market/tickers',
  BALANCE: '/api/v5/account/account-position-risk',
  POSITIONS: '/api/v5/account/positions',
  KLINE: '/api/v5/market/candles',
  UNFILLED_ORDERS: '/api/v5/trade/orders-pending',
};

export const ORDER_STATUS: Record<string, OrderStatus> = {
  live: OrderStatus.Open,
  partially_filled: OrderStatus.Open,
};

export const ORDER_TYPE: Record<string, OrderType> = {
  market: OrderType.Market,
  limit: OrderType.Limit,
  post_only: OrderType.Limit,
  fok: OrderType.Limit,
  ioc: OrderType.Limit,
  optimal_limit_ioc: OrderType.Market,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  buy: OrderSide.Buy,
  sell: OrderSide.Sell,
};
