import axios from 'axios';
import retry, { isNetworkError } from 'axios-retry';

import type { ExchangeOptions } from '../../types';

import { BASE_URL, RECV_WINDOW } from './okx.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL,
    timeout: RECV_WINDOW,
    headers: options.testnet ? { 'x-simulated-trading': 1 } : {},
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  return xhr;
};
