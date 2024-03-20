import flatten from 'lodash/flatten';

import type { OrderBook, OrderBookOrders } from '../../types';
import { jsonParse } from '../../utils/json-parse';
import { calcOrderBookTotal, sortOrderBook } from '../../utils/orderbook';
import { roundUSD } from '../../utils/round-usd';
import { multiply } from '../../utils/safe-math';
import { BaseWebSocket } from '../base.ws';

import type { OKXExchange } from './okx.exchange';
import { BASE_WS_URL } from './okx.types';

type Data = Record<string, any>;
type MessageHandlers = {
  [channel: string]: (json: Data) => void;
};
type SubscribedTopics = {
  [id: string]: Array<{ channel: string; instId: string }>;
};

export class OKXPublicWebsocket extends BaseWebSocket<OKXExchange> {
  topics: SubscribedTopics = {};
  messageHandlers: MessageHandlers = {
    tickers: (d: Data) => this.handleTickerEvents(d),
    'mark-price': (d: Data) => this.handleMarkPriceEvents(d),
    'index-tickers': (d: Data) => this.handleIndexTickerEvents(d),
    'open-interest': (d: Data) => this.handleOpenInterestEvents(d),
    'funding-rate': (d: Data) => this.handleFundingRateEvents(d),
  };

  connectAndSubscribe = () => {
    if (!this.isDisposed) {
      this.ws = new WebSocket(
        BASE_WS_URL.public[this.parent.options.testnet ? 'testnet' : 'livenet']
      );

      this.topics.tickers = this.store.markets.map((m) => ({
        channel: 'tickers',
        instId: m.id,
      }));

      this.topics['mark-price'] = this.store.markets.map((m) => ({
        channel: 'mark-price',
        instId: m.id,
      }));

      this.topics['index-tickers'] = this.store.markets.map((m) => ({
        channel: 'index-tickers',
        instId: m.id.replace('-SWAP', ''),
      }));

      this.topics['open-interest'] = this.store.markets.map((m) => ({
        channel: 'open-interest',
        instId: m.id,
      }));

      this.topics['funding-rate'] = this.store.markets.map((m) => ({
        channel: 'funding-rate',
        instId: m.id,
      }));

      this.ws.addEventListener('open', this.onOpen);
      this.ws.addEventListener('message', this.onMessage);
      this.ws.addEventListener('close', this.onClose);
    }
  };

  onOpen = () => {
    if (!this.isDisposed) {
      this.subscribe();
      this.ping();
    }
  };

  ping = () => {
    if (!this.isDisposed) {
      this.ws?.send?.('ping');
    }
  };

  subscribe = () => {
    const topics = flatten(Object.values(this.topics));
    const payload = { op: 'subscribe', args: topics };
    this.ws?.send?.(JSON.stringify(payload));
  };

  onMessage = ({ data }: MessageEvent) => {
    if (!this.isDisposed) {
      if (data === 'pong') {
        this.handlePongEvent();
        return;
      }

      for (const [channel, handler] of Object.entries(this.messageHandlers)) {
        if (
          data.includes(`channel":"${channel}`) &&
          !data.includes('event":"subscribe"')
        ) {
          const json = jsonParse(data);
          if (json) handler(json);
          break;
        }
      }
    }
  };

  handlePongEvent = () => {
    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId);
      this.pingTimeoutId = undefined;
    }

    this.pingTimeoutId = setTimeout(() => this.ping(), 10_000);
  };

  handleTickerEvents = ({ data: [update] }: Data) => {
    const open = parseFloat(update.open24h);
    const last = parseFloat(update.last);
    const percentage = roundUSD(((last - open) / open) * 100);

    this.store.updateTicker(
      { id: update.instId },
      {
        bid: parseFloat(update.bidPx),
        ask: parseFloat(update.askPx),
        last,
        percentage,
        volume: parseFloat(update.volCcy24h),
        quoteVolume: parseFloat(update.vol24h),
      }
    );
  };

  handleMarkPriceEvents = ({ data: [update] }: Data) => {
    this.store.updateTicker(
      { id: update.instId },
      { mark: parseFloat(update.markPx) }
    );
  };

  handleIndexTickerEvents = ({ data: [update] }: Data) => {
    this.store.updateTicker(
      { id: `${update.instId}-SWAP` },
      { index: parseFloat(update.idxPx) }
    );
  };

  handleOpenInterestEvents = ({ data: [update] }: Data) => {
    this.store.updateTicker(
      { id: update.instId },
      { openInterest: parseFloat(update.oiCcy) }
    );
  };

  handleFundingRateEvents = ({ data: [update] }: Data) => {
    this.store.updateTicker(
      { id: update.instId },
      { fundingRate: parseFloat(update.fundingRate) }
    );
  };

  listenOrderBook = (
    symbol: string,
    callback: (orderBook: OrderBook) => void
  ) => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (!this.store.loaded.markets) {
      timeoutId = setTimeout(() => this.listenOrderBook(symbol, callback), 100);

      return () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
    }

    const market = this.store.markets.find((m) => m.symbol === symbol);
    if (!market) return () => {};

    const sides = ['bids', 'asks'] as const;
    const orderBook: OrderBook = { bids: [], asks: [] };
    const topic = { channel: 'books', instId: market.id };

    const waitForConnectedAndSubscribe = () => {
      if (this.isConnected) {
        if (!this.isDisposed) {
          this.messageHandlers.books = (data: Data) => {
            if (data.action === 'snapshot') {
              const {
                data: [snapshot],
              } = data;

              sides.forEach((side) => {
                orderBook[side] = snapshot[side].reduce(
                  (acc: OrderBookOrders[], [price, amount]: string[]) => {
                    if (parseFloat(amount) === 0) return acc;
                    return [
                      ...acc,
                      {
                        price: parseFloat(price),
                        amount: multiply(
                          parseFloat(amount),
                          market.precision.amount
                        ),
                      },
                    ];
                  },
                  []
                );
              });
            }

            if (data.action === 'update') {
              const {
                data: [update],
              } = data;

              sides.forEach((side) => {
                for (const [rPrice, rAmount] of update[side]) {
                  const price = parseFloat(rPrice);
                  const amount = parseFloat(rAmount);

                  const index = orderBook[side].findIndex(
                    (b) => b.price === price
                  );

                  if (amount === 0 && index !== -1) {
                    orderBook[side].splice(index, 1);
                    return;
                  }

                  if (amount !== 0) {
                    if (index === -1) {
                      orderBook[side].push({
                        price,
                        amount: multiply(amount, market.precision.amount),
                        total: 0,
                      });
                      return;
                    }

                    orderBook[side][index].amount = multiply(
                      amount,
                      market.precision.amount
                    );
                  }
                }
              });
            }

            const ticker = this.store.tickers.find(
              (t) => t.symbol === market.symbol
            );

            const lastPrice = ticker?.last || 0;
            orderBook.asks = orderBook.asks.filter((a) => a.price >= lastPrice);
            orderBook.bids = orderBook.bids.filter((b) => b.price <= lastPrice);

            sortOrderBook(orderBook);
            calcOrderBookTotal(orderBook);

            callback(orderBook);
          };

          const payload = JSON.stringify({ op: 'subscribe', args: [topic] });
          this.ws?.send?.(payload);

          // store subscribed topic to re-subscribe on reconnect
          this.topics.orderBook = [topic];
        }
      } else {
        timeoutId = setTimeout(() => waitForConnectedAndSubscribe(), 100);
      }
    };

    waitForConnectedAndSubscribe();

    return () => {
      delete this.messageHandlers.books;
      delete this.topics.orderBook;
      orderBook.bids = [];
      orderBook.asks = [];

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (this.isConnected) {
        const payload = { op: 'unsubscribe', args: [topic] };
        this.ws?.send?.(JSON.stringify(payload));
      }
    };
  };
}
