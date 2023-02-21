import ReconnectingWebsocket from 'reconnecting-websocket';
import type { WebSocketEventListenerMap } from 'reconnecting-websocket/dist/events';

class CustomWebSocket extends ReconnectingWebsocket {
  on = this.addEventListener.bind(this);
  off = this.removeEventListener.bind(this);

  pingMessage = JSON.stringify({ op: 'ping' });

  setPingMessage = (message: string) => {
    this.pingMessage = message;
  };

  once = <T extends keyof WebSocketEventListenerMap>(
    event: T,
    listener: WebSocketEventListenerMap[T]
  ) => {
    const handler: WebSocketEventListenerMap[T] = (message: any) => {
      this.removeEventListener(event, handler);
      listener(message);
    };

    this.addEventListener(event, handler);
  };

  ping = (pong: () => void) => {
    if (this.readyState === WebSocket.OPEN) {
      this.send(this.pingMessage);
      this.once('message', pong);
    } else {
      setTimeout(() => this.ping(pong), 1000);
    }
  };
}

export const createWebSocket = (
  input: string,
  ping: any = JSON.stringify({ op: 'ping' })
) => {
  const ws = new CustomWebSocket(input);
  ws.setPingMessage(ping);

  return ws;
};
