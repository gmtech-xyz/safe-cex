import type { Timeframe } from '../../types';
import { OrderSide, OrderStatus, OrderType, PositionSide } from '../../types';

export const RECV_WINDOW = 5000;
export const BROKER_ID = 'f4f16f76ea9fBCDE';

export const BASE_URL = 'https://aws.okx.com';
export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/public',
    testnet: 'wss://wsaws.okx.com:8443/ws/v5/public?brokerId=9999',
  },
  private: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/private',
    testnet: 'wss://wsaws.okx.com:8443/ws/v5/private?brokerId=9999',
  },
};

export const ENDPOINTS = {
  ACCOUNT: '/api/v5/account/config',
  PARTNER: '/api/v5/users/partner/if-rebate',
  MARKETS: '/api/v5/public/instruments',
  TICKERS: '/api/v5/market/tickers',
  BALANCE: '/api/v5/account/account-position-risk',
  POSITIONS: '/api/v5/account/positions',
  KLINE: '/api/v5/market/candles',
  UNFILLED_ORDERS: '/api/v5/trade/orders-pending',
  UNFILLED_ALGO_ORDERS: '/api/v5/trade/orders-algo-pending',
  CANCEL_ORDERS: '/api/v5/trade/cancel-batch-orders',
  CANCEL_ALGO_ORDERS: '/api/v5/trade/cancel-algos',
  PLACE_ORDERS: '/api/v5/trade/batch-orders',
  PLACE_ALGO_ORDER: '/api/v5/trade/order-algo',
  SET_LEVERAGE: '/api/v5/account/set-leverage',
  LEVERAGE: '/api/v5/account/leverage-info',
  SET_POSITION_MODE: '/api/v5/account/set-position-mode',
  ACCOUNT_CONFIG: '/api/v5/account/config',
  UPDATE_ORDER: '/api/v5/trade/amend-order',
};

export const PUBLIC_ENDPOINTS = [
  ENDPOINTS.MARKETS,
  ENDPOINTS.TICKERS,
  ENDPOINTS.KLINE,
];

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

export const REVERSE_ORDER_TYPE: Record<OrderType, string> = {
  [OrderType.Market]: 'market',
  [OrderType.Limit]: 'limit',
  [OrderType.StopLoss]: 'trigger',
  [OrderType.TakeProfit]: 'trigger',
  [OrderType.TrailingStopLoss]: 'move_order_stop',
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  buy: OrderSide.Buy,
  sell: OrderSide.Sell,
};

export const POSITION_SIDE: Record<string, PositionSide> = {
  long: PositionSide.Long,
  short: PositionSide.Short,
};
