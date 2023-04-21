export const RECV_WINDOW = 5000;

export const BASE_URL = {
  livenet: 'https://gate.tuleep.trade/api/v4',
  testnet: 'https://gate-testnet.tuleep.trade/api/v4',
};

export const BASE_WS_URL = {
  livenet: 'wss://gate-wss.tuleep.trade/v4/ws/usdt',
  testnet: 'wss://gate-wss-testnet.tuleep.trade/v4/ws/usdt',
};

export const ENDPOINTS = {
  MARKETS: '/futures/usdt/contracts',
  TICKERS: '/futures/usdt/tickers',
  KLINE: '/futures/usdt/candlesticks',
};
