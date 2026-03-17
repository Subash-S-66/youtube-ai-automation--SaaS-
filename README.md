# ClipForge (YouTube AI Automation)

ClipForge is a comprehensive SaaS platform bridging the gap between automated Python video generation pipelines and modern web architecture. It features a complete Node.js/Express backend powered by MongoDB and Redis, and a sleek, fast Next.js dashboard.

The system natively handles YouTube OAuth workflows, asynchronous video generation leveraging Google's Gemini, Stripe-based subscription management, and reliable background process scaling via BullMQ.

---

## 1. Project Overview

The repository consists of three integrated layers:

- **Python Scripts (Root):** Core algorithmic modules designed to generate YouTube shorts automatically (`youtube_ai_automation`).
- **Backend (`/backend`):** A robust Node.js + Express API handling authentication, payments, database operations, and background worker queues.
- **Frontend (`/frontend`):** A Next.js (App Router) user interface designed with Tailwind CSS, Framer Motion, and Axios.

---

## 2. Environment Variables

To run the application, you must define environment variables. Example `.env.example` files have been placed in their respective directories.

### Backend (`/backend/.env`)

- **Core & DB:** `MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`
- **Integrations:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GEMINI_API_KEY`
- **Payments:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Queue:** `REDIS_URL`
- **Notifications:** `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `TELEGRAM_BOT_TOKEN`

### Frontend (`/frontend/.env.local`)

- **API Configuration:** `NEXT_PUBLIC_API_URL` (Defaults to `http://localhost:5000/api` locally, but must point to the production API url when deployed).

---

## 3. Local Setup Instructions

Ensure you have Node.js (v18+), Python (v3.10+), Redis, and MongoDB running on your machine.

### Start the Backend API
```bash
cd backend
npm install
npm run dev
```

### Start the Background Worker
*You must run the worker in a separate terminal process from the Backend API to execute generated video pipelines.*
```bash
cd backend
npm run worker
```

### Start the Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 4. Production Deployment & Hosting Strategy

ClipForge's architecture decouples intensive background logic from standard web serving, requiring a robust hosting strategy.

### Recommended Providers
- **Frontend (Next.js):** [Vercel](https://vercel.com)
- **Backend API (Node.js):** [Railway](https://railway.app), [Render](https://render.com), or [Azure](https://azure.microsoft.com/)
- **Background Worker:** A *separate* background service on the same platform as the Backend API (using the exact same repository and environment variables).
- **Redis Queue:** [Upstash](https://upstash.com)
- **Pipeline Engine:** Azure Container Apps (Provisioned via Docker/ACR)

### CI/CD Pipelines & GitHub Secrets

ClipForge automatically deploys using GitHub Actions (`.github/workflows`). Before pushing to `main`, ensure the following repository **GitHub Secrets** are configured:

*   `MONGO_URI`
*   `JWT_SECRET`
*   `STRIPE_SECRET_KEY`
*   `REDIS_URL`
*   `GOOGLE_CLIENT_SECRET`
*   `GEMINI_API_KEY`
*   `NEXT_PUBLIC_API_URL`
*   *Azure Specific:* `ACR_LOGIN_SERVER`, `ACR_USERNAME`, `ACR_PASSWORD`

### Security Requirements (CRITICAL)
- **HTTPS Enforcement:** Production environments MUST be served over HTTPS. OAuth integrations and Next.js require it.
- **Secrets Management:** Do not commit `.env` files to the repository. Configure your production secrets natively via Vercel/Railway environment settings.
- **Token Protection:** Ensure `JWT_SECRET` is strong. Never expose API keys (e.g. Gemini, Stripe) to the Next.js `NEXT_PUBLIC_` namespace.

### Production Build & Start Scripts
1. **Frontend:** `npm run build` and `npm start`
2. **Backend API:** `npm run build` and `npm start`
3. **Background Worker:** `npm run build` and `npm run start:worker`
