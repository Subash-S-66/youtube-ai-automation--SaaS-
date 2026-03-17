import { IUser } from '../models/User';
import { sendEmail } from './emailService';
import { sendTelegramMessage } from './telegramService';

/**
 * Dispatches a notification via Email and/or Telegram concurrently based on user properties.
 */
export const notifyUser = async (user: IUser, subject: string, message: string): Promise<void> => {
  const dispatchPromises: Promise<void>[] = [];

  // Always attempt email since it is required per User schema
  if (user.email) {
    dispatchPromises.push(sendEmail(user.email, subject, message));
  }

  // Attempt Telegram if chat ID exists
  if (user.telegramChatId) {
    dispatchPromises.push(sendTelegramMessage(user.telegramChatId, message));
  }

  // Await all notification channels asynchronously without blocking if one fails
  await Promise.allSettled(dispatchPromises);
};
