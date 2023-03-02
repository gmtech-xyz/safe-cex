export type ExchangeOptions = {
  key: string;
  secret: string;
  testnet?: boolean;
  corsAnywhere?: string;
};

export type Store = {
  latency: number;
  balance: Balance;
  markets: Market[];
  tickers: Ticker[];
  orders: Order[];
  positions: Position[];
  loaded: {
    balance: boolean;
    orders: boolean;
    markets: boolean;
    tickers: boolean;
    positions: boolean;
  };
  options: {
    isHedged: boolean;
    isSpot: boolean;
  };
};

export type Balance = {
  used: number;
  free: number;
  total: number;
  upnl: number;
};

export type Market = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  active: boolean;
  precision: {
    amount: number;
    price: number;
  };
  limits: {
    amount: {
      min: number;
      max: number;
    };
    leverage: {
      min: number;
      max: number;
    };
  };
};

export type Ticker = {
  id: string;
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  index: number;
  percentage: number;
  openInterest: number;
  fundingRate: number;
  volume: number;
  quoteVolume: number;
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
}

export enum OrderSide {
  Buy = 'buy',
  Sell = 'sell',
}

export type Order = {
  id: string;
  status: OrderStatus;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  price: number;
  amount: number;
  filled: number;
  remaining: number;
};

export enum PositionSide {
  Long = 'long',
  Short = 'short',
}

export type Position = {
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  notional: number;
  leverage: number;
  unrealizedPnl: number;
  contracts: number;
  liquidationPrice: number;
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
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PlaceOrderOpts = {
  symbol: string;
  type: OrderType;
  side: OrderSide;
  amount: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
};

export type UpdateOrderOpts = {
  order: Order;
  update: { amount: number } | { price: number };
};

export type OHLCVOptions = {
  symbol: string;
  interval: Timeframe;
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
