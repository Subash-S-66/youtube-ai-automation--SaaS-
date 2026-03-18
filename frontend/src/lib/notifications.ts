import { messaging } from '../lib/firebase';
import { getToken, isSupported } from 'firebase/messaging';
import { notificationService } from '../services/notificationService';

export const requestNotificationPermission = async () => {
  try {
    if (typeof window === 'undefined') return;

    const supported = await isSupported();
    if (!supported) {
      console.warn('Firebase Messaging is not supported in this browser.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      console.log('Notification permission granted.');

      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

      if (!messaging) {
        console.warn('Firebase messaging is not initialized.');
        return;
      }

      if (!vapidKey) {
        console.warn('Firebase VAPID key is not set. Using fallback logic or proceeding with undefined (not recommended).');
      }

      const currentToken = await getToken(messaging, { vapidKey });

      if (currentToken) {
        console.log('FCM Token retrieved:', currentToken);
        // Save the token to the backend
        await notificationService.saveToken(currentToken);
        return currentToken;
      } else {
        console.warn('No registration token available. Request permission to generate one.');
      }
    } else {
      console.warn('Notification permission denied or dismissed.');
    }
  } catch (error) {
    console.error('An error occurred while retrieving token:', error);
  }
};
