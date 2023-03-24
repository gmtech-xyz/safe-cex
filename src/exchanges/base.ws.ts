import type { BaseExchange } from './base';

export class BaseWebSocket<T extends BaseExchange> {
  ws?: WebSocket;
  parent: T;

  pingAt = 0;

  constructor(parent: T) {
    this.parent = parent;
  }

  connectAndSubscribe = (): void => {
    throw new Error('Not implemented');
  };

  onOpen = (): void => {
    throw new Error('Not implemented');
  };

  onMessage = (_event: MessageEvent): void => {
    throw new Error('Not implemented');
  };

  onClose = () => {
    this.ws?.removeEventListener?.('open', this.onOpen);
    this.ws?.removeEventListener?.('message', this.onMessage);
    this.ws?.removeEventListener?.('close', this.onClose);
    this.ws = undefined;

    if (!this.parent.isDisposed) {
      this.connectAndSubscribe();
    }
  };

  dispose = () => {
    this.ws?.close?.();
  };
}
