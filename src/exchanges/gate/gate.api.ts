import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHash from 'create-hash';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, ENDPOINTS, RECV_WINDOW } from './gate.types';

const AUTH_ENDPOINTS: string[] = [ENDPOINTS.BALANCE];

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    if (!AUTH_ENDPOINTS.includes(config.url || '')) return config;

    const nextConfig = { ...config };

    const url = `/api/v4${config.url ? config.url : ''}`;
    const method = config.method?.toUpperCase?.() || 'GET';
    const params = config.params
      ? decodeURIComponent(qs.stringify(config.params))
      : '';

    const data = createHash('sha512')
      .update(config.data ? JSON.stringify(config.data) : '')
      .digest('hex');

    const timestamp = virtualClock.getCurrentTime().unix();
    const toSign = [method, url, params, data, timestamp].join('\n');

    const signature = createHmac('sha512', options.secret)
      .update(toSign)
      .digest('hex');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      KEY: options.key,
      SIGN: signature,
      Timestamp: timestamp,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
