const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getSiteUrl = (): string => {
  const raw = (
    process.env.NODE_ENV === 'development'
      ? process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:3000'
      : process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'https://clipforgeapp.tech'
  ).trim();

  if (!raw) {
    return "https://clipforgeapp.tech";
  }

  if (/^https?:\/\//i.test(raw)) {
    return trimTrailingSlash(raw);
  }

  return trimTrailingSlash(`https://${raw}`);
};
