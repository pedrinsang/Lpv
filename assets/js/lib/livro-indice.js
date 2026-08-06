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
    doc, setDoc, increment
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { anoProtocolo } from './protocolo.js';

const REF = () => doc(db, 'meta', 'livroRegistros');

/**
 * Soma um laudo recém-liberado ao índice.
 *
 * Falha aqui não pode derrubar a liberação do laudo: o índice é um atalho de
 * leitura, e o Histórico já sabe se virar sem ele (carrega o acervo inteiro).
 * Por isso o erro é registrado e engolido.
 */
export async function registrarLiberacao(task) {
    const ano = Number(task && task.protocoloAno) || anoProtocolo(task && task.protocolo);
    if (!ano) return;

    const tipo = task.type === 'necropsia' ? 'necropsia' : 'biopsia';
    try {
        await setDoc(REF(), {
            anos: { [String(ano)]: { [tipo]: increment(1) } },
            total: increment(1),
            atualizadoEm: new Date().toISOString()
        }, { merge: true });
    } catch (erro) {
        console.warn('Não foi possível atualizar o índice do livro de registros.', erro);
    }
}
