import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, BROKER_ID, ENDPOINTS, RECV_WINDOW } from './bybit.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
    paramsSerializer: {
      serialize: (params) => qs.stringify(params),
    },
    headers: {
      'X-Referer': BROKER_ID,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'Content-Type': 'application/json, charset=utf-8',
    },
  });

  // retry requests on network errors instead of throwing
  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    const nextConfig = { ...config };

    if (config.method === 'get' && config.url === ENDPOINTS.KLINE) {
      return { ...nextConfig, headers: new AxiosHeaders({}) };
    }

    const timestamp = virtualClock.getCurrentTime();
    const data =
      config.method === 'get'
        ? qs.stringify(config.params)
        : JSON.stringify(config.data);

    const signature = createHmac('sha256', options.secret)
      .update([timestamp, options.key, RECV_WINDOW, data].join(''))
      .digest('hex');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'X-BAPI-SIGN': signature,
      'X-BAPI-API-KEY': options.key,
      'X-BAPI-TIMESTAMP': timestamp,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
