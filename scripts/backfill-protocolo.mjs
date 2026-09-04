/**
 * Grava `protocoloAno` e `protocoloPeso` nos casos que não têm esses campos.
 *
 * POR QUE ISTO EXISTE
 *
 * O Mural, o Hub e o Planner não leem a coleção `tasks` inteira: eles filtram
 * por `protocoloAno` (>= ano passado, ou == 0 para protocolo ilegível). E o
 * Firestore NÃO devolve documento que não tem o campo do filtro — nem no `>=`,
 * nem no `== 0`. Não é o mesmo que ter o campo valendo zero.
 *
 * Os campos passaram a ser gravados no cadastro em 06/08/2026. Todo caso
 * registrado antes disso ficou sem eles e, portanto, fora das três telas —
 * inclusive amostra urgente, inclusive laudo pendente. No Livro de Registros
 * eles também somem do filtro por ano (só aparecem em "Todos os anos", que lê
 * o acervo inteiro).
 *
 * Este script é a correção de uma vez: varre `tasks`, calcula os campos a
 * partir do texto do protocolo e grava onde faltam. É idempotente — rodar de
 * novo não muda nada — e não toca em nenhum outro campo do caso.
 *
 * COMO USAR
 *
 *   1. No Console do Firebase: Configurações do projeto -> Contas de serviço
 *      -> "Gerar nova chave privada". Salve o JSON FORA do repositório.
 *
 *      Esse arquivo dá acesso administrativo total ao projeto. Nunca comite,
 *      nunca mande por e-mail ou WhatsApp.
 *
 *   2. Confira o que seria mudado (não grava nada):
 *
 *      node scripts/backfill-protocolo.mjs "C:\caminho\para\a-chave.json"
 *
 *   3. Grave:
 *
 *      node scripts/backfill-protocolo.mjs "C:\caminho\para\a-chave.json" --aplicar
 *
 * Depois de rodar, as telas se corrigem sozinhas: Mural e Hub escutam o
 * Firestore (onSnapshot) e recebem os casos na hora, sem recarregar a página.
 *
 * Protocolo que o app não consegue ler recebe `protocoloAno: 0` e cai no balde
 * "Sem ano" do Livro — visível e corrigível na ficha, que é o ponto: melhor no
 * balde do que invisível. O script lista esses casos no fim.
 */

import { readFile } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { camposDerivados, parseProtocolo } from '../assets/js/lib/protocolo.js';

/** Compromisso da agenda do Planner: não é amostra, não tem protocolo, fica de fora. */
const EH_AGENDAMENTO = (dados) => dados.type === 'agendamento_rapido';

const aplicar = process.argv.includes('--aplicar');
const caminhoChave = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!caminhoChave) {
    console.error('Informe o caminho da chave de serviço:\n'
        + '  node scripts/backfill-protocolo.mjs "C:\\caminho\\para\\a-chave.json" [--aplicar]');
    process.exit(1);
}

let credenciais;
try {
    credenciais = JSON.parse(await readFile(caminhoChave, 'utf8'));
} catch (erro) {
    console.error(`Não foi possível ler a chave em "${caminhoChave}": ${erro.message}`);
    process.exit(1);
}

initializeApp({ credential: cert(credenciais) });
const db = getFirestore();

const snapshot = await db.collection('tasks').get();

const pendentes = [];
let agendamentos = 0;
let jaOk = 0;

snapshot.forEach((doc) => {
    const dados = doc.data();

    if (EH_AGENDAMENTO(dados)) {
        agendamentos += 1;
        return;
    }

    const derivados = camposDerivados(dados.protocolo);
    const igual = dados.protocoloAno === derivados.protocoloAno
        && dados.protocoloPeso === derivados.protocoloPeso;

    if (igual) {
        jaOk += 1;
        return;
    }

    pendentes.push({
        id: doc.id,
        protocolo: dados.protocolo || '(sem protocolo)',
        anoAtual: dados.protocoloAno,
        derivados,
        pendenteDeLaudo: !dados.releasedAt
    });
});

console.log(`${snapshot.size} documento(s) em tasks`);
console.log(`  ${agendamentos} agendamento(s) do Planner — ignorados`);
console.log(`  ${jaOk} caso(s) já com os campos corretos`);
console.log(`  ${pendentes.length} caso(s) a corrigir\n`);

pendentes.forEach(({ protocolo, anoAtual, derivados, pendenteDeLaudo }) => {
    const antes = anoAtual === undefined ? 'sem o campo' : `ano ${anoAtual}`;
    const marca = pendenteDeLaudo ? ' [laudo pendente]' : '';
    console.log(`  ${protocolo.padEnd(12)} ${antes} -> ano ${derivados.protocoloAno}${marca}`);
});

const ilegiveis = pendentes.filter((c) => !parseProtocolo(c.protocolo));
if (ilegiveis.length) {
    console.log(`\n${ilegiveis.length} protocolo(s) que o app não consegue ler — vão para o balde`
        + ' "Sem ano" do Livro de Registros até alguém corrigir na ficha:');
    ilegiveis.forEach((c) => console.log(`  ${c.protocolo}`));
}

if (!pendentes.length) {
    console.log('\nNada a fazer.');
    process.exit(0);
}

if (!aplicar) {
    console.log('\nNada foi gravado. Rode de novo com --aplicar para gravar.');
    process.exit(0);
}

// Lotes de 400: o limite do batch do Firestore é 500 operações.
const TAMANHO_LOTE = 400;
let gravados = 0;

for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
    const lote = db.batch();
    pendentes.slice(i, i + TAMANHO_LOTE).forEach(({ id, derivados }) => {
        lote.update(db.collection('tasks').doc(id), derivados);
    });
    await lote.commit();
    gravados += Math.min(TAMANHO_LOTE, pendentes.length - i);
    console.log(`  ${gravados}/${pendentes.length} gravado(s)`);
}

console.log(`\n${gravados} caso(s) corrigido(s).`);
