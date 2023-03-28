import type { AxiosRequestConfig } from 'axios';
import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import { BASE_URL, RECV_WINDOW } from './woo.types';

const signV1 = (config: AxiosRequestConfig, options: ExchangeOptions) => {
  const nextConfig = { ...config };

  const data = config.data || config.params || {};
  const asString = qs.stringify(data, {
    arrayFormat: 'repeat',
    sort: (a, b) => a.localeCompare(b),
  });

  const timestamp = virtualClock.getCurrentTime();
  const signature = createHmac('sha256', options.secret)
    .update(`${asString}|${timestamp}`)
    .digest('hex');

  const headers = new AxiosHeaders({
    ...nextConfig.headers,
    'x-api-timestamp': timestamp,
    'x-api-signature': signature,
  });

  return { ...nextConfig, headers };
};

const signV3 = (c: AxiosRequestConfig, options: ExchangeOptions) => {
  // we need to uppercase the method and default to GET
  const nextConfig = { ...c, method: c.method?.toUpperCase?.() || 'GET' };

  // we do the serialization of params once here
  // because we need it in the signature
  if (nextConfig.params) {
    nextConfig.url = `${nextConfig.url}?${qs.stringify(nextConfig.params)}`;
    delete nextConfig.params;
  }

  const timestamp = virtualClock.getCurrentTime();
  const textSign = [
    timestamp,
    nextConfig.method,
    nextConfig.url,
    nextConfig.data ? JSON.stringify(nextConfig.data) : '',
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
};

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
    paramsSerializer: { serialize: (params) => qs.stringify(params) },
    headers: { 'x-api-key': options.key },
  });

  // retry requests on network errors instead of throwing
  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  xhr.interceptors.request.use((config) => {
    // don't sign public endpoints requests
    if (config.url?.includes?.('/public/')) {
      return config;
    }

    // sign v1 endpoints requests
    if (config.url?.includes('v1')) {
      return signV1(config, options);
    }

    // sign v3 endpoints requests
    return signV3(config, options);
  });

  return xhr;
};
