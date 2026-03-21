import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    socket = io(apiOrigin, {
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
};
