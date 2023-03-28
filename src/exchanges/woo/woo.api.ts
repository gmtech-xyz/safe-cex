import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, RECV_WINDOW } from './woo.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
    paramsSerializer: {
      serialize: (params) => qs.stringify(params),
    },
    headers: {
      'x-api-key': options.key,
    },
  });

  // retry requests on network errors instead of throwing
  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    // don't sign public endpoints requests
    if (config.url?.includes?.('/public/')) {
      return config;
    }

    const nextConfig = { ...config };

    const timestamp = virtualClock.getCurrentTime();
    const textSign = [
      timestamp,
      config?.method?.toUpperCase?.() || 'GET',
      config.url,
      config.data ? JSON.stringify(config.data) : '',
    ].join('');

    const signature = createHmac('sha256', options.secret)
      .update(textSign)
      .digest('hex');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'x-api-timestamp': timestamp,
      'x-api-signature': signature,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
