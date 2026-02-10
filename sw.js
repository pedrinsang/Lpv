const CACHE_NAME = 'lpv-ultra-fast-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/pages/auth.html',
  '/pages/hub.html',
  '/pages/mural.html',
  '/pages/coloracao.html',
  '/assets/css/global.css',
  '/assets/js/core.js',
  '/assets/js/lib/timers.js',
  '/assets/images/lpvminilogo2.png',
  '/manifest.json'
];

// 1. INSTALAÇÃO: Cacheia o essencial sem bloquear
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Força o SW a ativar imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. ATIVAÇÃO: Limpa caches antigos e assume controle da página na hora
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Controla a página imediatamente
  );
});

// 3. INTERCEPTAÇÃO (FETCH): Estratégia Híbrida de Alta Velocidade
self.addEventListener('fetch', (event) => {
  
  // Ignora requisições que não sejam GET (ex: POST para Firebase)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // A. ESTRATÉGIA PARA ARQUIVOS ESTÁTICOS (Imagens, CSS, JS, Fontes)
  // Cache First (Mais rápido: pega do disco, nem vai na internet)
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|woff2)$/)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
    return;
  }

  // B. ESTRATÉGIA PARA NAVEGAÇÃO (HTML - Mudança de Página)
  // Network First (Garante que você veja a versão atualizada, cai pro cache se estiver offline)
  // Isso remove a sensação de "atraso" pois o navegador vai direto buscar a página nova.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request) || caches.match('/index.html');
        })
    );
    return;
  }
});