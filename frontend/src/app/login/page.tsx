import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LoginClient from './LoginClient';

export default async function LoginPage() {
  const cookieStore = await cookies();
  const hasToken =
    cookieStore.has('token') ||
    cookieStore.has('jwt') ||
    cookieStore.has('authToken') ||
    cookieStore.has('connect.sid');

  if (hasToken) {
    redirect('/dashboard');
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0B0F1A] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#7C5CFF] border-t-transparent animate-spin"></div>
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
