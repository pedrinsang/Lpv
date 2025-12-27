/**
 * PWA - GLOBAL INITIALIZATION
 * Registra o Service Worker para toda a aplicação
 * Pode ser importado em qualquer página
 */

(function initPWA() {
  'use strict';

  // Verifica se o navegador suporta Service Workers
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service Workers não suportados neste navegador');
    return;
  }

  // Aguarda o carregamento da página
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerServiceWorker);
  } else {
    registerServiceWorker();
  }

  /**
   * Registra o Service Worker
   */
  function registerServiceWorker() {
    navigator.serviceWorker.register('./sw.js', { scope: '/' })
      .then((registration) => {
        console.log('%c✓ Service Worker Registrado com Sucesso', 'color: #4caf50; font-weight: bold; font-size: 12px;');
        console.log('[PWA] Escopo:', registration.scope);

        // Verifica por atualizações a cada minuto
        setInterval(() => {
          registration.update().catch((error) => {
            console.warn('[PWA] Erro ao verificar atualizações:', error);
          });
        }, 60000);

        // Listener para quando uma nova versão está aguardando
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] Nova versão disponível');
              // Aqui você pode notificar o usuário sobre uma atualização
            }
          });
        });
      })
      .catch((error) => {
        console.error('[PWA] Falha ao registrar Service Worker:', error);
      });

    // Listener para mudanças de controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] Nova versão ativada');
      // Opcional: recarregar a página silenciosamente
      // window.location.reload();
    });
  }
})();
