export const RECV_WINDOW = 5000;
export const BROKER_ID = 'gmtech_trade';

export const BASE_URL = {
  livenet: 'https://vapi.phemex.com',
  testnet: 'https://testnet-api.phemex.com',
};

export const BASE_WSS_URL = {
  livenet: 'wss://vapi.phemex.com/ws',
  testnet: 'wss://testnet-api.phemex.com/ws',
};

export const ENDPOINTS = {
  SPOT_WALLETS: '/spot/wallets',
  MARKETS: '/public/products',
  TICKERS: '/md/v3/ticker/24hr/all',
};

export const PUBLIC_ENDPOINTS = [ENDPOINTS.MARKETS];
