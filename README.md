# safe-cex

> An OpenSource TypeScript library to create rich trading cryptocurrencies interfaces

## Introduction

It is an Open-source TypeScript library that provides an easy-to-use interface for communicating with exchanges. It is designed to be used by trading platforms like tuleep.trade, allowing them to interact with exchanges like Bybit and Binance Futures to execute trades on behalf of their users.

The library includes a set of API methods that abstract away the complexities of the exchanges' REST and WebSocket APIs, providing a simple and consistent interface for managing orders, positions, balances, and more.

It also implements robust error handling, rate limiting, and other safeguards to prevent common trading pitfalls and ensure the safety of user funds.

One key feature of safe-cex is its support for multiple exchanges, which allows tuleep.trade to offer a wider range of trading options to its users.

Currently, the library supports Bybit and Binance Futures contracts, with plans to add more exchanges in the future.

## Differences with CCXT

- safe-cex handles for you the lifecycle of fetching, and updating data from exchanges
- safe-cex exposes simple methods to place any type of orders
- safe-cex handles for you orders size limits and precisions of orders
- safe-cex expose the same interface for every exchanges
- safe-cex is oriented for in-browser usage

## Exchanges supported

- [Bybit](https://www.bybit.com/app/register?ref=7APGQQ) futures USDT contracts (not the unified margin)
- [Binance](https://accounts.binance.com/en/register?ref=KOLLSXK0) USD-M futures (USDT & BUSD contracts)

---

## Installation

- `npm install --save safe-cex`

## Getting started

To initialize the exchange library, you will need:

- API key / secret
- A CORS-Anywhere server if you are using Binance testnet (they do not support CORS)

```ts
import { createExchange } from "safe-cex";

// Initialize exchange class object
const exchange = createExchange("bybit" | "binance", {
  key: API_KEY,
  secret: API_SECRET,
  testnet: boolean,
  corsAnywhere: "https://cors-anywhere.example.com",
});

// Start the exchange syncronization
// - will fetch markets, tickers, orders, positions, balance...
await exchange.start();
```

## Exchange store

safe-cex maintains a inner-store with all the up-to-date exchanges informations:

```ts
type Store = {
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
};
```

This store is a "proxy" object using [valtio](https://github.com/pmndrs/valtio) library, this means you can subscribe to its changes and use it into a ReactJS application out of the box without adding other state management libraries.

## Events

safe-cex creates an exchange is an event-emitter object, you can subscribe to events and react accordingly.

### `update`

This event is called everytime the inner-store of safe-cex is updated.

```ts
let storeCopy = {};

exchange.on("update", (store: Store) => {
  console.log("exchange store update");
  storeCopy = store;
});
```

### `fill`

This event is called when an order is filled, this allows you to display a notification when this happens.

```ts
type FillEvent = {
  amount: number;
  price: number;
  side: "buy" | "sell";
  symbol: string;
};

exchange.on("fill", (event: FillEvent) => {
  console.log(
    `${event.side} ${event.amount} ${event.symbol} at ${event.price}`
  );
});
```

### `error`

This event is called when an error has occured or the exchange API responded with an error status.

```ts
exchange.on("error", (event: string) => {
  window.alert(error);
});
```

### `log`

This event is called when a new log message is emitted, you can display those debuging purposes.

```ts
enum LogSeverity {
  Warning = "warning",
  Error = "error",
  Info = "info",
}

exchange.on("log", (message: string, severity: LogSeverity) => {
  console.log(`[${severity}] ${message}`);
});
```

## Public methods

### `validateAccount()`

- Can be called before `exchange.start()` to ensure API keys are valid and have the right permissions
- Returns an empty string if valid, otherwise returns a string with error

### `start()`

- Method to be called before trying to place orders
- It starts the lifecycle of safe-cex and fetch all the needed data
- You can use `store.loaded` object to know when it's ready

### `fetchOHLCV()`

```ts
type Timeframe =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "12h"
  | "1d"
  | "1w";

type OHLCVOptions = {
  symbol: string;
  interval: Timeframe;
};

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const candles: Candle[] = await exchange.fetchOHLCV({
  // market symbol, can be found in exchange.store.markets[index].symbol
  symbol: "BTCUSDT",
  timeframe: "15m",
});
```

### `listenOHLCV()`

- Subscribe to exchange kline websocket
- Takes a `callback()` function to be called when candle has been updated
- Returns a `dispose()` function to un-subscribe websocket topic

```ts
const callback = (candle: Candle) => {
  console.log(`Candle updated, current price: ${candle.close}`);
};

const dispose = exchange.listenOHLCV(
  { symbol: "BTCUSDT", timeframe: "15m" },
  callback
);

// when finished listening
dispose();
```

### `placeOrder()`

- Method to create an order on exchange
- Can set stopLoss / takeProfit at the same time
- Returns an Array of orderIds

```ts
enum OrderType {
  Market = "market",
  Limit = "limit",
  StopLoss = "stop_market",
  TakeProfit = "take_profit_market",
}

enum OrderSide {
  Buy = "buy",
  Sell = "sell",
}

enum OrderTimeInForce {
  GoodTillCancel = "GoodTillCancel",
  ImmediateOrCancel = "ImmediateOrCancel",
  FillOrKill = "FillOrKill",
  PostOnly = "PostOnly",
}

type PlaceOrderOpts = {
  symbol: string;
  type: OrderType;
  side: OrderSide;
  amount: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
  timeInForce?: OrderTimeInForce;
};

// Place a market order of 0.25 BTC
await exchange.placeOrder({
  symbol: "BTCUSDT",
  type: OrderType.Market,
  side: OrderSide.Buy,
  amount: 0.25,
});

// Place a limit order of 1 ETH at 1700$
// and set stopLoss at 1650
// and set takeProfit at 1750
const orderIds: string[] = await exchange.placeOrder({
  symbol: "ETHUSDT",
  type: OrderType.Limit,
  side: OrderSide.Buy,
  amount: 1,
  price: 1700,
  stopLoss: 1650,
  takeProfit: 1750,
  timeInForce: OrderTimeInForce.GoodTillCancel,
});
```

### `placeOrders()`

- Same method as `placeOrder()` but for multiple orders
- Pease use this method when possible, it will batch orders creations on exchanges API
- There's no limit of orders to be passed
- Returns an Array of orderIds

### `updateOrder()`

- Method to be called for updating an order price or amount
- This supports updating price of take profit and stop loss orders
- Returns an Array of orderIds

```ts
//  we take the first existing order as example
const originalOrder = exchange.store.orders[0];

// update price of order
const updatedOrderIds: string[] = await exchange.updateOrder({
  order: originalOrder,
  update: { price: 1700 },
});

// update amount of order
const updatedOrderIds: string[] = await exchange.updateOrder({
  order: originalOrder,
  update: { amount: 2 },
});
```

### `cancelOrders()`

- Method for cancelling multiple orders at the same time

```ts
const orders = [exchange.store.orders[0], exchange.store.orders[1]];
await exchange.cancelOrders(orders);
```

### `cancelSymbolOrders()`

- Method for cancelling all orders relative to a symbol

```ts
await exchange.cancelSymbolOrders("BTCUSDT");
```

### `cancelAllOrders()`

- Method for cancelling all existing orders

```ts
await exchange.cancelAllOrders();
```

### `setLeverage()`

- Method used to update the leverage on a symbol
- It will check for min/max leverage of market and will stay in those boundaries
  - eg: you set leverage x50 but market accepts max x25, it will be set to x25

```ts
await exchange.setLeverage("BTCUSDT", 125);
```

### `setAllLeverage()`

- Method used to update all the leverage setting for all markets
- It will check for min/max leverage of market and will stay in those boundaries

```ts
await exchange.setAllLeverage(100);
```

### `nuke()`

- Closes all positions at market price
- Cancel all existing orders

```ts
await exchange.nuke();
```

### `dispose()`

- Method to be called when you don't need the exchange instance anymore
- It has to be called for cleaning all subscribtions, data streams with exchange, etc...

```ts
await exchange.dispose();
```

---

## Known issues

### VueJS

You need to add [vite-plugin-node-stdlib-browser](https://github.com/sodatea/vite-plugin-node-stdlib-browser) to your vite config.

## Donations

If you found this project interesting or useful, create accounts with my referral links:

- [Bybit](https://www.bybit.com/app/register?ref=7APGQQ)
- [Binance](https://accounts.binance.com/en/register?ref=KOLLSXK0)

Or buy me a coffee with a crypto donation:

- ETH/BSC/MATIC/AVAX: `0xf8a303250c64CEeabC58DcB2688213FACb3cc4e4`

## Contributions & Pull Requests

Feel free to create issues, PRs and start a discussion ??????
