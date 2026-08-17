/**
 * MIGRAÇÃO DE ENDEREÇO — leva quem chega pelo endereço antigo para o novo.
 *
 * Precisa ser script comum (não módulo) e o PRIMEIRO da página: assim roda
 * antes do core.js, e a pessoa é redirecionada sem o app começar a montar.
 *
 * Por que não basta avisar "mudamos de endereço":
 * quem abriu o site antes tem um service worker registrado na origem antiga,
 * com o app inteiro em cache. Enquanto ele existir, aquela origem continua
 * entregando uma versão congelada — a pessoa fica num app que nunca atualiza e
 * não tem como saber por quê. Então aqui o service worker é desregistrado e o
 * cache apagado antes de sair.
 *
 * COMO ATIVAR: preencha `enderecoNovo` com a URL do Vercel. Enquanto estiver
 * vazio este arquivo não faz nada, em nenhuma origem.
 *
 * COMO REMOVER: passados uns meses, quando ninguém mais chegar pelo endereço
 * antigo, apague este arquivo e as linhas <script> que o chamam.
 */
(function () {
    'use strict';

    var MIGRACAO = {
        // Origem antiga (GitHub Pages), servida em /Lpv/.
        hostAntigo: 'pedrinsang.github.io',
        baseAntiga: '/Lpv',

        // Endereço novo, sem barra no fim. Ex.: 'https://lpv-digital.vercel.app'
        enderecoNovo: 'lpvdigital.vercel.app'
    };

    if (!MIGRACAO.enderecoNovo) return;
    if (window.location.hostname !== MIGRACAO.hostAntigo) return;

    // O endereço novo serve na raiz, então o prefixo /Lpv/ sai do caminho.
    var caminho = window.location.pathname;
    if (caminho.indexOf(MIGRACAO.baseAntiga) === 0) {
        caminho = caminho.slice(MIGRACAO.baseAntiga.length);
    }
    if (!caminho) caminho = '/';

    var destino = MIGRACAO.enderecoNovo.replace(/\/$/, '') +
                  caminho + window.location.search + window.location.hash;

    function limpar() {
        var tarefas = [];

        if ('serviceWorker' in navigator) {
            tarefas.push(
                navigator.serviceWorker.getRegistrations().then(function (registros) {
                    return Promise.all(registros.map(function (r) { return r.unregister(); }));
                })
            );
        }

        if ('caches' in window) {
            tarefas.push(
                caches.keys().then(function (chaves) {
                    return Promise.all(chaves.map(function (c) { return caches.delete(c); }));
                })
            );
        }

        return Promise.all(tarefas);
    }

    function sair() {
        window.location.replace(destino);
    }

    // Limpeza travada não pode prender ninguém no endereço velho: o que valer
    // primeiro — a faxina ou 1,5s — manda.
    Promise.race([
        limpar()['catch'](function () {}),
        new Promise(function (resolve) { setTimeout(resolve, 1500); })
    ]).then(sair, sair);
})();
