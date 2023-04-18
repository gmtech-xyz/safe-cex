import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, RECV_WINDOW } from './okx.types';

export const createAPI = (options: ExchangeOptions) => {
  const { corsAnywhere, passphrase } = options;

  if (!passphrase) {
    throw new Error('OKX requires a passphrase');
  }

  if (typeof window !== 'undefined' && !corsAnywhere) {
    throw new Error('OKX requires corsAnywhere in browser');
  }

  const xhr = axios.create({
    baseURL: corsAnywhere ? `${corsAnywhere}${BASE_URL}` : BASE_URL,
    timeout: RECV_WINDOW,
    headers: options.testnet ? { 'x-simulated-trading': 1 } : {},
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    if (config?.url?.includes('public')) {
      return config;
    }

    const nextConfig = { ...config };

    const method = config.method?.toUpperCase?.() || 'GET';
    const params = config.params ? qs.stringify(config.params) : null;
    const url = `${config.url}${params ? `?${params}` : ''}`;
    const data = config.data ? JSON.stringify(config.data) : null;

    const timestamp = virtualClock.getCurrentTime().toISOString();
    const toSign = [timestamp, method, url, data ? data : ''];

    const signature = createHmac('sha256', options.secret)
      .update(toSign.join(''))
      .digest('base64');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'OK-ACCESS-KEY': options.key,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
