import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, PUBLIC_ENDPOINTS, RECV_WINDOW } from './okx.types';

export const createAPI = (options: ExchangeOptions) => {
  const { passphrase } = options;

  if (!passphrase) {
    throw new Error('OKX requires a passphrase');
  }

  const baseURL = options.corsAnywhere
    ? `${options.corsAnywhere}/${BASE_URL}`
    : BASE_URL;

  const xhr = axios.create({
    baseURL,
    headers: options.testnet ? { 'x-simulated-trading': 1 } : {},
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    // dont sign public endpoints and don't add timeout
    if (PUBLIC_ENDPOINTS.some((str) => config?.url?.startsWith(str))) {
      return config;
    }

    const nextConfig = { ...config };

    const method = config.method?.toUpperCase?.() || 'GET';
    const params = config.params
      ? decodeURIComponent(qs.stringify(config.params))
      : null;
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

    return {
      ...nextConfig,
      headers,
      timeout: options?.extra?.recvWindow ?? RECV_WINDOW,
    };
  });

  return xhr;
};
