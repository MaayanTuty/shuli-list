/* שירות הרקע: שומר את קובצי האפליקציה במכשיר כדי שתיפתח מיד וגם בלי אינטרנט.
   כדי להפיץ גרסה חדשה מעלים את המספר ב-VERSION (וגם ב-APP_VERSION שב-app.js). */
const VERSION = '1.0.0';
const CACHE = 'shuli-' + VERSION;
const ASSETS = [
    './',
    'index.html',
    'styles.css',
    'shuli.js',
    'seed.js',
    'app.js',
    'manifest.webmanifest',
    'fonts/assistant-400-hebrew.woff2',
    'fonts/assistant-400-latin.woff2',
    'fonts/assistant-600-hebrew.woff2',
    'fonts/assistant-600-latin.woff2',
    'fonts/assistant-700-hebrew.woff2',
    'fonts/assistant-700-latin.woff2',
    'fonts/assistant-800-hebrew.woff2',
    'fonts/assistant-800-latin.woff2',
    'fonts/varela-hebrew.woff2',
    'fonts/varela-latin.woff2',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('shuli-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        try {
            return await fetch(req);
        } catch (err) {
            if (req.mode === 'navigate') {
                const shell = await cache.match('index.html');
                if (shell) return shell;
            }
            throw err;
        }
    })());
});
