import { OrderSide, OrderType } from '../../types';

export const RECV_WINDOW = 5000;
export const BASE_URL = {
  testnet: 'https://testnet.binance.vision',
  livenet: 'https://api.binance.com',
};

export const BASE_WS_URL = {
  livenet: 'wss://stream.binance.com:9443/ws',
  testnet: 'wss://testnet.binance.vision/ws',
};

export const ENDPOINTS = {
  BALANCE: '/sapi/v3/asset/getUserAsset',
  ACCOUNT: '/sapi/v1/account/status',
  AVG_PRICE: '/api/v3/avgPrice',
  MARKETS: '/api/v3/exchangeInfo',
  TICKERS: '/api/v3/ticker/24hr',
  OPEN_ORDERS: '/api/v3/openOrders',
  ORDER: '/api/v3/order',
  KLINE: '/api/v3/uiKlines',
};

export const PUBLIC_ENDPOINTS = [
  ENDPOINTS.AVG_PRICE,
  ENDPOINTS.MARKETS,
  ENDPOINTS.TICKERS,
  ENDPOINTS.KLINE,
];

export const ORDER_SIDE: Record<string, OrderSide> = {
  BUY: OrderSide.Buy,
  SELL: OrderSide.Sell,
};

export const ORDER_TYPE: Record<string, OrderType> = {
  LIMIT: OrderType.Limit,
  MARKET: OrderType.Market,
  STOP_LOSS_LIMIT: OrderType.StopLoss,
};
