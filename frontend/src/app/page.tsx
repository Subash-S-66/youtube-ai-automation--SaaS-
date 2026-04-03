import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Home() {
  const cookieStore = await cookies();
  const hasToken =
    cookieStore.has('token') ||
    cookieStore.has('jwt') ||
    cookieStore.has('authToken');

  if (hasToken) {
    redirect('/dashboard');
  }

  redirect('/landing');
}
