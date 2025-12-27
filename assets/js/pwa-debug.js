/**
 * PWA_CODE_SNIPPETS.js
 * 
 * Exemplos práticos de como interagir com PWA
 * Copie e cole conforme necessário
 */

// ============================================================
// 1. VERIFICAR STATUS DO SERVICE WORKER
// ============================================================

function checkServiceWorkerStatus() {
  if (!('serviceWorker' in navigator)) {
    console.log('❌ Service Workers não suportados');
    return;
  }

  navigator.serviceWorker.ready.then(registration => {
    console.log('✅ Service Worker está ativo');
    console.log('📍 Escopo:', registration.scope);
    console.log('🔄 Estado:', registration.active?.state);
  });

  navigator.serviceWorker.getRegistrations().then(registrations => {
    console.log('📦 Service Workers registrados:', registrations.length);
    registrations.forEach(reg => {
      console.log(`  - Escopo: ${reg.scope}`);
      console.log(`  - Ativo: ${!!reg.active}`);
    });
  });
}

// Usar: checkServiceWorkerStatus();

// ============================================================
// 2. LISTAR ARQUIVOS EM CACHE
// ============================================================

function listCachedFiles() {
  caches.open('lpv-cache-v1').then(cache => {
    cache.keys().then(requests => {
      console.log('📦 Arquivos em Cache (lpv-cache-v1):');
      requests.forEach((request, index) => {
        console.log(`  ${index + 1}. ${request.url}`);
      });
      console.log(`\n✅ Total: ${requests.length} arquivos`);
    });
  });
}

// Usar: listCachedFiles();

// ============================================================
// 3. LIMPAR CACHE MANUALMENTE
// ============================================================

function clearAllCaches() {
  caches.keys().then(cacheNames => {
    return Promise.all(
      cacheNames.map(cacheName => {
        console.log(`🗑️  Deletando cache: ${cacheName}`);
        return caches.delete(cacheName);
      })
    );
  }).then(() => {
    console.log('✅ Todos os caches foram limpos');
  });
}

// Usar: clearAllCaches();

// ============================================================
// 4. VERIFICAR SE APP ESTÁ INSTALADO
// ============================================================

function isAppInstalled() {
  // Método 1: Verificar display mode
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('✅ App está instalado e rodando como standalone');
    return true;
  }

  // Método 2: Verificar vendor-specific
  if (navigator.standalone === true) {
    console.log('✅ App está instalado (iOS)');
    return true;
  }

  console.log('❌ App não está instalado');
  return false;
}

// Usar: isAppInstalled();

// ============================================================
// 5. DETECTAR MUDANÇAS DE CONECTIVIDADE
// ============================================================

function setupConnectivityListener() {
  window.addEventListener('online', () => {
    console.log('📡 ✅ Voltou Online!');
    console.log('Service Worker pode sincronizar dados...');
    
    // Aqui você pode:
    // - Sincronizar dados do cache
    // - Atualizar informações do servidor
    // - Notificar usuário
  });

  window.addEventListener('offline', () => {
    console.log('📡 ❌ Ficou Offline');
    console.log('Funcionando com dados em cache...');
    
    // Mostrar banner ao usuário
    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.textContent = 'Você está sem conexão. Usando dados em cache.';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #f57c00;
      color: white;
      padding: 1rem;
      text-align: center;
      z-index: 9999;
    `;
    document.body.prepend(banner);
  });

  console.log('✅ Listeners de conectividade configurados');
}

// Usar: setupConnectivityListener();

// ============================================================
// 6. ATUALIZAR SERVICE WORKER
// ============================================================

function updateServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.update().then(() => {
        console.log('🔄 Verificando por atualizações...');
      });
    });
  }
}

// Usar: updateServiceWorker();

// ============================================================
// 7. REINSTALAR/FORÇAR SW NOVO
// ============================================================

async function reinstallServiceWorker() {
  console.log('⚠️  Desinstalando Service Worker...');
  
  const registrations = await navigator.serviceWorker.getRegistrations();
  
  for (let registration of registrations) {
    const unregistered = await registration.unregister();
    if (unregistered) {
      console.log('✅ Service Worker desinstalado');
    }
  }

  // Recarregar página para registrar novo
  console.log('↻ Recarregando página...');
  window.location.reload();
}

// Usar: reinstallServiceWorker();

// ============================================================
// 8. COMUNICAR COM SERVICE WORKER
// ============================================================

function sendMessageToServiceWorker(message) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'MESSAGE_FROM_PAGE',
      data: message,
      timestamp: Date.now()
    });
    console.log('📤 Mensagem enviada ao SW:', message);
  } else {
    console.warn('⚠️  Service Worker não ativo');
  }
}

// Usar no SW (sw.js):
/*
self.addEventListener('message', (event) => {
  if (event.data.type === 'MESSAGE_FROM_PAGE') {
    console.log('📥 Mensagem recebida:', event.data.data);
  }
});
*/

// Usar na página: sendMessageToServiceWorker('Hello SW!');

// ============================================================
// 9. MONITORAR ATUALIZAÇÕES DO SW
// ============================================================

function monitorServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then(registration => {
    // Verifica atualizações
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('🆕 Nova versão do app disponível!');
          
          // Mostrar notificação ao usuário
          const notification = document.createElement('div');
          notification.innerHTML = `
            <div style="
              position: fixed;
              bottom: 20px;
              right: 20px;
              background: #0d47a1;
              color: white;
              padding: 1rem;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              z-index: 9999;
            ">
              <p style="margin: 0 0 10px 0;">Nova versão disponível!</p>
              <button onclick="location.reload()" style="
                background: white;
                color: #0d47a1;
                border: none;
                padding: 0.5rem 1rem;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
              ">Atualizar Agora</button>
            </div>
          `;
          document.body.appendChild(notification);
        }
      });
    });
  });
}

// Usar: monitorServiceWorkerUpdates();

// ============================================================
// 10. TESTAR FUNCIONALIDADE OFFLINE
// ============================================================

function testOfflineMode() {
  console.log('🧪 Iniciando teste de modo offline...\n');
  
  // Teste 1: Verificar suporte a Service Worker
  console.log('Teste 1: Suporte a Service Worker');
  console.log('Resultado:', 'serviceWorker' in navigator ? '✅ OK' : '❌ FALHA');
  
  // Teste 2: Verificar Cache API
  console.log('\nTeste 2: Suporte a Cache API');
  console.log('Resultado:', 'caches' in window ? '✅ OK' : '❌ FALHA');
  
  // Teste 3: Registrações ativas
  console.log('\nTeste 3: Service Workers Registrados');
  navigator.serviceWorker.getRegistrations().then(regs => {
    console.log('Resultado:', regs.length > 0 ? `✅ OK (${regs.length})` : '❌ FALHA');
    
    // Teste 4: Listar cache
    console.log('\nTeste 4: Cache Storage');
    caches.keys().then(names => {
      if (names.length > 0) {
        console.log(`✅ OK (${names.length} cache(s)):`);
        names.forEach(name => console.log(`  - ${name}`));
      } else {
        console.log('❌ FALHA: Nenhum cache encontrado');
      }
    });
  });
}

// Usar: testOfflineMode();

// ============================================================
// 11. INTEGRAÇÃO COMPLETA - EXEMPLO DE USO
// ============================================================

class PWADebugger {
  constructor() {
    this.setupAll();
  }

  setupAll() {
    console.log('%c🔧 PWA Debugger Inicializado', 'font-size: 14px; color: #0d47a1; font-weight: bold');
    this.checkHealth();
    this.setupListeners();
  }

  checkHealth() {
    console.group('📊 Status de Saúde do PWA');
    
    console.log('Service Worker:', 'serviceWorker' in navigator ? '✅' : '❌');
    console.log('Cache API:', 'caches' in window ? '✅' : '❌');
    console.log('Offline Storage:', 'localStorage' in window ? '✅' : '❌');
    console.log('Push Notifications:', 'Notification' in window ? '✅' : '❌');
    
    console.groupEnd();
  }

  setupListeners() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  handleOnline() {
    console.log('%c✅ Conexão Restaurada', 'color: #4caf50; font-weight: bold');
  }

  handleOffline() {
    console.log('%c⚠️  Sem Conexão', 'color: #ff6f00; font-weight: bold');
  }

  // Adicionar ao window para acesso global
  static getInstance() {
    if (!window.__pwaDeb) {
      window.__pwaDeb = new PWADebugger();
    }
    return window.__pwaDeb;
  }
}

// Usar: PWADebugger.getInstance();

// ============================================================
// ACESSAR TUDO VIA CONSOLE
// ============================================================

/*
// No console do navegador, você pode usar:

✅ checkServiceWorkerStatus()
✅ listCachedFiles()
✅ clearAllCaches()
✅ isAppInstalled()
✅ setupConnectivityListener()
✅ updateServiceWorker()
✅ reinstallServiceWorker()
✅ monitorServiceWorkerUpdates()
✅ testOfflineMode()
✅ PWADebugger.getInstance()

// Exemplo completo de uso:
PWADebugger.getInstance();
testOfflineMode();
listCachedFiles();
*/

console.log('%c✅ PWA Snippets Carregados', 'font-size: 12px; color: #4caf50; font-weight: bold');
console.log('Use as funções acima no console para debug');
