# ClipForge Deployment Guide

This guide outlines the recommended deployment strategy and configuration requirements to host the ClipForge SaaS application in a production environment.

## 1. Hosting Strategy

The application consists of three primary compute instances and two managed databases.

- **Frontend Application (Next.js):** [Vercel](https://vercel.com) (Recommended)
- **Backend API (Node.js/Express):** [Render](https://render.com), [Railway](https://railway.app), or [Azure App Service](https://azure.microsoft.com/en-us/products/app-service/)
- **Background Worker (Node.js/Python):** Same platform as the Backend API (run as a separate background worker service)
- **Database (MongoDB):** [MongoDB Atlas](https://www.mongodb.com/atlas/database)
- **Queue / Cache (Redis):** [Upstash](https://upstash.com) or platform-native Managed Redis

---

## 2. Environment Variables

Below is the complete list of environment variables required for production deployment. Do **NOT** expose secrets to the frontend application.

### Backend & Worker Variables

Configure these on your Backend API and Worker service environments:

*   **Core Configuration**
    *   `PORT` = `5000` (often set automatically by the host)
    *   `NODE_ENV` = `production`
    *   `FRONTEND_URL` = `https://your-production-frontend-domain.com` (Required for strict CORS policies and redirect links)

*   **Database & Authentication**
    *   `MONGO_URI` = `mongodb+srv://...`
    *   `JWT_SECRET` = A strong, cryptographically secure random string

*   **Queueing (Redis)**
    *   `REDIS_URL` = `rediss://...`

*   **Integrations**
    *   `GOOGLE_CLIENT_ID` = From Google Cloud Console (YouTube API)
    *   `GOOGLE_CLIENT_SECRET` = From Google Cloud Console
    *   `GOOGLE_REDIRECT_URI` = `https://your-production-backend-domain.com/api/youtube/callback`
    *   `GEMINI_API_KEY` = From Google AI Studio
    *   `STRIPE_SECRET_KEY` = Stripe Secret Key (sk_live_...)
    *   `STRIPE_WEBHOOK_SECRET` = Stripe Webhook Endpoint Secret (whsec_...)
    *   `STRIPE_PRICE_ID` = Stripe Price ID for the Pro Plan subscription

*   **Notifications**
    *   `EMAIL_HOST` = e.g., `smtp.mailgun.org`
    *   `EMAIL_PORT` = `465` (Use `465` for secure SSL connections)
    *   `EMAIL_USER` = SMTP Username
    *   `EMAIL_PASS` = SMTP Password
    *   `TELEGRAM_BOT_TOKEN` = Telegram Bot Token

### Frontend Variables

Configure these on your Frontend (Vercel) environment:

*   `NEXT_PUBLIC_API_URL` = `https://your-production-backend-domain.com/api`

---

## 3. Production Build Scripts

### Frontend (Next.js)
The frontend uses standard Next.js build optimization commands. Vercel automatically detects these, but for manual deployment, run:
```bash
npm run build
npm start
```

### Backend API (Node.js)
The backend must be compiled from TypeScript to JavaScript before starting:
```bash
npm run build
npm start
```

### Background Worker
The worker requires its own isolated process to listen to the Redis queue. It shares the backend codebase but uses a different startup command:
```bash
npm run build
npm run worker
```
*(Ensure the worker instance has access to the same environment variables as the backend API).*

---

## 4. Security & Optimization Checklist

1.  **HTTPS Only:** Ensure your hosting providers enforce SSL/HTTPS out of the box. Next.js and secure CORS settings require HTTPS.
2.  **Stripe Webhooks:** Ensure your Stripe Webhook endpoint is correctly mapped to `https://your-production-backend-domain.com/api/payment/webhook`. Stripe must be able to hit this route securely.
3.  **Google OAuth:** Ensure you whitelist the production frontend and backend domains inside the Google Cloud Console OAuth Consent Screen and Authorized Redirect URIs settings.
4.  **Log Cleanliness:** The application trims database logs to 100KB locally to prevent document bloat. Do not inject secrets into standard output logs to prevent credential leakage.
5.  **Queue Stability:** The Redis connection sets `maxRetriesPerRequest: null`, avoiding silent queue dropping issues specifically observed in BullMQ environments.
