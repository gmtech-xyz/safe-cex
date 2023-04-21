import axios from 'axios';
import retry, { isNetworkError } from 'axios-retry';

import type { ExchangeOptions } from '../../types';

import { BASE_URL, RECV_WINDOW } from './gate.types';

export const createAPI = (options: ExchangeOptions) => {
  const xhr = axios.create({
    baseURL: BASE_URL[options.testnet ? 'testnet' : 'livenet'],
    timeout: RECV_WINDOW,
  });

  retry(xhr, { retries: 3, retryCondition: isNetworkError });

  return xhr;
};
