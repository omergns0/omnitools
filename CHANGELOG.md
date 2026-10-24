# Changelog

## 2.0.0 — 2026-10-24

A rewrite focused on the original goal: a tool that is truly **offline** and **cannot leak data**.

### Security & privacy
- Removed every CDN (Tailwind, Font Awesome, cdnjs). Libraries are vendored and checksum-verified, so the app works with no internet connection.
- Added a strict Content-Security-Policy (`connect-src 'none'`) so the page can't make network requests.
- Fixed an XSS bug: file names were inserted with `innerHTML`, so a file named `<img src=x onerror=…>.pdf` ran script.
- Removed the Google AdSense placeholder, which contradicted the no-tracking promise.
- Image conversion and images-to-PDF now strip EXIF metadata (GPS location, camera model).
- New tool: **PDF metadata cleaner** (author, producer, dates, XMP, document ID).
- Generated PDFs no longer get a "pdf-lib" producer tag or timestamps.
- Live "external connections" counter in the header.

### Bug fixes
- Images to PDF: PNG/WebP images were always embedded as JPEG, producing broken or failed output; WebP failed completely.
- Images to PDF: tall images overflowed the page. Images are now fitted and centered, and the page orientation is picked automatically.
- Images to PDF: phone photos appeared rotated (EXIF orientation ignored).
- Drag & drop was advertised but not implemented. It now works on every tool.
- Merge: a damaged or encrypted PDF left the button spinning forever. Errors are now shown with the file name.
- `photo.v2.webp` was saved as `photo-converted.png` (name cut at the first dot).
- Selecting the same file twice did nothing.
- Missing Font Awesome icon (`fa-merge`) on the merge button.
- Memory leaks: object URLs were never released, and large images used data URLs.
- Removed the duplicate `site` file.

### New
- Split / extract pages with ranges (`1-3, 5, 8-`), as one PDF or one per page (ZIP).
- Reorder and remove files before merging or building a PDF.
- Batch image conversion, WebP output, quality slider, resize.
- PDF to images: DPI choice, PNG/JPG, download all as ZIP.
- Installable PWA with an offline service worker; also works from `file://`.
- Turkish and English interface.
- Keyboard-accessible drop zones and deep links (`#merge`, `#split`, …).

## 1.0.0 — 2026-10-09
- First version: image converter, merge PDFs, images to PDF, PDF to images.
