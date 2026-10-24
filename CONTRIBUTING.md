# Contributing

Thanks for helping! OmniTools aims to stay **small, auditable and offline**, and a few rules keep it that way.

## Ground rules

1. **No network access.** Never add CDNs, analytics, web fonts, telemetry or remote APIs. The CSP blocks them anyway.
2. **No build step.** Plain HTML, CSS and JavaScript that runs by opening `index.html`.
3. **New dependencies are a last resort.** If one is truly needed, vendor a pinned minified build into `vendor/`, add its SHA-512 to `vendor/SHA512SUMS` and its license to `THIRD_PARTY_NOTICES.md`.
4. **Never use `innerHTML` with user data.** Use the `h()` helper in `js/app.js`.
5. **Translate every string.** Add new UI text to both `tr` and `en` in `js/i18n.js`.
6. **Bump the cache.** If you change a file the app loads, increase `CACHE` in `sw.js` (and add new files to `ASSETS`).

## Running locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Also try opening `index.html` directly from disk; both modes must work.

## Before opening a pull request

- Test the tool you touched in Chrome and Firefox (Safari too if you can).
- Check DevTools: no console errors, and the header badge still says **0 external connections**.
- Keep the pull request focused on one change and describe how you tested it.

## Ideas welcome

Rotate pages, visual page reordering, image compression, watermarks, page numbers, more languages. Please open an issue first for larger features.
