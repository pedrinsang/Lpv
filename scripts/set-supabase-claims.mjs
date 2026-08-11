/**
 * Marca os usuários do Firebase como `authenticated` para o Supabase.
 *
 * O Supabase aceita o token do Firebase (Third-Party Auth), mas só trata o
 * usuário como autenticado se o token trouxer a claim `role: authenticated`.
 * Sem ela, as políticas do bucket `reports` recusam upload e download.
 *
 * Claim é coisa de servidor: não dá para definir pelo navegador. Como o
 * cadastro é self-service (o usuário se registra e um admin aprova), este
 * script precisa ser rodado de novo sempre que alguém novo entrar no
 * laboratório. São poucos por ano — roda em segundos.
 *
 * COMO USAR
 *
 *   1. No Console do Firebase: Configurações do projeto -> Contas de serviço
 *      -> "Gerar nova chave privada". Salve o JSON FORA do repositório
 *      (ex.: C:\Users\seu-usuario\lpv-service-account.json).
 *
 *      Esse arquivo é uma credencial de administrador: dá acesso total ao
 *      projeto. Nunca comite, nunca mande por e-mail ou WhatsApp.
 *
 *   2. npm install firebase-admin
 *
 *   3. node scripts/set-supabase-claims.mjs "C:\caminho\para\a-chave.json"
 *
 *      Ou defina GOOGLE_APPLICATION_CREDENTIALS com o caminho e rode sem
 *      argumento.
 *
 * Depois de rodar, quem já estava logado continua com o token antigo por até
 * uma hora. Recarregar a página resolve — o cliente força a renovação do token
 * na primeira chamada (ver assets/js/lib/report-files-service.js).
 */

import { readFile } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const CLAIM = 'authenticated';

const caminhoChave = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!caminhoChave) {
    console.error('Informe o caminho da chave de serviço:\n'
        + '  node scripts/set-supabase-claims.mjs "C:\\caminho\\para\\a-chave.json"');
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
const auth = getAuth();

let atualizados = 0;
let jaOk = 0;
let falhas = 0;
let pageToken;

do {
    const lote = await auth.listUsers(1000, pageToken);

    for (const usuario of lote.users) {
        const claims = usuario.customClaims || {};

        if (claims.role === CLAIM) {
            jaOk += 1;
            continue;
        }

        try {
            // Preserva claims que já existam — sobrescrever apagaria as outras.
            await auth.setCustomUserClaims(usuario.uid, { ...claims, role: CLAIM });
            console.log(`  ok   ${usuario.email || usuario.uid}`);
            atualizados += 1;
        } catch (erro) {
            console.error(`  ERRO ${usuario.email || usuario.uid}: ${erro.message}`);
            falhas += 1;
        }
    }

    pageToken = lote.pageToken;
} while (pageToken);

console.log(`\n${atualizados} atualizado(s), ${jaOk} já estava(m) correto(s), ${falhas} falha(s).`);

if (falhas > 0) process.exit(1);
