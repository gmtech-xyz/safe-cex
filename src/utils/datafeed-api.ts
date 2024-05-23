import type {
  DatafeedConfiguration,
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
} from '../charting_library';
import type { BaseExchange } from '../exchanges/base';
import type { Timeframe } from '../types';

import { afterDecimal, multiply } from './safe-math';

export const TV_INTERVAL_TO_TIMEFRAME: Record<ResolutionString, Timeframe> = {
  ['1' as ResolutionString]: '1m',
  ['3' as ResolutionString]: '3m',
  ['5' as ResolutionString]: '5m',
  ['15' as ResolutionString]: '15m',
  ['30' as ResolutionString]: '30m',
  ['60' as ResolutionString]: '1h',
  ['120' as ResolutionString]: '2h',
  ['240' as ResolutionString]: '4h',
  ['360' as ResolutionString]: '6h',
  ['720' as ResolutionString]: '12h',
  ['1D' as ResolutionString]: '1d',
  ['1W' as ResolutionString]: '1w',
};

export const TIMEFRAME_TO_TV_INTERVAL: Record<Timeframe, ResolutionString> = {
  '1m': '1' as ResolutionString,
  '3m': '3' as ResolutionString,
  '5m': '5' as ResolutionString,
  '15m': '15' as ResolutionString,
  '30m': '30' as ResolutionString,
  '1h': '60' as ResolutionString,
  '2h': '120' as ResolutionString,
  '4h': '240' as ResolutionString,
  '6h': '360' as ResolutionString,
  '12h': '720' as ResolutionString,
  '1d': '1D' as ResolutionString,
  '1w': '1W' as ResolutionString,
};

export const createDatafeedAPI = (
  exchange: BaseExchange,
  customConfig: DatafeedConfiguration = {}
): IBasicDataFeed => {
  const WS_SUBSCRIBERS: Record<string, () => void> = {};

  const config = Object.assign(
    {
      supported_resolutions: ['1', '3', '5', '15', '60', '240', '1D'] as any,
      symbols_types: [{ name: 'crypto', value: 'crypto' }],
      exchanges: [
        { value: exchange.name, name: exchange.name, desc: exchange.name },
      ],
    },
    customConfig
  );

  return {
    onReady: (callback) => {
      const pollExchangeReady = () => {
        if (exchange.store.loaded.markets && exchange.store.loaded.tickers) {
          callback(config);
        } else {
          setTimeout(pollExchangeReady, 100);
        }
      };

      setTimeout(() => pollExchangeReady(), 0);
    },

    searchSymbols: (
      userInput,
      _exchange,
      _symbolType,
      onResultReadyCallback
    ) => {
      const tickers = exchange.store.tickers
        .filter((ticker) =>
          ticker.symbol
            .replace(/\/.+/, '')
            .toLowerCase()
            .includes(userInput.toLowerCase())
        )
        .map((ticker) => ({
          symbol: ticker.symbol,
          ticker: ticker.symbol,
          full_name: `${exchange.name}:${ticker.symbol}`,
          pro_name: `${exchange.name}:${ticker.symbol}`,
          description: ticker.symbol,
          exchange: exchange.name,
          type: 'crypto',
        }));

      setTimeout(() => onResultReadyCallback(tickers), 0);
    },

    resolveSymbol: (
      symbolName,
      onSymbolResolvedCallback,
      onResolveErrorCallback
    ) => {
      const market = exchange.store.markets.find(
        (m) => m.symbol === symbolName
      );

      const ticker = exchange.store.tickers.find(
        (t) => t.symbol === symbolName
      );

      if (!ticker || !market) {
        onResolveErrorCallback('Cannot resolve symbol');
        return;
      }

      const pricescale = 10 ** afterDecimal(market.precision.price);
      const minmov = multiply(market.precision.price, pricescale);

      const symbolInfo: LibrarySymbolInfo = {
        ticker: ticker.symbol,
        name: ticker.symbol,
        description: ticker.symbol,
        type: 'crypto',
        session: '24x7',
        timezone: 'Etc/UTC',
        exchange: exchange.name,
        listed_exchange: exchange.name,
        format: 'price',
        minmov,
        pricescale,
        has_intraday: true,
        visible_plots_set: 'ohlc',
        has_weekly_and_monthly: false,
        supported_resolutions: config.supported_resolutions,
        volume_precision: 2,
        data_status: 'streaming',
      };

      setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
    },

    getBars: async (
      symbolInfo,
      resolution,
      periodParams,
      onHistoryCallback
    ) => {
      // HACK: Phemex doesnt accept end timestamp, we need to remove a day
      if (exchange.name === 'PHEMEX' && resolution === '1D') {
        // eslint-disable-next-line no-param-reassign
        periodParams.to = periodParams.to - 60 * 60 * 24;
      }

      const bars = await exchange.fetchOHLCV({
        symbol: symbolInfo.name,
        interval: TV_INTERVAL_TO_TIMEFRAME[resolution],
        from: periodParams.from * 1000,
        to: periodParams.to * 1000,
        limit: periodParams.countBack,
      });

      if (bars.length === 0) {
        onHistoryCallback([], { noData: true });
        return;
      }

      const history = bars.map((bar) => ({
        time: bar.timestamp * 1000,
        low: bar.low,
        high: bar.high,
        open: bar.open,
        close: bar.close,
        volume: bar.volume,
      }));

      onHistoryCallback(history, { noData: false });
    },

    subscribeBars: (
      symbolInfo,
      resolution,
      onRealtimeCallback,
      subscriberUID
    ) => {
      WS_SUBSCRIBERS[subscriberUID] = exchange.listenOHLCV(
        {
          symbol: symbolInfo.name,
          interval: TV_INTERVAL_TO_TIMEFRAME[resolution],
        },
        (bar) => {
          onRealtimeCallback({
            time: bar.timestamp * 1000,
            low: bar.low,
            high: bar.high,
            open: bar.open,
            close: bar.close,
            volume: bar.volume,
          });
        }
      );
    },

    unsubscribeBars: (subscriberUID) => {
      if (WS_SUBSCRIBERS[subscriberUID]) {
        WS_SUBSCRIBERS[subscriberUID]();
        delete WS_SUBSCRIBERS[subscriberUID];
      }
    },
  };
};
