import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server | null = null;

export const initSocket = (server: HttpServer) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  io = new Server(server, {
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
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

export const getIo = (): Server => {
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
