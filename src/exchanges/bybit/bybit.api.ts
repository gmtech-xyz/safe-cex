import axios, { AxiosHeaders } from 'axios';
import retry, { isNetworkError } from 'axios-retry';
import createHmac from 'create-hmac';
import qs from 'qs';

import type { ExchangeOptions } from '../../types';
import { virtualClock } from '../../utils/virtual-clock';

import {
  BASE_URL,
  BROKER_ID,
  PUBLIC_ENDPOINTS,
  RECV_WINDOW,
} from './bybit.types';

const isErrorSignature = (error: any) => {
  const isNetwork = isNetworkError(error);
  const isErrSign =
    error?.response?.data?.ret_msg?.includes('error sign!') ||
    error?.response?.data?.retMsg?.includes('error sign!');
  return isNetwork || isErrSign;
};

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    paramsSerializer: {
      serialize: (params) => qs.stringify(params),
    },
    headers: { 'Content-Type': 'application/json' },
  });

  // retry requests on network errors instead of throwing
  // and some signature errors
  retry(xhr, {
    retries: 3,
    retryCondition: isErrorSignature,
  });

  xhr.interceptors.request.use((config) => {
    // dont sign public endpoints and don't add timeout
    if (PUBLIC_ENDPOINTS.some((str) => config.url?.startsWith(str))) {
      return config;
    }

    const nextConfig = { ...config };

    const data =
      config.method === 'get'
        ? qs.stringify(config.params)
        : JSON.stringify(config.data);

    const timestamp = virtualClock.getCurrentTime().valueOf();
    const signature = createHmac('sha256', options.secret)
      .update([timestamp, options.key, RECV_WINDOW, data].join(''))
      .digest('hex');

    const headers = new AxiosHeaders({
      ...nextConfig.headers,
      'X-BAPI-SIGN': signature,
      'X-BAPI-API-KEY': options.key,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-Referer': BROKER_ID,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    });

    return {
      ...nextConfig,
      headers,
      timeout: options?.extra?.recvWindow ?? RECV_WINDOW,
    };
  });

  return xhr;
};
