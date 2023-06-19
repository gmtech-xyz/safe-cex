import type { Timeframe } from '../../types';
import { OrderSide, OrderType, OrderStatus, PositionSide } from '../../types';

export const RECV_WINDOW = 5000;

export const BASE_URL = 'https://api.bitget.com';
export const BASE_WS_URL = 'wss://ws.bitget.com/mix/v1/stream';

export const ENDPOINTS = {
  BALANCE: '/api/mix/v1/account/accounts',
  MARKETS: '/api/mix/v1/market/contracts',
  LEVERAGE: '/api/mix/v1/market/symbol-leverage',
  TICKERS: '/api/mix/v1/market/tickers',
  POSITIONS: '/api/mix/v1/position/allPosition-v2',
  KLINE: '/api/mix/v1/market/candles',
  ORDERS: '/api/mix/v1/order/marginCoinCurrent',
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

export const POSITION_SIDE: Record<string, PositionSide> = {
  long: PositionSide.Long,
  short: PositionSide.Short,
};

export const ORDER_STATUS: Record<string, OrderStatus> = {
  init: OrderStatus.Open,
  new: OrderStatus.Open,
  partially_filled: OrderStatus.Open,
  filled: OrderStatus.Closed,
  canceled: OrderStatus.Canceled,
};

export const ORDER_TYPE: Record<string, OrderType> = {
  limit: OrderType.Limit,
  market: OrderType.Market,
};

export const ORDER_SIDE: Record<string, OrderSide> = {
  open_long: OrderSide.Buy,
  open_short: OrderSide.Sell,
  close_long: OrderSide.Sell,
  close_short: OrderSide.Buy,
  reduce_close_long: OrderSide.Sell,
  reduce_close_short: OrderSide.Buy,
  offset_close_long: OrderSide.Sell,
  offset_close_short: OrderSide.Buy,
  burst_close_long: OrderSide.Sell,
  burst_close_short: OrderSide.Buy,
  delivery_close_long: OrderSide.Sell,
  delivery_close_short: OrderSide.Buy,
};
