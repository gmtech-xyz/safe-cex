import type { Timeframe } from '../../types';
import { OrderSide, OrderStatus, OrderType } from '../../types';

export const RECV_WINDOW = 5000;

export const BASE_URL = 'https://openapi.blofin.com';

export const BASE_WS_URL = {
  public: 'wss://openapi.blofin.com/ws/public',
  private: 'wss://openapi.blofin.com/ws/private',
};

export const ENDPOINTS = {
  API_KEY: '/api/v1/user/query-apikey',
  MARKETS: '/api/v1/market/instruments',
  TICKERS: '/api/v1/market/tickers',
  KLINE: '/api/v1/market/candles',
  LEVERAGE: '/api/v1/account/batch-leverage-info',
  BALANCE: '/api/v1/account/balance',
  POSITIONS: '/api/v1/account/positions',
  UNFILLED_ORDERS: '/api/v1/trade/orders-pending',
  UNFILLED_ALGO_ORDERS: '/api/v1/trade/orders-tpsl-pending',
  SET_LEVERAGE: '/api/v1/account/set-leverage',
  CANCEL_ORDERS: '/api/v1/trade/cancel-batch-orders',
  CANCEL_ALGO_ORDERS: '/api/v1/trade/cancel-tpsl',
  PLACE_ORDERS: '/api/v1/trade/batch-orders',
  PLACE_ALGO_ORDER: '/api/v1/trade/order-tpsl',
};

export const ORDER_STATUS: Record<string, OrderStatus> = {
  live: OrderStatus.Open,
};

export const ORDER_TYPE: Record<string, OrderType> = {
  market: OrderType.Market,
  limit: OrderType.Limit,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  buy: OrderSide.Buy,
  sell: OrderSide.Sell,
};

export const INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6H',
  '12h': '12H',
  '1d': '1D',
  '1w': '1W',
};
