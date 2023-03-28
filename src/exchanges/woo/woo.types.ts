export const RECV_WINDOW = 5000;

export const BASE_URL = {
  livenet: 'https://api.woo.org',
  testnet: 'https://api.staging.woo.org',
};

export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wss.woo.org/ws/stream/',
    testnet: 'wss://wss.staging.woo.org/ws/stream/',
  },
  private: {
    livenet: 'wss://wss.woo.org/v2/ws/private/stream/',
    testnet: 'wss://wss.staging.woo.org/v2/ws/private/stream/',
  },
};

export const ENDPOINTS = {
  // v3
  ACCOUNT: '/v3/accountinfo',
  BALANCE: '/v3/balances',
  POSITIONS: '/v3/positions',
  // v1
  MARKETS: '/v1/public/info',
  TICKERS: '/v1/public/futures',
};
