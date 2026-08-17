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

        // Endereço novo. Com ou sem protocolo — veja `origemDestino`.
        enderecoNovo: 'https://lpvdigital.vercel.app'
    };

    /**
     * Reduz o que está escrito acima a uma origem absoluta ("https://host").
     *
     * O protocolo não é detalhe de estilo. Sem ele, "lpvdigital.vercel.app/x" é
     * um caminho RELATIVO: o navegador resolve dentro da origem antiga e a
     * pessoa vai parar em pedrinsang.github.io/Lpv/lpvdigital.vercel.app/x, que
     * é 404. E como a limpeza do cache acontece antes da saída, ela fica num 404
     * sem volta automática.
     *
     * Em vez de confiar que a constante foi escrita certa, ela é normalizada
     * aqui; se ainda assim não virar URL válida, a migração não acontece.
     * Deixar alguém no endereço antigo funcionando é muito melhor do que
     * despachar para o vazio.
     */
    function origemDestino(valor) {
        var texto = String(valor || '').trim();
        if (!texto) return '';
        if (!/^https?:\/\//i.test(texto)) texto = 'https://' + texto;
        try {
            return new URL(texto).origin;
        } catch (erro) {
            return '';
        }
    }

    var origemNova = origemDestino(MIGRACAO.enderecoNovo);

    if (!origemNova) return;
    if (window.location.hostname !== MIGRACAO.hostAntigo) return;
    // Destino apontando de volta para o host antigo mandaria a página para si
    // mesma, sem parar.
    if (origemNova.indexOf('//' + MIGRACAO.hostAntigo) !== -1) return;

    // O endereço novo serve na raiz, então o prefixo /Lpv/ sai do caminho.
    var caminho = window.location.pathname;
    if (caminho.indexOf(MIGRACAO.baseAntiga) === 0) {
        caminho = caminho.slice(MIGRACAO.baseAntiga.length);
    }
    if (caminho.charAt(0) !== '/') caminho = '/' + caminho;

    var destino = origemNova + caminho + window.location.search + window.location.hash;

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
