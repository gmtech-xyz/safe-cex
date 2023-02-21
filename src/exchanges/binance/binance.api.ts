import axios from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import { omit } from 'lodash';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { getUTCTimestamp } from '../../utils/utc';

import { BASE_URL, ENDPOINTS, RECV_WINDOW } from './binance.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
    paramsSerializer: {
      serialize: (params) => qs.stringify(params, { arrayFormat: 'repeat' }),
    },
    headers: {
      'X-MBX-APIKEY': options.key,
      'Content-Type': 'application/json, chartset=utf-8',
    },
  });

  // retry requests on network errors instead of throwing
  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    // on livenet, don't sign listen key requests (they don't need it)
    if (config.url === ENDPOINTS.LISTEN_KEY && !options.testnet) {
      return config;
    }

    const nextConfig = { ...config };
    const timestamp = getUTCTimestamp().valueOf();

    const data = config.data || config.params || {};
    data.timestamp = timestamp;
    data.recvWindow = RECV_WINDOW;

    const asString = qs.stringify(data, { arrayFormat: 'repeat' });
    const signature = createHmac('sha256', options.secret)
      .update(asString)
      .digest('hex');

    data.signature = signature;
    nextConfig.params = data;

    // use cors-anywhere to bypass CORS
    // Binance doesn't allow CORS on their testnet API
    if (
      nextConfig.method !== 'get' &&
      options.testnet &&
      options.corsAnywhere
    ) {
      nextConfig.baseURL = `${options.corsAnywhere}/${config.baseURL}`;
    }

    // remove data from POST/PUT/DELETE requests
    // Binance API takes data as query params
    return omit(nextConfig, 'data');
  });

  return xhr;
};
