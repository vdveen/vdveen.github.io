const CACHE_NAME = "still-v1";
const APP_FILES = [
	"./",
	"index.html",
	"app.css",
	"app.js",
	"core.js",
	"manifest.webmanifest",
	"icons/icon.svg",
	"icons/icon-512.png",
	"icons/apple-touch-icon.png",
	"audio/soft-bell.wav",
	"audio/temple-bell.wav",
	"audio/singing-bowl.wav",
	"audio/deep-gong.wav",
];

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

	event.respondWith(
		fetch(event.request)
			.then((response) => {
				if (response.ok) {
					const copy = response.clone();
					void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
				}
				return response;
			})
			.catch(() => caches.match(event.request).then((cached) => cached || caches.match("index.html"))),
	);
});
