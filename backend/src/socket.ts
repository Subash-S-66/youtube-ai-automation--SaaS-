import { Server as HttpServer } from 'http';
import { getAllowedOrigins } from './utils/cors';

let io: any = null;

export const initSocket = (server: HttpServer) => {
  const allowedOrigins = getAllowedOrigins();

  let ServerCtor: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ServerCtor = require('socket.io').Server;
  } catch {
    console.warn('socket.io is not installed. Realtime features are disabled.');
    return null;
  }

  io = new ServerCtor(server, {
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });
  console.log('[Socket] Initialized');

  io.on('connection', (socket: any) => {
    console.log(`Socket client connected: ${socket.id}`);

    // User can join their specific room to receive personalized events
    socket.on('join', (userId: string) => {
      socket.join(userId);
      console.log(`Socket ${socket.id} joined room ${userId}`);
    });

    // Chat functionality
    socket.on('join_ticket', (ticketId: string) => {
      socket.join(ticketId);
      console.log(`Socket ${socket.id} joined ticket room ${ticketId}`);
    });

    // Admin functionality
    socket.on('join_admin_support', () => {
      socket.join('admin_support');
      console.log(`Admin Socket ${socket.id} joined admin_support room`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIo = (): any => {
  if (!io) {
    throw new Error('Socket.io is not initialized!');
  }
  return io;
};

// Event emitters to be used across the application
export const emitSubscriptionUpdate = (userId: string, data: any) => {
  if (io) io.to(userId).emit('subscription_updated', data);
};

export const emitFeatureAccessChange = (userId: string, data: any) => {
  if (io) io.to(userId).emit('feature_access_changed', data);
};

export const emitTicketCreated = (userId: string, data: any) => {
  // Can broadcast to admins or the user themselves
  if (io) io.emit('ticket_created', data);
};

export const getSocketIo = () => io;
