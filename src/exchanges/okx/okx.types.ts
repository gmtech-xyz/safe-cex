export const RECV_WINDOW = 5000;

// OKX requires CORS
// OKX needs to add a custom header for WSS testnet, so we reverse_proxy

export const BASE_URL = 'https://okx.tuleep.trade';
export const BASE_WS_URL = {
  public: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/public',
    testnet: 'wss://okx-testnet-wss.tuleep.trade/ws/v5/public?brokerId=9999',
  },
  private: {
    livenet: 'wss://wsaws.okx.com:8443/ws/v5/private',
    testnet: 'wss://okx-testnet-wss.tuleep.trade/ws/v5/private?brokerId=9999',
  },
};

export const ENDPOINTS = {
  MARKETS: '/api/v5/public/instruments',
  TICKERS: '/api/v5/market/tickers',
  BALANCE: '/api/v5/account/account-position-risk',
  POSITIONS: '/api/v5/account/positions',
  KLINE: '/api/v5/market/candles',
};
