import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, PUBLIC_ENDPOINTS, RECV_WINDOW } from './phemex.types';

const getBaseURL = (options: ExchangeOptions) => {
  if (options.extra?.phemex?.http) {
    return options.testnet
      ? options.extra.phemex.http.testnet
      : options.extra.phemex.http.livenet;
  }

  return options.testnet ? BASE_URL.testnet : BASE_URL.livenet;
};

export const createAPI = (options: ExchangeOptions) => {
  const baseURL = getBaseURL(options);
  const baseURLWithCors = options.corsAnywhere
    ? `${options.corsAnywhere}/${baseURL}`
    : baseURL;

  const xhr = axios.create({
    baseURL: baseURLWithCors,
    headers: { 'Content-Type': 'application/json' },
  });

  retry(xhr, {
    retries: 3,
    retryCondition: isNetworkError,
  });

  xhr.interceptors.request.use((config) => {
    if (PUBLIC_ENDPOINTS.some((str) => config.url?.startsWith(str))) {
      return config;
    }

    const nextConfig = { ...config };

    const data = config.data ? JSON.stringify(config.data) : '';
    const params = config.params
      ? decodeURIComponent(qs.stringify(config.params))
      : '';

    const timeout = options?.extra?.recvWindow ?? RECV_WINDOW;
    const expiry = virtualClock.getCurrentTime().unix() + timeout;
    const toSign = [config.url, params, data, expiry].join('');

    const signature = createHmac('sha256', options.secret)
      .update(toSign)
      .digest('hex');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'x-phemex-access-token': options.key,
      'x-phemex-request-expiry': expiry,
      'x-phemex-request-signature': signature,
    });

    return {
      ...nextConfig,
      headers,
      timeout,
    };
  });

  return xhr;
};
