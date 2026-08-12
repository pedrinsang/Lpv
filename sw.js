// Trocar a versão descarta o cache anterior na ativação. Suba um número sempre
// que um arquivo da lista abaixo mudar de conteúdo.
const CACHE_NAME = 'lpv-ultra-fast-v16';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/pages/auth.html',
  '/pages/hub.html',
  '/pages/mural.html',
  '/pages/estoque.html',
  '/assets/css/global.css',
  '/assets/css/pages/estoque.css',
  '/assets/js/core.js',
  '/assets/js/pages/estoque.js',
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
  //
  // Stale-while-revalidate: responde do cache na hora (rápido igual antes) e,
  // em paralelo, busca a versão nova e guarda para o próximo carregamento.
  //
  // Antes era Cache First puro (`cachedResponse || fetch(...)`), que nunca
  // revalidava: uma vez no cache, o arquivo ficava congelado até alguém trocar
  // o CACHE_NAME. Na prática, um deploy novo não chegava em quem já tinha
  // aberto o site — o usuário via CSS e JS antigos sem saber por quê.
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|woff2)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const rede = fetch(event.request).then((resposta) => {
            if (resposta && resposta.ok) cache.put(event.request, resposta.clone());
            return resposta;
          }).catch(() => cached);   // offline: fica no que já tem

          return cached || rede;
        })
      )
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
