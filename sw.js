const CACHE_NAME = 'lpv-app-v4'; // Mudei a versão para forçar atualização
const ASSETS_TO_CACHE = [
  // Raiz
  './',
  './index.html',
  './manifest.json',

  // Páginas HTML
  './pages/auth.html',
  './pages/hub.html',
  './pages/mural.html',
  './pages/coloracao.html',

  // Estilos (Apenas os que existem agora)
  './assets/css/global.css',
  './assets/css/pages/coloracao.css',

  // Scripts (Nova estrutura)
  './assets/js/core.js',
  './assets/js/pages/auth.js',
  './assets/js/pages/hub.js',
  './assets/js/pages/mural.js',
  './assets/js/pages/coloracao.js',

  // Imagens Essenciais (Adicione outras se precisar offline)
  './assets/images/lpvminilogo2.png',
  './assets/images/LPV.png',
  './assets/images/fundo-lab.png',
  
  // FontAwesome (CDN - Opcional, cacheia se a rede permitir)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. Instalação: Cacheia os arquivos estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando arquivos essenciais...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .catch((err) => {
        console.error('[SW] Falha no cache:', err);
      })
  );
  self.skipWaiting(); // Força o SW a ativar imediatamente
});

// 2. Ativação: Limpa caches antigos
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando e limpando caches antigos...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Removendo cache antigo:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim(); // Controla as páginas abertas imediatamente
});

// 3. Fetch: Serve do Cache, se não tiver, busca na Rede (Offline First)
self.addEventListener('fetch', (event) => {
  // Ignora requisições que não sejam GET ou sejam para o Firebase/Google
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('firestore') || event.request.url.includes('googleapis')) return;

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Retorna do cache se existir
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Se não, busca na rede
        return fetch(event.request).then((response) => {
          // Verifica se a resposta é válida
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clona a resposta para salvar no cache dinamicamente
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      })
  );
});