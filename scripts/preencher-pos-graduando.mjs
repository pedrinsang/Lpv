/**
 * Preenche o pós-graduando responsável nos casos importados.
 *
 * POR QUE ISTO EXISTE
 *
 * Os 39 casos de 2025 que vieram dos arquivos (`importar-laudos-fechados.mjs`)
 * foram gravados antes de o pós-graduando entrar na importação, então estão com
 * `posGraduando` em branco — apesar de o rodapé do laudo dizer quem assinou.
 *
 * O import não conserta isso: ele pula caso que já existe, de propósito, para
 * não duplicar. Este script é o complemento — só mexe em quem já está lá, e só
 * nos dois campos do pós.
 *
 * O NOME QUE VALE É O DO CADASTRO
 *
 * `posGraduando` guarda o nome como está em `users` — é o que o select da
 * entrada grava, e é por ele que o filtro do Livro de Registros agrupa. O laudo
 * às vezes escreve diferente ("Thainã Piccolo Vargas" onde o cadastro diz
 * "Thainã P. Vargas"); os arquivos em `scripts/dados/` já trazem a grafia do
 * cadastro, e aqui a conferência é exata (só ignora acento e maiúscula).
 *
 * Nome sem perfil correspondente não é gravado — nem o nome, nem o uid. Chutar
 * penduraria o caso na pessoa errada, e `posResponsavelUid` é justamente o que
 * o app usa para saber de quem é o caso.
 *
 * COMO USAR
 *
 *   Confira (não grava nada):
 *
 *     node scripts/preencher-pos-graduando.mjs "C:\caminho\para\a-chave.json"
 *
 *   Grave:
 *
 *     node scripts/preencher-pos-graduando.mjs "C:\caminho\para\a-chave.json" --aplicar
 *
 * É idempotente: caso que já está com o nome e o uid certos não é tocado.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { formatarProtocolo } from '../assets/js/lib/protocolo.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** De onde sai "quem assinou qual laudo". Mesmos arquivos que a importação usa. */
const LEVAS = ['laudos-fechados-2025.json', 'necropsias-em-aberto.json'];

const aplicar = process.argv.includes('--aplicar');
const caminhoChave = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!caminhoChave) {
    console.error('Informe o caminho da chave de serviço:\n'
        + '  node scripts/preencher-pos-graduando.mjs "C:\\caminho\\para\\a-chave.json" [--aplicar]');
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

// --- Quem assinou cada laudo ----------------------------------------------
const assinatura = new Map();
for (const leva of LEVAS) {
    const casos = JSON.parse(await readFile(join(AQUI, 'dados', leva), 'utf8'));
    casos.forEach((caso) => {
        if (caso.posGraduando) assinatura.set(formatarProtocolo(caso.protocolo), caso.posGraduando);
    });
}

// --- Os perfis de pós-graduando -------------------------------------------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const perfis = new Map();

const usuarios = await db.collection('users').get();
usuarios.forEach((doc) => {
    const dados = doc.data();
    const nome = dados.name || '';
    if (!nome) return;
    const papeis = Array.isArray(dados.role)
        ? dados.role.map((r) => String(r).toLowerCase())
        : [String(dados.role || '').toLowerCase()];
    if (papeis.some((r) => r.includes('graduando'))) perfis.set(semAcento(nome), { nome, uid: doc.id });
});

console.log(`${perfis.size} pós-graduando(s) cadastrados em "users":`);
perfis.forEach(({ nome }) => console.log(`  ${nome}`));

// --- O que muda -----------------------------------------------------------
const snapshot = await db.collection('tasks').get();
const mudancas = [];
const semPerfil = new Map();
let jaOk = 0;

snapshot.forEach((doc) => {
    const dados = doc.data();
    if (!dados.protocolo) return;

    const protocolo = formatarProtocolo(dados.protocolo);
    const nomeDoLaudo = assinatura.get(protocolo);
    if (!nomeDoLaudo) return;

    const perfil = perfis.get(semAcento(nomeDoLaudo));
    if (!perfil) {
        semPerfil.set(nomeDoLaudo, (semPerfil.get(nomeDoLaudo) || 0) + 1);
        return;
    }

    if (dados.posGraduando === perfil.nome && dados.posResponsavelUid === perfil.uid) {
        jaOk += 1;
        return;
    }

    mudancas.push({
        id: doc.id,
        protocolo,
        antes: dados.posGraduando || '(vazio)',
        depois: perfil.nome,
        uid: perfil.uid
    });
});

console.log(`\n${assinatura.size} caso(s) com pós no laudo`);
console.log(`  ${jaOk} já está(ão) certo(s)`);
console.log(`  ${mudancas.length} a preencher\n`);

mudancas.forEach(({ protocolo, antes, depois }) => {
    console.log(`  ${protocolo.padEnd(10)} ${antes.padEnd(24)} -> ${depois}`);
});

if (semPerfil.size) {
    console.log(`\nSem perfil correspondente em "users" — não vou gravar estes:`);
    semPerfil.forEach((n, nome) => console.log(`  ${nome} (${n} caso(s))`));
}

if (!mudancas.length) {
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

for (let i = 0; i < mudancas.length; i += TAMANHO_LOTE) {
    const lote = db.batch();
    mudancas.slice(i, i + TAMANHO_LOTE).forEach(({ id, depois, uid }) => {
        lote.update(db.collection('tasks').doc(id), {
            posGraduando: depois,
            posResponsavelUid: uid
        });
    });
    await lote.commit();
    gravados += Math.min(TAMANHO_LOTE, mudancas.length - i);
    console.log(`  ${gravados}/${mudancas.length} gravado(s)`);
}

console.log(`\n${gravados} caso(s) atualizado(s).`);
