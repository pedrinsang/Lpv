/**
 * ÍNDICE DO LIVRO DE REGISTROS (`meta/livroRegistros`)
 *
 * Um documento só, com os anos que existem no acervo e quantos casos cada um
 * tem por tipo:
 *
 *   { anos: { "2025": { biopsia: 184, necropsia: 44 }, ... }, total, atualizadoEm }
 *
 * Serve para o Histórico montar o filtro de ano e os totais do acervo sem ler o
 * acervo inteiro — a página busca no Firestore só o ano selecionado.
 *
 * O índice conta CASOS, não laudos liberados: a amostra entra no livro no
 * cadastro da entrada e a liberação só acrescenta data do laudo e diagnóstico à
 * linha que já existe. Por isso quem mexe no índice é a entrada (criação,
 * correção de protocolo e exclusão), não a liberação.
 */
import { db } from '../core.js';
import {
    doc, setDoc, runTransaction
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
 * Ano de série do caso, como chave do índice.
 *
 * Protocolo ilegível não tem ano. Descartar o caso aqui o faria sumir do livro
 * inteiro — o Histórico monta o filtro de ano a partir do índice. Vai para o
 * balde "0" (exibido como "Sem ano") até alguém corrigir o protocolo na ficha.
 */
function chaveDoAno(task) {
    const ano = Number(task && task.protocoloAno) || anoProtocolo(task && task.protocolo);
    return ano ? String(ano) : ANO_DESCONHECIDO;
}

function tipoDoCaso(task) {
    return (task && task.type) === 'necropsia' ? 'necropsia' : 'biopsia';
}

/**
 * Aplica somas e subtrações no índice de uma vez só.
 *
 * `deltas` é uma lista de `{ ano, tipo, delta }`. Uma transação (e não
 * `increment`) porque o ano que zera precisa SAIR do documento: `increment` só
 * sabe mexer no número, e a chave ficaria para trás com contagem 0 — o
 * Histórico continuaria oferecendo no filtro um ano que não tem mais caso
 * nenhum.
 *
 * Falha aqui não pode derrubar a operação que a chamou: o índice é um atalho de
 * leitura, e o Histórico sabe se virar sem ele (carrega o acervo inteiro e
 * regrava o índice pelo que encontrou). Por isso o erro é registrado e engolido.
 */
async function aplicarDeltas(deltas, contexto) {
    const validos = (deltas || []).filter((d) => d && d.ano && d.delta);
    if (validos.length === 0) return;

    try {
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(REF());
            const dados = snap.exists() ? (snap.data() || {}) : {};
            const anos = { ...(dados.anos || {}) };
            let total = Number(dados.total || 0);

            validos.forEach(({ ano, tipo, delta }) => {
                const doAno = { ...(anos[ano] || {}) };
                // O piso em 0 protege de contagem negativa: caso gravado antes
                // de o índice existir nunca foi somado, mas pode ser excluído
                // hoje.
                const atual = Number(doAno[tipo] || 0);
                const novo = Math.max(0, atual + delta);
                doAno[tipo] = novo;
                total = Math.max(0, total + (novo - atual));

                if (Object.values(doAno).some((n) => Number(n) > 0)) {
                    anos[ano] = doAno;
                } else {
                    delete anos[ano];
                }
            });

            tx.set(REF(), { anos, total, atualizadoEm: new Date().toISOString() });
        });
    } catch (erro) {
        console.warn(`Não foi possível atualizar o índice do livro (${contexto}).`, erro);
    }
}

/** Soma ao índice a amostra recém-cadastrada. */
export async function registrarCaso(task) {
    await aplicarDeltas(
        [{ ano: chaveDoAno(task), tipo: tipoDoCaso(task), delta: 1 }],
        'cadastro'
    );
}

/**
 * Desconta um caso que saiu do acervo.
 *
 * Sem isso os contadores do topo do Histórico continuam somando um caso que já
 * não existe — o mesmo tipo de fantasma que a lista mostraria.
 */
export async function registrarExclusao(task) {
    if (!task) return;
    await aplicarDeltas(
        [{ ano: chaveDoAno(task), tipo: tipoDoCaso(task), delta: -1 }],
        'exclusão'
    );
}

/**
 * Corrigir o protocolo na ficha pode mudar o ano da série ou o tipo do caso
 * (V vira VN). O caso continua sendo um só: sai da contagem de onde estava e
 * entra na de onde passou a ser.
 */
export async function moverCaso(antes, depois) {
    const de = { ano: chaveDoAno(antes), tipo: tipoDoCaso(antes) };
    const para = { ano: chaveDoAno(depois), tipo: tipoDoCaso(depois) };
    if (de.ano === para.ano && de.tipo === para.tipo) return;

    await aplicarDeltas([
        { ...de, delta: -1 },
        { ...para, delta: 1 }
    ], 'correção de protocolo');
}

/**
 * Regrava o índice inteiro a partir de uma contagem já apurada.
 *
 * O Histórico abre lendo o acervo todo, então ele sabe a verdade — e usa isso
 * para consertar um índice que ficou para trás (gravação que falhou, casos
 * cadastrados antes de o índice contar amostras pendentes).
 */
export async function gravarIndice(anos) {
    const limpo = {};
    let total = 0;

    Object.entries(anos || {}).forEach(([ano, contagens]) => {
        const doAno = {};
        Object.entries(contagens || {}).forEach(([tipo, n]) => {
            const valor = Math.max(0, Number(n) || 0);
            if (valor > 0) doAno[tipo] = valor;
        });
        if (Object.keys(doAno).length) {
            limpo[ano] = doAno;
            total += Object.values(doAno).reduce((s, n) => s + n, 0);
        }
    });

    try {
        await setDoc(REF(), { anos: limpo, total, atualizadoEm: new Date().toISOString() });
    } catch (erro) {
        console.warn('Não foi possível regravar o índice do livro de registros.', erro);
    }
}
