import { OrderSide, OrderStatus, OrderType, PositionSide } from '../../types';

export const RECV_WINDOW = 5000;
export const BROKER_ID = 'f4f16f76ea9fBCDE';

// OKX requires CORS
// OKX needs to add a custom header for WSS testnet, so we reverse_proxy

export const BASE_URL = 'https://okx.tuleep.trade';
export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/public',
    testnet: 'wss://okx-testnet-wss.tuleep.trade/ws/v5/public?brokerId=9999',
  },
  private: {
    livenet: 'wss://okx-wss.tuleep.trade/ws/v5/private',
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
  UNFILLED_ALGO_ORDERS: '/api/v5/trade/orders-algo-pending',
  CANCEL_ORDERS: '/api/v5/trade/cancel-batch-orders',
  CANCEL_ALGO_ORDERS: '/api/v5/trade/cancel-algos',
  PLACE_ORDERS: '/api/v5/trade/batch-orders',
  SET_LEVERAGE: '/api/v5/account/set-leverage',
  LEVERAGE: '/api/v5/account/leverage-info',
  SET_POSITION_MODE: '/api/v5/account/set-position-mode',
  ACCOUNT_CONFIG: '/api/v5/account/config',
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
