/**
 * ÍNDICE DO LIVRO DE REGISTROS (`meta/livroRegistros`)
 *
 * Um documento só, com os anos que existem no acervo e quantos laudos cada um
 * tem por tipo:
 *
 *   { anos: { "2025": { biopsia: 184, necropsia: 44 }, ... }, total, atualizadoEm }
 *
 * Serve para o Histórico montar o filtro de ano e os totais do acervo sem ler o
 * acervo inteiro — a página busca no Firestore só o ano selecionado. Por isso o
 * índice precisa acompanhar cada laudo liberado.
 */
import { db } from '../core.js';
import {
    doc, setDoc, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { anoProtocolo } from './protocolo.js';

const REF = () => doc(db, 'meta', 'livroRegistros');

/**
 * Balde dos casos cujo protocolo não tem ano legível. `protocoloAno` desses
 * casos é 0, então a chave do índice é a mesma coisa em texto — o Histórico
 * consulta por ela como consulta qualquer outro ano.
 */
export const ANO_DESCONHECIDO = '0';

/**
 * Soma um laudo recém-liberado ao índice.
 *
 * Falha aqui não pode derrubar a liberação do laudo: o índice é um atalho de
 * leitura, e o Histórico já sabe se virar sem ele (carrega o acervo inteiro).
 * Por isso o erro é registrado e engolido.
 */
export async function registrarLiberacao(task) {
    const ano = Number(task && task.protocoloAno) || anoProtocolo(task && task.protocolo);

    // Protocolo ilegível não tem ano de série. Descartar o caso aqui o faria
    // sumir do livro inteiro — o Histórico só busca os anos que estão no índice.
    // Vai para o balde "0" (exibido como "Sem ano") até alguém corrigir o
    // protocolo na ficha.
    const chaveAno = ano ? String(ano) : ANO_DESCONHECIDO;

    const tipo = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    try {
        await setDoc(REF(), {
            anos: { [chaveAno]: { [tipo]: increment(1) } },
            total: increment(1),
            atualizadoEm: new Date().toISOString()
        }, { merge: true });
    } catch (erro) {
        console.warn('Não foi possível atualizar o índice do livro de registros.', erro);
    }
}

/**
 * Desconta um laudo que saiu do acervo.
 *
 * Sem isso os contadores do topo do Histórico continuam somando um caso que já
 * não existe — o mesmo tipo de fantasma que a lista mostraria.
 */
export async function registrarExclusao(task) {
    if (!task || !task.releasedAt) return;   // caso não liberado nunca entrou no índice

    const ano = Number(task.protocoloAno) || anoProtocolo(task.protocolo);
    const chaveAno = ano ? String(ano) : ANO_DESCONHECIDO;
    const tipo = task.type === 'necropsia' ? 'necropsia' : 'biopsia';

    // Aqui não dá para usar `increment(-1)` como na liberação: um ano que zerou
    // precisa SAIR do documento, e `increment` só sabe mexer no número — a chave
    // ficaria para trás com contagem 0 e o Histórico continuaria oferecendo o ano
    // no filtro. A transação lê, desconta e remove o ano quando ele esvazia.
    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(REF());
            if (!snap.exists()) return;

            const dados = snap.data() || {};
            const anos = { ...(dados.anos || {}) };
            const doAno = { ...(anos[chaveAno] || {}) };

            // O piso em 0 protege de contagem negativa: laudo liberado antes de
            // o índice existir nunca foi somado, mas pode ser excluído hoje.
            doAno[tipo] = Math.max(0, Number(doAno[tipo] || 0) - 1);

            if (Object.values(doAno).some((n) => Number(n) > 0)) {
                anos[chaveAno] = doAno;
            } else {
                delete anos[chaveAno];
            }

            tx.set(REF(), {
                anos,
                total: Math.max(0, Number(dados.total || 0) - 1),
                atualizadoEm: new Date().toISOString()
            });
        });
    } catch (erro) {
        console.warn('Não foi possível descontar o laudo do índice do livro.', erro);
    }
}

/** Zera o índice — usado quando o acervo inteiro é apagado. */
export async function zerarIndice() {
    try {
        await setDoc(REF(), {
            anos: {},
            total: 0,
            atualizadoEm: new Date().toISOString()
        });
    } catch (erro) {
        console.warn('Não foi possível zerar o índice do livro de registros.', erro);
    }
}
