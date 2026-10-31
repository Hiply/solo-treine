const CACHE_NAME = "system-training-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./shop.css",
  "./hud.css",
  "./sound.js",
  "./music.js",
  "./app.js",
  "./shop.js",
  "./ai.js",
  "./mentor.js",
  "./cloud-config.js",
  "./cloud.js",
  "./leaderboard.js",
  "./device.js",
  "./auth.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./assets/shop/avatar-hunter.png",
  "./assets/shop/item-e-dagger.png",
  "./assets/shop/item-d-hood.png",
  "./assets/shop/item-c-scale.png",
  "./assets/shop/item-b-gauntlets.png",
  "./assets/shop/item-a-cloak.png",
  "./assets/shop/item-s-shadowblade.png",
  "./assets/shop/item-s-armor.png",
  "./assets/shop/item-monarch-crown.png",
  "./assets/shop/item-monarch-wings.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Não guarda respostas parciais (vídeo/áudio usam Range) nem erros.
        if (response.status === 200 && !request.headers.get("range")) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
