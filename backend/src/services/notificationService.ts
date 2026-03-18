import { IUser } from '../models/User';
import { sendEmail } from './emailService';
import { sendTelegramMessage } from './telegramService';
import * as admin from 'firebase-admin';

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

  // Attempt Push Notification if fcmToken exists
  if (user.fcmToken) {
    dispatchPromises.push(sendPushNotification(user, subject, message));
  }

  // Await all notification channels asynchronously without blocking if one fails
  await Promise.allSettled(dispatchPromises);
};

/**
 * Sends a push notification to the user via Firebase Cloud Messaging.
 */
export const sendPushNotification = async (user: IUser, title: string, body: string): Promise<void> => {
  if (!user.fcmToken) return;

  try {
    if (!admin.apps.length) {
      console.warn('Firebase Admin not initialized. Skipping push notification.');
      return;
    }

    const payload = {
      notification: {
        title,
        body,
      },
      token: user.fcmToken,
    };

    const response = await admin.messaging().send(payload);
    console.log(`Successfully sent push notification to ${user.email}:`, response);
  } catch (error: any) {
    console.error(`Failed to send push notification to ${user.email}:`, error);

    // If the token is invalid or unregistered, remove it from the user document
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.log(`Removing invalid FCM token for user ${user.email}`);
      user.fcmToken = undefined;
      await user.save().catch((saveError) => console.error('Failed to clear invalid FCM token', saveError));
    }
  }
};
