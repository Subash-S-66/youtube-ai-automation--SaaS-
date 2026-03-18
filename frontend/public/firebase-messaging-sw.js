importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

// Extract config from query parameters or inject via build process if preferred
// But typically for SW we hardcode or fetch dynamically. Given instructions say to use env variables,
// Service workers in nextjs can't access `process.env` directly if they are static files in `public/`.
// As a best-effort workaround for static SW in Next.js without a custom bundler,
// we will rely on an endpoint or parse url params if provided, but typically the standard way
// is to inject it during SW registration or use a config file.

// A common approach for Next.js is to define standard config params that matching our placeholder approach.
// To satisfy "use placeholders from env" we will use placeholder strings that the developer would replace
// or use URL parameters injected during registration.
// Let's use standard placeholders.

const firebaseConfig = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY_PLACEHOLDER",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN_PLACEHOLDER",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID_PLACEHOLDER",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET_PLACEHOLDER",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID_PLACEHOLDER",
};

try {
  // Initialize the Firebase app in the service worker
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Handle background messages
  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const notificationTitle = payload.notification?.title || 'Notification';
    const notificationOptions = {
      body: payload.notification?.body || 'You have a new message.',
      icon: '/icons/icon-192x192.png', // Assuming PWA icons exist
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (e) {
  console.warn('Failed to initialize Firebase Messaging in Service Worker', e);
}
