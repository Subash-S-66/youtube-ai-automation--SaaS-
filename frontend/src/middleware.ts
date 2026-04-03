import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/admin-login',
  '/pricing',
];

const AUTH_PATHS = ['/login', '/register', '/admin-login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/landing' || pathname.startsWith('/landing/')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const tokenCookie =
    request.cookies.get('token') ||
    request.cookies.get('jwt') ||
    request.cookies.get('connect.sid') ||
    request.cookies.get('authToken');

  const isLoggedIn = Boolean(tokenCookie);

  if (isLoggedIn && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (isLoggedIn && AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isApiRoute = pathname.startsWith('/api');
  const isStaticAsset = pathname.startsWith('/_next') || pathname.includes('.');

  if (!isLoggedIn && !isPublic && !isApiRoute && !isStaticAsset) {
    const loginUrl = pathname.startsWith('/admin')
      ? new URL('/admin-login', request.url)
      : new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/).*)'],
};
