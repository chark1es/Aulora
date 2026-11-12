import type { SocketLike } from "./streamer";

/** Wraps a browser `WebSocket` as the narrow {@link SocketLike} the streamer uses. */
export function openWebSocket(url: string): SocketLike {
  const socket = new WebSocket(url);
  const adapter: SocketLike = {
    get binaryType() {
      return socket.binaryType;
    },
    set binaryType(value: string) {
      socket.binaryType = value === "blob" ? "blob" : "arraybuffer";
    },
    get readyState() {
      return socket.readyState;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => {
      socket.send(data);
    },
    close: (code) => {
      socket.close(code);
    },
  };
  socket.onopen = () => {
    adapter.onopen?.();
  };
  socket.onmessage = (event: MessageEvent<unknown>) => {
    adapter.onmessage?.({ data: event.data });
  };
  socket.onclose = (event: CloseEvent) => {
    adapter.onclose?.({ code: event.code });
  };
  socket.onerror = () => {
    adapter.onerror?.();
  };
  return adapter;
}
