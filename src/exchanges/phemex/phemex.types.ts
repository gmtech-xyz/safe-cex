import type { Timeframe } from '../../types';

export type PhemexApiResponse<T extends Record<string, any>> = T & {
  code: number;
  msg: string;
};

export const RECV_WINDOW = 5000;
export const BROKER_ID = 'gmtech_trade';

export const BASE_URL = {
  livenet: 'https://api.phemex.com',
  testnet: 'https://testnet-api.phemex.com',
};

export const BASE_WSS_URL = {
  public: {
    livenet: 'wss://ws.phemex.com',
    testnet: 'wss://testnet-api.phemex.com/ws',
  },
  private: {
    livenet: 'wss://ws.phemex.com',
    testnet: 'wss://testnet-api.phemex.com/ws',
  },
};

export const ENDPOINTS = {
  SPOT_WALLETS: '/spot/wallets',
  MARKETS: '/public/products',
  TICKERS: '/md/v3/ticker/24hr/all',
  POSITIONS: '/g-accounts/accountPositions',
  KLINE: '/exchange/public/md/v2/kline/list',
  ORDERS: '/g-orders/activeList',
};

export const PUBLIC_ENDPOINTS = [
  ENDPOINTS.MARKETS,
  ENDPOINTS.TICKERS,
  ENDPOINTS.KLINE,
];

export const INTERVAL: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '12h': 43200,
  '1d': 86400,
  '1w': 604800,
};
