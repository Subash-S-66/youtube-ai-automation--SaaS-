import { NextRequest, NextResponse } from 'next/server';

const AUTH_PATHS = ['/login', '/register', '/admin-login'];
const SECURE_HOSTS = new Set(['clipforgeapp.tech', 'www.clipforgeapp.tech']);
const NOINDEX_PREFIXES = [
  '/api',
  '/admin',
  '/dashboard',
  '/settings',
  '/history',
  '/media',
  '/payments',
  '/subscription',
  '/pricing',
  '/reset-password',
  '/verify-email',
  '/forgot-password',
];

const BILLING_PATHS = ['/payments', '/subscription', '/pricing'];

const getRequestHost = (request: NextRequest): string => {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return host.split(':')[0].toLowerCase();
};

const getRequestProtocol = (request: NextRequest): 'http' | 'https' => {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto;
  }

  return request.nextUrl.protocol === 'https:' ? 'https' : 'http';
};

const shouldNoIndexPath = (pathname: string): boolean => {
  if (AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }

  return NOINDEX_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

const shouldAllowPaymentFeature = (pathname: string): boolean => {
  return BILLING_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

const applySecurityHeaders = (
  response: NextResponse,
  pathname: string,
  secureRequest: boolean
): NextResponse => {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    shouldAllowPaymentFeature(pathname)
      ? 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com"), usb=()'
      : 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-site');
  response.headers.set('Origin-Agent-Cluster', '?1');

  if (secureRequest || process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  if (shouldNoIndexPath(pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  }

  return response;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = getRequestHost(request);
  const protocol = getRequestProtocol(request);
  const secureRequest = protocol === 'https';

  if (
    process.env.NODE_ENV === 'production' &&
    SECURE_HOSTS.has(host) &&
    !secureRequest
  ) {
    const httpsUrl = request.nextUrl.clone();
    httpsUrl.protocol = 'https:';
    httpsUrl.host = host;
    return applySecurityHeaders(NextResponse.redirect(httpsUrl, 308), pathname, true);
  }

  const isApiRoute = pathname.startsWith('/api');
  const isStaticAsset = pathname.startsWith('/_next') || pathname.includes('.');
  if (isApiRoute || isStaticAsset) {
    return applySecurityHeaders(NextResponse.next(), pathname, secureRequest);
  }

  if (pathname === '/landing' || pathname.startsWith('/landing/')) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/', request.url)), pathname, secureRequest);
  }

  const tokenCookie =
    request.cookies.get('token') ||
    request.cookies.get('jwt') ||
    request.cookies.get('connect.sid') ||
    request.cookies.get('authToken');

  const isLoggedIn = Boolean(tokenCookie);

  if (isLoggedIn && pathname === '/') {
    return applySecurityHeaders(
      NextResponse.redirect(new URL('/dashboard', request.url)),
      pathname,
      secureRequest
    );
  }

  if (isLoggedIn && AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL('/dashboard', request.url)),
      pathname,
      secureRequest
    );
  }

  return applySecurityHeaders(NextResponse.next(), pathname, secureRequest);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/|sitemap.xml|robots.txt).*)',
  ],
};
