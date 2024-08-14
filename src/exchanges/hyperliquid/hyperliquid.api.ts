import axios from 'axios';
import retry, { isNetworkError } from 'axios-retry';

import type { ExchangeOptions } from '../../types';

import { BASE_URL, PUBLIC_ENDPOINTS, RECV_WINDOW } from './hyperliquid.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    headers: { 'Content-Type': 'application/json' },
  });

  xhr.interceptors.request.use((config) => {
    if (PUBLIC_ENDPOINTS.some((str) => config.url?.startsWith(str))) {
      return config;
    }

    return {
      ...config,
      timeout: options?.extra?.recvWindow ?? RECV_WINDOW,
    };
  });

  retry(xhr, {
    retries: 3,
    retryCondition: isNetworkError,
  });

  return xhr;
};
