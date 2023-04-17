import type { Order, Position, StoreData, Ticker } from '../types';

export interface Store {
  update: (changes: Partial<StoreData>) => void;
  reset: () => void;
  subscribe: (cb: (data: StoreData) => void) => () => void;

  setSetting: (key: 'isHedged', value: boolean) => void;

  removeOrder: (order: Pick<Order, 'id'>) => void;
  removeOrders: (ids: Array<Pick<Order, 'id'>>) => void;
  updateOrder: (id: Pick<Order, 'id'>, changes: Partial<Order>) => void;

  updatePosition: (
    position: Pick<Position, 'side' | 'symbol'>,
    changes: Partial<Position>
  ) => void;
  updatePositions: (
    updates: Array<[Pick<Position, 'side' | 'symbol'>, Partial<Position>]>
  ) => void;

  addOrder: (order: Order) => void;
  addOrUpdateOrder: (order: Order) => void;
  addOrUpdateOrders: (orders: Order[]) => void;

  updateTicker: (ticker: Pick<Ticker, 'id'>, changes: Partial<Ticker>) => void;

  get latency(): StoreData['latency'];
  get balance(): StoreData['balance'];
  get markets(): StoreData['markets'];
  get tickers(): StoreData['tickers'];
  get orders(): StoreData['orders'];
  get positions(): StoreData['positions'];
  get loaded(): StoreData['loaded'];
  get options(): StoreData['options'];
}
