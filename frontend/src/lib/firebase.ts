import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, Messaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

import { FirebaseApp } from 'firebase/app';

// Initialize Firebase only on the client side
let app: FirebaseApp | undefined;
let messaging: Messaging | null = null;

const hasFirebaseConfig =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.storageBucket &&
  !!firebaseConfig.messagingSenderId &&
  !!firebaseConfig.appId;

if (typeof window !== 'undefined' && hasFirebaseConfig) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

    // Check if messaging is supported (e.g., standard browser vs incognito)
    isSupported().then((supported) => {
      if (supported) {
        messaging = getMessaging(app);
      } else {
        console.warn('Firebase Messaging is not supported in this browser environment.');
      }
    });
  } catch (error) {
    console.error('Firebase initialization error', error);
  }
} else if (typeof window !== 'undefined' && !hasFirebaseConfig) {
  console.warn(
    'Firebase config is missing. Set NEXT_PUBLIC_FIREBASE_* env vars to enable Firebase.'
  );
}

export { app, messaging };
