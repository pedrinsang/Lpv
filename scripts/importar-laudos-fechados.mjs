/**
 * Cadastra no sistema, já liberados, os casos que só existiam em arquivo.
 *
 * POR QUE ISTO EXISTE
 *
 * A planilha "Necropsias Faltantes" mostrou 72 protocolos que existem no
 * laboratório mas não no app. Cadastrar isso a mão é digitar dezenas de fichas
 * de vinte e poucos campos, cada uma com o diagnóstico inteiro do patologista
 * para transcrever.
 *
 * São duas levas, cada uma no seu arquivo de dados:
 *
 *   scripts/dados/laudos-fechados-2025.json   32 casos com laudo em PDF —
 *     caso encerrado, diagnóstico escrito, data de emissão definida.
 *
 *   scripts/dados/necropsias-em-aberto.json   25 casos que só têm o Word —
 *     necropsia feita, diagnóstico ainda não escrito. Entram com a data de
 *     hoje no laudo e um traço no diagnóstico, de propósito: é o que tira o
 *     caso da lista de amostras do Mural e do Hub. A pós que quiser fechar o
 *     diagnóstico reabre o registro do livro pela ficha e escreve por cima —
 *     o caso não volta para o Mural, só a linha do livro se completa.
 *
 * Os dados já foram lidos dos próprios arquivos. Este script só grava. Confira
 * o JSON antes de aplicar: o que estiver errado lá entra errado no acervo.
 *
 * O QUE ELE GRAVA
 *
 * Cada caso vira um documento de `tasks` igual ao que o formulário de entrada
 * cria, e já com a liberação do laudo por cima (`dataLaudo`, `diagnostico`,
 * `releasedAt`, `status: 'concluido'`). Na prática o caso nasce direto no
 * Livro de Registros, sem passar pelo Mural.
 *
 * O índice do livro (`meta/livroRegistros`) é somado no fim, do mesmo jeito que
 * o cadastro faz: sem isso o filtro de ano e os contadores do Histórico não
 * enxergam os casos novos.
 *
 * Campo do laudo que não tem campo no app — histórico clínico, suspeita
 * clínica, tempo decorrido desde a morte, estado de conservação, descrição da
 * necropsia, comentários — não é gravado. O PDF continua sendo a fonte disso.
 *
 * O QUE ELE NÃO FAZ
 *
 * Não sobe o arquivo PDF para o caso. O anexo do laudo passa pelo Storage
 * (Supabase) e pela sessão de quem está logado; isso é pela ficha do caso, no
 * app.
 *
 * COMO USAR
 *
 *   1. No Console do Firebase: Configurações do projeto -> Contas de serviço
 *      -> "Gerar nova chave privada". Salve o JSON FORA do repositório.
 *
 *      Esse arquivo dá acesso administrativo total ao projeto. Nunca comite,
 *      nunca mande por e-mail ou WhatsApp.
 *
 *   2. Confira o que seria gravado (não grava nada):
 *
 *      node scripts/importar-laudos-fechados.mjs "C:\caminho\para\a-chave.json"
 *
 *   3. Grave:
 *
 *      node scripts/importar-laudos-fechados.mjs "C:\caminho\para\a-chave.json" --aplicar
 *
 *   Sem `--dados` ele usa os laudos em PDF. Para a leva dos Word:
 *
 *      node scripts/importar-laudos-fechados.mjs "C:\...\chave.json" --dados=necropsias-em-aberto.json --aplicar
 *
 * É idempotente pelo protocolo: caso que já existe em `tasks` é pulado e
 * listado, então rodar de novo não duplica nada.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { camposDerivados, formatarProtocolo } from '../assets/js/lib/protocolo.js';
import { formatarContato } from '../assets/js/lib/contato.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Qual leva importar. `--dados=<arquivo>` procura em `scripts/dados/`. */
const NOME_DADOS = (process.argv.find((a) => a.startsWith('--dados=')) || '')
    .slice('--dados='.length) || 'laudos-fechados-2025.json';
const ARQUIVO_DADOS = join(AQUI, 'dados', NOME_DADOS);

/** Marca quem cadastrou. Não é uid de ninguém de propósito: não foi pessoa, foi este script. */
const AUTOR = 'importacao-laudos-pdf';

/** Nome do docente responsável, como está na coleção `users` — o select da entrada grava o nome. */
const PATOLOGISTA_PADRAO = 'Mariana Martins Flores';

const aplicar = process.argv.includes('--aplicar');
const caminhoChave = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!caminhoChave) {
    console.error('Informe o caminho da chave de serviço:\n'
        + '  node scripts/importar-laudos-fechados.mjs "C:\\caminho\\para\\a-chave.json" [--aplicar]');
    process.exit(1);
}

let credenciais;
try {
    credenciais = JSON.parse(await readFile(caminhoChave, 'utf8'));
} catch (erro) {
    console.error(`Não foi possível ler a chave em "${caminhoChave}": ${erro.message}`);
    process.exit(1);
}

const casos = JSON.parse(await readFile(ARQUIVO_DADOS, 'utf8'));

initializeApp({ credential: cert(credenciais) });
const db = getFirestore();

// --- 1. O que já está no acervo -------------------------------------------
// Compara pela grafia oficial: "Vn-049-25" e "Vn049-25" são o mesmo caso, e o
// acervo tem as duas formas.
const snapshot = await db.collection('tasks').get();
const jaNoAcervo = new Map();
snapshot.forEach((doc) => {
    const protocolo = doc.data().protocolo;
    if (protocolo) jaNoAcervo.set(formatarProtocolo(protocolo), doc.id);
});

// --- 2. Docente e pós-graduando -------------------------------------------
// O caso guarda o NOME (é o que o select da entrada grava). A busca no perfil
// serve para duas coisas: confirmar que a grafia bate com a da equipe e pegar o
// uid do pós — `posResponsavelUid` é por onde o app reconhece de quem é o caso.
const usuarios = await db.collection('users').get();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

let docente = '';
const posPorNome = new Map();

usuarios.forEach((doc) => {
    const dados = doc.data();
    const nome = dados.name || '';
    if (!nome) return;

    const papeis = Array.isArray(dados.role)
        ? dados.role.map((r) => String(r).toLowerCase())
        : [String(dados.role || '').toLowerCase()];

    if (papeis.includes('professor') && semAcento(nome) === semAcento(PATOLOGISTA_PADRAO)) docente = nome;
    if (papeis.some((r) => r.includes('graduando'))) posPorNome.set(semAcento(nome), { nome, uid: doc.id });
});

if (!docente) {
    console.log(`Nenhum perfil de professor em "users" com o nome "${PATOLOGISTA_PADRAO}".`);
    console.log('Os casos entram sem docente responsável — dá para preencher depois na ficha.\n');
}

/**
 * Perfil do pós que assina o laudo.
 *
 * O nome que vale é o do cadastro, não o do laudo: é ele que o select da
 * entrada grava, e é por ele que o filtro "Pós-graduando" do Livro de Registros
 * agrupa. "Thainã P. Vargas" no rodapé do laudo tem que virar o nome inteiro
 * como está em `users`, senão o mesmo pós vira duas opções no filtro.
 *
 * Por isso a busca é tolerante: primeiro nome idêntico ao do cadastro; depois
 * primeiro e último nome iguais, ignorando acento, maiúscula e as partículas
 * ("de", "da", "dos"). Só aceita quando UM único perfil bate — dois candidatos
 * viram "sem perfil", porque chutar aqui é pendurar o caso na pessoa errada.
 *
 * Sem perfil correspondente o nome do laudo entra assim mesmo (é a informação
 * que existe) e o uid fica vazio: o caso mostra o nome certo na ficha e no
 * Livro, só não fica vinculado ao login dessa pessoa.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const pedacos = (nome) => semAcento(nome)
    .replace(/[.]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !PARTICULAS.has(p));

const posSemPerfil = new Set();
const deParaPos = new Map();

function perfilDoPos(nome) {
    if (!nome) return { nome: '', uid: '' };

    const exato = posPorNome.get(semAcento(nome));
    if (exato) {
        if (exato.nome !== nome) deParaPos.set(nome, exato.nome);
        return exato;
    }

    const partes = pedacos(nome);
    if (partes.length >= 2) {
        const candidatos = [...posPorNome.values()].filter((perfil) => {
            const outras = pedacos(perfil.nome);
            return outras.length >= 2
                && outras[0] === partes[0]
                && outras[outras.length - 1] === partes[partes.length - 1];
        });
        if (candidatos.length === 1) {
            deParaPos.set(nome, candidatos[0].nome);
            return candidatos[0];
        }
    }

    posSemPerfil.add(nome);
    return { nome, uid: '' };
}

// --- 3. Monta os documentos -----------------------------------------------
const agora = new Date().toISOString();

function documentoDoCaso(caso) {
    const protocolo = formatarProtocolo(caso.protocolo);
    const pos = perfilDoPos(caso.posGraduando);

    return {
        protocolo,
        ...camposDerivados(protocolo),
        type: 'necropsia',
        dataEntrada: caso.dataEntrada || '',

        // Prioridade: caso encerrado não disputa fila.
        isUrgent: false,
        isPriority: false,

        remetente: caso.remetente || '',
        remetenteCrmv: caso.remetenteCrmv || '',
        remetenteContato: formatarContato(caso.remetenteContato),
        remetenteClinicaEmpresa: caso.remetenteClinicaEmpresa || '',
        remetenteEndereco: caso.remetenteEndereco || '',
        origem: caso.origem || 'Externo',

        animalNome: caso.animalNome || '',
        animalRg: caso.animalRg || '',
        especie: caso.especie || '',
        raca: caso.raca || '',
        sexo: caso.sexo || '',
        idade: caso.idade || '',

        proprietario: caso.proprietario || '',
        proprietarioContato: formatarContato(caso.proprietarioContato),
        proprietarioEndereco: caso.proprietarioEndereco || '',

        situacao: caso.financialStatus || 'pendente',
        financialStatus: caso.financialStatus || 'pendente',
        valor: '',
        docente,
        posGraduando: pos.nome,
        posResponsavelUid: pos.uid,

        // O cassete: necropsia é azul na entrada, e nenhum foi processado aqui.
        k7Color: 'azul',
        k7Quantity: 0,

        createdBy: AUTOR,
        createdAt: agora,

        // O laudo já saiu — o caso nasce fechado, direto no Livro de Registros.
        dataLaudo: caso.dataLaudo || '',
        diagnostico: caso.diagnostico || '',
        releasedBy: AUTOR,
        releasedAt: agora,
        status: 'concluido'
    };
}

const novos = [];
const pulados = [];

casos.forEach((caso) => {
    const protocolo = formatarProtocolo(caso.protocolo);
    if (jaNoAcervo.has(protocolo)) {
        pulados.push(protocolo);
        return;
    }
    novos.push({ protocolo, arquivo: caso.arquivo, doc: documentoDoCaso(caso) });
});

// --- 4. Relatório ---------------------------------------------------------
console.log(`${casos.length} caso(s) em ${NOME_DADOS}`);
console.log(`  ${pulados.length} já existe(m) em tasks — pulado(s)`);
console.log(`  ${novos.length} a cadastrar\n`);

if (pulados.length) console.log(`Pulados: ${pulados.join(', ')}\n`);

novos.forEach(({ protocolo, doc }) => {
    const animal = [doc.animalNome, doc.especie, doc.raca].filter(Boolean).join(', ') || 'sem dados do animal';
    const pos = doc.posGraduando ? `  [pós: ${doc.posGraduando}${doc.posResponsavelUid ? '' : ' — sem perfil'}]` : '';
    console.log(`  ${protocolo.padEnd(10)} ${(doc.dataEntrada || 'sem entrada').padEnd(12)} ${animal}${pos}`);
});

if (deParaPos.size) {
    console.log('\nNome do laudo trocado pelo nome do cadastro:');
    deParaPos.forEach((cadastro, laudo) => console.log(`  "${laudo}" -> "${cadastro}"`));
}

if (posSemPerfil.size) {
    console.log(`\n${posSemPerfil.size} pós-graduando(s) sem perfil correspondente em "users":`);
    posSemPerfil.forEach((nome) => console.log(`  ${nome}`));
    console.log('  O nome entra na ficha como está no laudo, mas o caso não fica');
    console.log('  vinculado ao login dessa pessoa. Confira a grafia no cadastro.');
}

if (posPorNome.size) {
    console.log(`\nPós-graduandos cadastrados em "users" (${posPorNome.size}):`);
    [...posPorNome.values()].forEach(({ nome }) => console.log(`  ${nome}`));
}

// Campo vazio não trava a gravação: a ficha aceita e mostra travessão. Mas
// vale saber quais vão entrar incompletos, para completar na ficha depois.
const incompletos = novos
    .map(({ protocolo, doc }) => {
        const faltando = ['dataEntrada', 'especie', 'sexo', 'proprietario', 'diagnostico', 'dataLaudo']
            .filter((campo) => !doc[campo]);
        return { protocolo, faltando };
    })
    .filter((c) => c.faltando.length);

if (incompletos.length) {
    console.log(`\n${incompletos.length} caso(s) entram com campo em branco (o próprio PDF não traz):`);
    incompletos.forEach(({ protocolo, faltando }) => console.log(`  ${protocolo.padEnd(10)} ${faltando.join(', ')}`));
}

if (!novos.length) {
    console.log('\nNada a fazer.');
    process.exit(0);
}

if (!aplicar) {
    console.log('\nNada foi gravado. Rode de novo com --aplicar para gravar.');
    process.exit(0);
}

// --- 5. Grava -------------------------------------------------------------
// Lotes de 400: o limite do batch do Firestore é 500 operações.
const TAMANHO_LOTE = 400;
let gravados = 0;

for (let i = 0; i < novos.length; i += TAMANHO_LOTE) {
    const lote = db.batch();
    novos.slice(i, i + TAMANHO_LOTE).forEach(({ doc }) => {
        lote.set(db.collection('tasks').doc(), doc);
    });
    await lote.commit();
    gravados += Math.min(TAMANHO_LOTE, novos.length - i);
    console.log(`\n  ${gravados}/${novos.length} gravado(s)`);
}

// --- 6. Índice do Livro de Registros --------------------------------------
// Mesma conta de `assets/js/lib/livro-indice.js`: o índice conta CASOS, e é o
// cadastro que soma. Sem isto o Histórico não oferece o ano no filtro nem conta
// os casos novos no total do acervo.
const porAno = new Map();
novos.forEach(({ doc }) => {
    const ano = doc.protocoloAno ? String(doc.protocoloAno) : '0';
    porAno.set(ano, (porAno.get(ano) || 0) + 1);
});

try {
    const ref = db.collection('meta').doc('livroRegistros');
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const dados = snap.exists ? (snap.data() || {}) : {};
        const anos = { ...(dados.anos || {}) };
        let total = Number(dados.total || 0);

        porAno.forEach((delta, ano) => {
            const doAno = { ...(anos[ano] || {}) };
            const atual = Number(doAno.necropsia || 0);
            doAno.necropsia = atual + delta;
            total += delta;
            anos[ano] = doAno;
        });

        tx.set(ref, { anos, total, atualizadoEm: new Date().toISOString() });
    });
    const resumo = [...porAno.entries()].map(([ano, n]) => `${ano}: +${n}`).join(', ');
    console.log(`Índice do livro atualizado (${resumo}).`);
} catch (erro) {
    // O índice é atalho de leitura: o Histórico se conserta sozinho na próxima
    // abertura (lê o acervo inteiro e regrava). Falhar aqui não desfaz nada.
    console.warn(`Não foi possível atualizar o índice do livro: ${erro.message}`);
    console.warn('Abra o Histórico uma vez — ele reconta o acervo e regrava o índice.');
}

console.log(`\n${gravados} caso(s) cadastrado(s) e já liberados.`);
