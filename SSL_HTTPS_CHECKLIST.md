# ClipForge HTTPS Checklist

## Goal
Make sure https://clipforgeapp.tech is fully active and all http traffic redirects to https.

## 1) DNS and Certificate

- Confirm `clipforgeapp.tech` and `www.clipforgeapp.tech` point to your hosting provider.
- Enable managed SSL/TLS certificate in your hosting dashboard.
- Wait for certificate status to show as active/issued.

## 2) Enforce HTTPS at Edge

Enable your platform's HTTPS-only option when available:
- Vercel: Enforce HTTPS is automatic for custom domains once cert is active.
- Cloudflare: SSL/TLS mode Full (strict), Always Use HTTPS ON.
- Nginx/Ingress: add a 301/308 redirect from `http` to `https`.

## 3) Application-level Fallback (already implemented)

This repo now includes middleware redirect logic for production ClipForge hosts:
- `http://clipforgeapp.tech/*` -> `https://clipforgeapp.tech/*`
- `http://www.clipforgeapp.tech/*` -> `https://www.clipforgeapp.tech/*`

## 4) Validate

Run these checks after deployment:
- `http://clipforgeapp.tech` should redirect with 308/301 to HTTPS.
- `https://clipforgeapp.tech` should load without certificate warnings.
- `https://clipforgeapp.tech/sitemap.xml` should be reachable.
- Google Search Console should show canonical HTTPS URLs.
