import { Server as HttpServer } from 'http';

let io: any = null;

export const initSocket = (server: HttpServer) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

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
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket: any) => {
    console.log(`Socket client connected: ${socket.id}`);

    // User can join their specific room to receive personalized events
    socket.on('join', (userId: string) => {
      socket.join(userId);
      console.log(`Socket ${socket.id} joined room ${userId}`);
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
