import type {
  Order,
  Position,
  StoreData,
  Ticker,
  WritableStoreData,
} from '../types';

import type { Store } from './store.interface';

export const defaultStore: StoreData = {
  latency: 0,
  balance: { used: 0, free: 0, total: 0, upnl: 0 },
  markets: [],
  tickers: [],
  positions: [],
  orders: [],
  loaded: {
    balance: false,
    orders: false,
    markets: false,
    tickers: false,
    positions: false,
  },
  options: {
    isHedged: false,
  },
};

export class DefaultStore implements Store {
  private listeners = new Set<(data: StoreData) => void>();
  private state: WritableStoreData = JSON.parse(
    JSON.stringify(defaultStore, null, 4)
  );

  get latency() {
    return this.state.latency;
  }

  get balance() {
    return this.state.balance;
  }

  get markets() {
    return this.state.markets;
  }

  get tickers() {
    return this.state.tickers;
  }

  get orders() {
    return this.state.orders;
  }

  get positions() {
    return this.state.positions;
  }

  get loaded() {
    return this.state.loaded;
  }

  get options() {
    return this.state.options;
  }

  update = (changes: Partial<StoreData>) => {
    Object.assign(this.state, changes);
    this.notify();
  };

  reset = () => {
    this.state = JSON.parse(JSON.stringify(defaultStore));
    this.notify();
  };

  subscribe = (cb: (data: StoreData) => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  removeOrders = (orders: Array<Pick<Order, 'id'>>) => {
    const idxs = orders.map((order) =>
      this.state.orders.findIndex((o) => o.id === order.id)
    );

    if (idxs.some((idx) => idx === -1)) {
      this.removeFromArray('orders', idxs);
      this.notify();
    }
  };

  removeOrder = (order: Pick<Order, 'id'>) => {
    const idx = this.state.orders.findIndex((o) => o.id === order.id);

    if (idx > -1) {
      this.removeFromArray('orders', [idx]);
      this.notify();
    }
  };

  updateOrder = (order: Pick<Order, 'id'>, changes: Partial<Order>) => {
    const idx = this.state.orders.findIndex((o) => o.id === order.id);

    if (idx > -1) {
      this.updateInArray('orders', idx, changes);
      this.notify();
    }
  };

  addOrder = (order: Order) => {
    this.state.orders.push(order);
    this.notify();
  };

  addOrUpdateOrder = (order: Order) => {
    const idx = this.state.orders.findIndex((o) => o.id === order.id);
    if (idx > -1) {
      this.updateInArray('orders', idx, order);
    } else {
      this.state.orders.push(order);
    }
    this.notify();
  };

  addOrUpdateOrders = (orders: Order[]) => {
    orders.forEach((order) => {
      const idx = this.state.orders.findIndex((o) => o.id === order.id);
      if (idx > -1) {
        this.updateInArray('orders', idx, order);
      } else {
        this.state.orders.push(order);
      }
    });
    this.notify();
  };

  removePosition = (position: Pick<Position, 'side' | 'symbol'>) => {
    const idx = this.state.positions.findIndex(
      (p) => p.side === position.side && p.symbol === position.symbol
    );

    if (idx > -1) {
      this.removeFromArray('positions', [idx]);
      this.notify();
    }
  };

  updatePosition = (
    position: Pick<Position, 'side' | 'symbol'>,
    changes: Partial<Position>
  ) => {
    const idx = this.state.positions.findIndex(
      (p) => p.side === position.side && p.symbol === position.symbol
    );

    if (idx > -1) {
      this.updateInArray('positions', idx, changes);
      this.notify();
    }
  };

  updatePositions = (
    updates: Array<[Pick<Position, 'side' | 'symbol'>, Partial<Position>]>
  ) => {
    const idexesChanges = updates.map(([position, changes]) => {
      const idx = this.state.positions.findIndex(
        (p) => p.side === position.side && p.symbol === position.symbol
      );
      return [idx, changes] as const;
    });

    if (idexesChanges.some(([idx]) => idx === -1)) {
      idexesChanges.forEach(([idx, changes]) =>
        this.updateInArray('positions', idx, changes)
      );
      this.notify();
    }
  };

  updateTicker = (ticker: Pick<Ticker, 'id'>, changes: Partial<Ticker>) => {
    const idx = this.state.tickers.findIndex((t) => t.id === ticker.id);

    if (idx > -1) {
      this.updateInArray('tickers', idx, changes);
      this.notify();
    }
  };

  setSetting = (key: keyof StoreData['options'], value: boolean) => {
    if (this.state.options[key] !== value) {
      this.state.options[key] = value;
      this.notify();
    }
  };

  private removeFromArray = <
    K extends 'markets' | 'orders' | 'positions' | 'tickers'
  >(
    key: K,
    indexes: number[]
  ) => {
    indexes
      .filter((idx) => idx > -1)
      .forEach((idx, lastIdx) => {
        const nextIdx = indexes[lastIdx] > idx ? idx + 1 : idx;
        this.state[key].splice(nextIdx, 1);
      });
  };

  private updateInArray = <
    K extends 'markets' | 'orders' | 'positions' | 'tickers'
  >(
    key: K,
    idx: number,
    changes: Partial<StoreData[K][number]>
  ) => {
    if (idx > -1 && key in this.state) {
      Object.assign(this.state[key][idx], changes);
    }
  };

  private notify = () => {
    this.listeners.forEach((cb) => cb(this.state));
  };
}
