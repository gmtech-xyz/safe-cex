import type { Timeframe } from '../../types';
import { OrderStatus, OrderType, OrderSide, PositionSide } from '../../types';

export const RECV_WINDOW = 5000;
export const BROKER_ID = 'Gi000266';

export const BASE_URL = {
  livenet: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
};

export const BASE_WS_URL = {
  public: {
    livenet: 'wss://stream.bybit.com/realtime_public',
    testnet: 'wss://stream-testnet.bybit.com/realtime_public',
  },
  private: {
    livenet: 'wss://stream.bybit.com/contract/private/v3',
    testnet: 'wss://stream-testnet.bybit.com/contract/private/v3',
  },
};

export const ENDPOINTS = {
  // V3
  BALANCE: '/contract/v3/private/account/wallet/balance',
  UNFILLED_ORDERS: '/contract/v3/private/order/unfilled-orders',
  TICKERS: '/derivatives/v3/public/tickers',
  MARKETS: '/derivatives/v3/public/instruments-info',
  CREATE_ORDER: '/contract/v3/private/order/create',
  CANCEL_ORDER: '/contract/v3/private/order/cancel',
  SET_LEVERAGE: '/contract/v3/private/position/set-leverage',
  SET_POSITION_MODE: '/contract/v3/private/position/switch-mode',
  REPLACE_ORDER: '/contract/v3/private/order/replace',
  SET_TRADING_STOP: '/contract/v3/private/position/trading-stop',
  // V2
  POSITIONS: '/private/linear/position/list',
  KLINE: '/public/linear/kline',
  CANCEL_SYMBOL_ORDERS: '/private/linear/order/cancel-all',
};

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
