import { OrderType } from '../../types';

export const RECV_WINDOW = 5000;

export const BASE_URL = {
  livenet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

export const BASE_WS_URL = {
  livenet: 'wss://api.hyperliquid.xyz/ws',
  testnet: 'wss://api.hyperliquid-testnet.xyz/ws',
};

export const ENDPOINTS = {
  INFO: '/info',
};

export const PUBLIC_ENDPOINTS = [];

export const ORDER_TYPE: Record<string, OrderType> = {
  Limit: OrderType.Limit,
  Market: OrderType.Market,
};
