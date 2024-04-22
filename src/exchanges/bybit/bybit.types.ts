import type { Timeframe } from '../../types';
import {
  OrderTimeInForce,
  OrderStatus,
  OrderType,
  OrderSide,
  PositionSide,
} from '../../types';

export const RECV_WINDOW = 5000;
export const BROKER_ID = 'Gi000266';

export const BASE_URL = {
  livenet: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
};

export const BASE_WS_URL = {
  public: {
    livenet: 'wss://stream.bybit.com/v5/public/linear',
    testnet: 'wss://stream-testnet.bybit.com/v5/public/linear',
  },
  private: {
    livenet: 'wss://stream.bybit.com/v5/private',
    testnet: 'wss://stream-testnet.bybit.com/v5/private',
  },
};

export const ENDPOINTS = {
  ACCOUNT_MARGIN: '/v5/account/info',
  ACCOUNT: '/v5/user/query-api',
  BALANCE: '/v5/account/wallet-balance',
  UNFILLED_ORDERS: '/v5/order/realtime',
  TICKERS: '/v5/market/tickers',
  MARKETS: '/v5/market/instruments-info',
  CANCEL_ORDER: '/v5/order/cancel',
  CANCEL_SYMBOL_ORDERS: '/v5/order/cancel-all',
  POSITIONS: '/v5/position/list',
  KLINE: '/v5/market/kline',
  SET_LEVERAGE: '/v5/position/set-leverage',
  SET_TRADING_STOP: '/v5/position/trading-stop',
  CREATE_ORDER: '/v5/order/create',
  SET_POSITION_MODE: '/v5/position/switch-mode',
};

export const PUBLIC_ENDPOINTS = [
  ENDPOINTS.TICKERS,
  ENDPOINTS.MARKETS,
  ENDPOINTS.KLINE,
];

export const INTERVAL: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
};

export const ORDER_STATUS: Record<string, OrderStatus> = {
  Created: OrderStatus.Open,
  New: OrderStatus.Open,
  Active: OrderStatus.Open,
  Untriggered: OrderStatus.Open,
  PartiallyFilled: OrderStatus.Open,
  Rejected: OrderStatus.Closed,
  Filled: OrderStatus.Closed,
  Deactivated: OrderStatus.Closed,
  Triggered: OrderStatus.Closed,
  PendingCancel: OrderStatus.Canceled,
  Cancelled: OrderStatus.Canceled,
};

export const ORDER_TYPE: Record<string, OrderType> = {
  Limit: OrderType.Limit,
  Market: OrderType.Market,
  StopLoss: OrderType.StopLoss,
  TakeProfit: OrderType.TakeProfit,
  TrailingStop: OrderType.TrailingStopLoss,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  Buy: OrderSide.Buy,
  Sell: OrderSide.Sell,
};

export const POSITION_SIDE: Record<string, PositionSide> = {
  Buy: PositionSide.Long,
  Sell: PositionSide.Short,
};

export const ORDER_TIME_IN_FORCE: Record<string, OrderTimeInForce> = {
  GTC: OrderTimeInForce.GoodTillCancel,
  IOC: OrderTimeInForce.ImmediateOrCancel,
  FOK: OrderTimeInForce.FillOrKill,
  PostOnly: OrderTimeInForce.PostOnly,
};
