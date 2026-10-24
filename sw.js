/* Service worker: caches the whole app so it keeps working with no internet connection.
 * It only ever serves files from this site's own folder; it never contacts other hosts. */
const CACHE = 'omnitools-v2.0.0';
const ASSETS = [
    './',
    'index.html',
    'css/style.css',
    'js/i18n.js',
    'js/zip.js',
    'js/app.js',
    'vendor/pdf-lib.min.js',
    'vendor/pdf.min.js',
    'vendor/pdf.worker.min.js',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
    );
});
