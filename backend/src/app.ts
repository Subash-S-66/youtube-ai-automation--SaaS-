import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes';
import youtubeRoutes from './routes/youtubeRoutes';
import promptRoutes from './routes/promptRoutes';
import pipelineRoutes from './routes/pipelineRoutes';
import { errorHandler, AppError } from './middleware/errorHandler';

const app: Application = express();

// Security Middleware
app.use(helmet());

// CORS Middleware
app.use(cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/prompt', promptRoutes);
app.use('/api/pipeline', pipelineRoutes);

// Base route
app.get('/', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Welcome to the API' });
});

// Handle undefined routes
app.all('*', (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// Global Error Handler
app.use(errorHandler);

export default app;
