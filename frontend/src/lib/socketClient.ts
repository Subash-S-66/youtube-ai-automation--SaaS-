import { io, Socket } from 'socket.io-client';
import { getApiOrigin } from './apiBase';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const apiOrigin = getApiOrigin();
    socket = io(apiOrigin, {
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
};
