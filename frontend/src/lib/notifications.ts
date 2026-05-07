import { messaging } from '../lib/firebase';
import { getToken, isSupported } from 'firebase/messaging';
import { notificationService } from '../services/notificationService';

export const requestNotificationPermission = async () => {
  try {
    if (typeof window === 'undefined') return;

    const supported = await isSupported();
    if (!supported) {
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

      if (!messaging) {
        return;
      }

      if (!vapidKey) return;

      const currentToken = await getToken(messaging, { vapidKey });

      if (currentToken) {
        // Save the token to the backend
        await notificationService.saveToken(currentToken);
        return currentToken;
      }
    }
  } catch (error) {
    console.error('An error occurred while retrieving token:', error);
  }
};
