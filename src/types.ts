export type ExchangeOptions = {
  readonly key: string;
  readonly secret: string;
  readonly passphrase?: string;
  readonly applicationId?: string;
  readonly testnet?: boolean;
  readonly corsAnywhere?: string;
  readonly extra?: Record<string, any>;
};

export type Balance = {
  readonly used: number;
  readonly free: number;
  readonly total: number;
  readonly upnl: number;
};

export type Market = {
  readonly id: string;
  readonly symbol: string;
  readonly base: string;
  readonly quote: string;
  readonly active: boolean;
  readonly precision: {
    readonly amount: number;
    readonly price: number;
  };
  readonly limits: {
    readonly amount: {
      readonly min: number;
      readonly max: number;
    };
    readonly leverage: {
      readonly min: number;
      readonly max: number;
    };
  };
};

export type Ticker = {
  readonly id: string;
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly last: number;
  readonly mark: number;
  readonly index: number;
  readonly percentage: number;
  readonly openInterest: number;
  readonly fundingRate: number;
  readonly volume: number;
  readonly quoteVolume: number;
};

export enum OrderStatus {
  Open = 'open',
  Closed = 'closed',
  Canceled = 'canceled',
}

export enum OrderType {
  Market = 'market',
  Limit = 'limit',
  StopLoss = 'stop_market',
  TakeProfit = 'take_profit_market',
  TrailingStopLoss = 'trailing_stop_market',
}

export enum OrderSide {
  Buy = 'buy',
  Sell = 'sell',
}

export enum OrderTimeInForce {
  GoodTillCancel = 'GoodTillCancel',
  ImmediateOrCancel = 'ImmediateOrCancel',
  FillOrKill = 'FillOrKill',
  PostOnly = 'PostOnly',
}

export type Order = {
  readonly id: string;
  readonly parentId?: string;
  readonly status: OrderStatus;
  readonly symbol: string;
  readonly type: OrderType;
  readonly side: OrderSide;
  readonly price: number;
  readonly amount: number;
  readonly filled: number;
  readonly remaining: number;
  readonly reduceOnly: boolean;
};

export enum PositionSide {
  Long = 'long',
  Short = 'short',
}

export type Position = {
  readonly symbol: string;
  readonly side: PositionSide;
  readonly entryPrice: number;
  readonly notional: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly contracts: number;
  readonly liquidationPrice: number;
};

export type Timeframe =
  | '1d'
  | '1h'
  | '1m'
  | '1w'
  | '2h'
  | '3m'
  | '4h'
  | '5m'
  | '6h'
  | '12h'
  | '15m'
  | '30m';

export type Candle = {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
};

export type PlaceOrderOpts = {
  readonly symbol: string;
  readonly type: OrderType;
  readonly side: OrderSide;
  readonly amount: number;
  readonly price?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly reduceOnly?: boolean;
  readonly timeInForce?: OrderTimeInForce;
};

export type UpdateOrderOpts = {
  readonly order: Order;
  readonly update: { readonly amount: number } | { readonly price: number };
};

export type OHLCVOptions = {
  readonly symbol: string;
  readonly interval: Timeframe;
};

export type OrderFillEvent = Pick<
  Order,
  'amount' | 'price' | 'side' | 'symbol'
>;

export enum LogSeverity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
}

export type OrderBookOrders = {
  price: number;
  amount: number;
  total: number;
};

export type OrderBook = {
  bids: OrderBookOrders[];
  asks: OrderBookOrders[];
};

export type StoreDataLoaded = {
  readonly balance: boolean;
  readonly orders: boolean;
  readonly markets: boolean;
  readonly tickers: boolean;
  readonly positions: boolean;
};

export type StoreOptions = {
  readonly isHedged: boolean;
};

export type StoreData = {
  readonly latency: number;
  readonly balance: Balance;
  readonly markets: Market[];
  readonly tickers: Ticker[];
  readonly orders: Order[];
  readonly positions: Position[];
  readonly loaded: StoreDataLoaded;
  readonly options: StoreOptions;
};

export type Writable<T> =
  // check for things that are objects but don't need changing
  T extends Date | RegExp | ((...args: any[]) => any)
    ? T
    : T extends ReadonlyMap<infer K, infer V> // maps
    ? Map<Writable<K>, Writable<V>> // make key and values writable
    : T extends ReadonlySet<infer U> // sets
    ? Set<Writable<U>> // make elements writable
    : T extends readonly unknown[] // is an array or tuple?
    ? `${bigint}` extends `${any & keyof T}` // is tuple
      ? { -readonly [K in keyof T]: Writable<T[K]> }
      : Array<Writable<T[number]>> // is regular array
    : T extends Record<string, unknown> // is regular object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T; // is primitive or literal value

export type WritableStoreData = {
  latency: number;
  balance: Writable<Balance>;
  markets: Array<Writable<Market>>;
  tickers: Array<Writable<Ticker>>;
  orders: Array<Writable<Order>>;
  positions: Array<Writable<Position>>;
  loaded: Writable<StoreDataLoaded>;
  options: Writable<StoreOptions>;
};
