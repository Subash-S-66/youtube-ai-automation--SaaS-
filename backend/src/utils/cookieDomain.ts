type RequestWithHeaders = {
  get(name: string): string | undefined;
};

const decodeUrlValue = (value: string): string => {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
};

const normalizeConfiguredCookieDomain = (value: string): string => {
  const decoded = decodeUrlValue(value || '');
  const compact = decoded.replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, '').trim();
  if (!compact) {
    return '';
  }

  let candidate = compact;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).hostname;
    } catch {
      candidate = candidate.replace(/^https?:\/\//i, '');
    }
  }

  candidate = candidate.split('/')[0] || candidate;
  candidate = candidate.replace(/:\d+$/, '');
  return candidate.replace(/^\.+/, '').replace(/\.+$/, '').toLowerCase();
};

const getRequestHost = (req: RequestWithHeaders): string => {
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = (forwardedHost || req.get('host') || '').trim().toLowerCase();
  if (!hostHeader) {
    return '';
  }

  if (hostHeader.startsWith('[')) {
    const closingBracket = hostHeader.indexOf(']');
    if (closingBracket > 0) {
      return hostHeader.slice(1, closingBracket);
    }
  }

  return hostHeader.replace(/:\d+$/, '');
};

const isIpAddress = (value: string): boolean => {
  const ipv4Pattern = /^\d{1,3}(\.\d{1,3}){3}$/;
  return ipv4Pattern.test(value) || value.includes(':');
};

export const resolveCookieDomain = (
  req: RequestWithHeaders,
  configuredCookieDomain?: string
): string | undefined => {
  const normalizedConfiguredDomain = normalizeConfiguredCookieDomain(configuredCookieDomain || '');
  if (
    !normalizedConfiguredDomain ||
    normalizedConfiguredDomain === 'localhost' ||
    isIpAddress(normalizedConfiguredDomain)
  ) {
    return undefined;
  }

  const requestHost = getRequestHost(req);
  if (!requestHost) {
    return undefined;
  }

  if (
    requestHost === normalizedConfiguredDomain ||
    requestHost.endsWith(`.${normalizedConfiguredDomain}`)
  ) {
    return normalizedConfiguredDomain;
  }

  return undefined;
};
