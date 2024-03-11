import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import { nanoid } from 'nanoid';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { toBase64 } from '../../utils/base64';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, RECV_WINDOW } from './blofin.types';

export const createAPI = (options: ExchangeOptions) => {
  const baseURL = options.corsAnywhere
    ? `${options.corsAnywhere}/${BASE_URL}`
    : BASE_URL;

  const xhr = axios.create({
    baseURL,
    timeout: options?.extra?.recvWindow ?? RECV_WINDOW,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  retry(xhr, {
    retries: 3,
    retryCondition: isNetworkError,
  });

  xhr.interceptors.request.use((config) => {
    if (config.method === 'get' && config.url?.includes?.('/market/')) {
      return config;
    }

    const nextConfig = { ...config };

    const method = config.method?.toUpperCase?.() || 'GET';
    const params = config.params
      ? decodeURIComponent(qs.stringify(config.params))
      : null;

    const url = `${config.url}${params ? `?${params}` : ''}`;
    const data = config.data ? JSON.stringify(config.data) : '';

    const timestamp = virtualClock.getCurrentTime().valueOf();
    const nonce = nanoid().replace(/-/g, '');
    const toSign = [url, method, timestamp, nonce, data];

    const signature = toBase64(
      createHmac('sha256', options.secret).update(toSign.join('')).digest('hex')
    );

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'ACCESS-KEY': options.key,
      'ACCESS-PASSPHRASE': options.passphrase || '',
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-NONCE': nonce,
      'ACCESS-SIGN': signature,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
