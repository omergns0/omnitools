# Security policy

OmniTools' core promise is that **no user file or data ever leaves the browser**. Anything that breaks that promise is treated as a security vulnerability, for example:

- any way for the page to send data over the network (CSP bypass, new external request),
- a crafted PDF or image that runs script in the page (XSS),
- a vendored library that does not match its published checksum,
- output files that still contain metadata the cleaner claims to remove.

## Reporting

Please **do not open a public issue** for vulnerabilities. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on https://github.com/omergns0/omnitools.

You can expect a first reply within 7 days. Fixes are released as soon as possible and credited in the changelog unless you prefer otherwise.

## Supported versions

Only the latest version on the `main` branch (and the GitHub Pages deployment) is supported.

## Hardening already in place

- Strict Content-Security-Policy with `connect-src 'none'`, `script-src 'self'` and no `unsafe-inline` / `unsafe-eval`.
- PDF.js runs with `isEvalSupported: false`.
- All user-controlled text (file names, PDF metadata) is inserted with `textContent`, never `innerHTML`.
- Pinned, checksum-verified dependencies; CI rejects external URLs in the source.
- `no-referrer` policy, no cookies, nothing stored except the chosen UI language.
