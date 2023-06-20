import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, BROKER_ID, RECV_WINDOW } from './bitget.types';

export const createAPI = (options: ExchangeOptions) => {
  const baseURL = options.corsAnywhere
    ? `${options.corsAnywhere}/${BASE_URL}`
    : BASE_URL;

  const xhr = axios.create({
    baseURL,
    timeout: RECV_WINDOW,
    paramsSerializer: {
      serialize: (params) => qs.stringify(params),
    },
    headers: {
      'ACCESS-KEY': options.key,
      'ACCESS-PASSPHRASE': options.passphrase,
      'X-CHANNEL-API-CODE': BROKER_ID,
      'Content-Type': 'application/json',
    },
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    const nextConfig = { ...config };

    const timestamp = virtualClock.getCurrentTime().valueOf();
    const method = config.method?.toUpperCase() ?? 'GET';

    let url = config.url;
    if (config.params) {
      const query = qs.stringify(config.params);
      url = `${url}?${query}`;
    }

    const stringifiedBody = config.data ? JSON.stringify(config.data) : '';
    const toSign = [timestamp, method, url, stringifiedBody].join('');

    const signature = createHmac('sha256', options.secret)
      .update(toSign)
      .digest('base64');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
    });

    return { ...nextConfig, headers };
  });

  return xhr;
};
