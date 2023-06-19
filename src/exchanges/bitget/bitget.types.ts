import type { Timeframe } from '../../types';
import { PositionSide } from '../../types';

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
