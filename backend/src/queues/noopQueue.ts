import { AppError } from '../middleware/errorHandler';

export class NoopQueue {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  async add() {
    throw new AppError(
      `Queue "${this.name}" is disabled because REDIS_URL is not configured.`,
      503
    );
  }

  async addBulk() {
    throw new AppError(
      `Queue "${this.name}" is disabled because REDIS_URL is not configured.`,
      503
    );
  }

  async getJobs() {
    return [];
  }
}
