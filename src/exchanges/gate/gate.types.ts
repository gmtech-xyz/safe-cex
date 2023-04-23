import { OrderTimeInForce } from '../../types';

export const RECV_WINDOW = 5000;

export const BASE_URL = {
  livenet: 'https://fx-api.gateio.ws/api/v4',
  testnet: 'https://fx-api-testnet.gateio.ws/api/v4',
};

export const BASE_WS_URL = {
  livenet: 'wss://gate-wss.tuleep.trade/v4/ws/usdt',
  testnet: 'wss://gate-wss-testnet.tuleep.trade/v4/ws/usdt',
};

export const ENDPOINTS = {
  MARKETS: '/futures/usdt/contracts',
  TICKERS: '/futures/usdt/tickers',
  KLINE: '/futures/usdt/candlesticks',
  BALANCE: '/futures/usdt/accounts',
  ORDERS: '/futures/usdt/orders',
  BATCH_ORDERS: '/futures/usdt/batch_orders',
};

export const ORDER_TIME_IN_FORCE: Record<string, OrderTimeInForce> = {
  gtc: OrderTimeInForce.GoodTillCancel,
  ioc: OrderTimeInForce.ImmediateOrCancel,
  poc: OrderTimeInForce.PostOnly,
  fok: OrderTimeInForce.FillOrKill,
};
