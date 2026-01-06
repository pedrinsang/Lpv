/**
 * SERVICE WORKER - LPV
 * Cache primeiro estratégia para funcionalidade offline
 * Arquivos críticos de autenticação são cacheados automaticamente
 */

const CACHE_NAME = 'lpv-cache-v3';
const CRITICAL_ASSETS = [
  // Páginas
  './pages/auth.html',
  
  // Estilos
  './assets/css/auth.css',
  './assets/css/landing.css',
  
  // Scripts
  './assets/js/auth.js',
  './assets/js/firebase-config.js',
  
  // Imagens
  './assets/images/LPV2.png',
  './assets/images/lpvminilogo2.png',
  './icons/casa.svg',
  './assets/images/fundo-lab.png',
  
  // Fontes - FontAwesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
];

/**
 * INSTALL EVENT
 * Cacheia todos os ativos críticos durante a instalação
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching critical assets...');
        return cache.addAll(CRITICAL_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[SW] Cache installation failed:', error);
      })
  );
});

/**
 * ACTIVATE EVENT
 * Remove caches antigos e controla versões
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

/**
 * FETCH EVENT
 * Estratégia: Cache First, com fallback para Network
 * Se o recurso estiver em cache, serve; caso contrário, busca na rede
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET
  if (request.method !== 'GET') {
    return;
  }

  // Ignorar requisições de scripts de extensões e ferramentas de desenvolvedor
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          console.log('[SW] Serving from cache:', request.url);
          return response;
        }

        // Se não está em cache, busca na rede
        return fetch(request)
          .then((response) => {
            // Não cacheia respostas inválidas
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Clona a resposta para cacheá-la
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              })
              .catch((error) => {
                console.warn('[SW] Failed to cache response:', error);
              });

            return response;
          })
          .catch((error) => {
            console.error('[SW] Network request failed:', error);
            
            // Retorna uma página offline genérica se disponível
            if (request.destination === 'document') {
              return caches.match('./pages/auth.html');
            }
            
            // Para outros tipos de requisição, retorna um erro
            return new Response(
              'Recurso não disponível offline',
              { status: 503, statusText: 'Service Unavailable' }
            );
          });
      })
  );
});

/**
 * MESSAGE EVENT
 * Permite comunicação entre a página e o Service Worker
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skipping waiting and claiming clients...');
    self.skipWaiting();
  }
});
