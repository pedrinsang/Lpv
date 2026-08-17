# LPV Digital

Sistema web do Laboratório de Patologia Veterinária. App estático (HTML + módulos ES, sem build) com Firebase Auth e Firestore.

## Rodar localmente

O projeto usa módulos ES, então precisa de um servidor estático — abrir o arquivo direto no navegador não funciona.

```powershell
npx serve -l 5500
```

Abra http://localhost:5500. A página de login é [pages/auth.html](pages/auth.html) e a home protegida é [pages/hub.html](pages/hub.html).

## Publicação

Site estático, sem build: publicar é dar push na `main`.

O Firebase Hosting não é usado — o [firebase.json](firebase.json) existe só para
publicar as regras do Firestore.

**Todo caminho escrito à mão precisa ser relativo.** Um `/assets/...` ou
`/pages/...` funciona no `npx serve` local e quebra assim que o app é servido de
uma subpasta. Foi o que aconteceu com a lista de arquivos do [sw.js](sw.js) no
GitHub Pages: os caminhos absolutos davam 404, a instalação do service worker
falhava inteira e o app ficava sem cache e sem o convite de instalação do PWA.

### Trocar de hospedagem

Só três coisas precisam de atenção — o código não guarda endereço nenhum.

1. **Firebase → Authentication → Settings → Authorized domains**: adicione o
   domínio novo *antes* de divulgar. Sem isso o login falha com
   `auth/unauthorized-domain`. Se a API key tiver restrição de referrer no Google
   Cloud, inclua a origem lá também.
2. **Supabase não precisa de nada**: as políticas do bucket identificam o usuário
   pelo emissor do token (o projeto Firebase), não pelo domínio.
3. **Endereço antigo**: veja abaixo — ele não morre sozinho.

### Migrar quem já usa o endereço antigo

Quem abriu o site antes tem um service worker registrado na origem antiga, com o
app em cache. Enquanto ele existir, aquela origem continua entregando uma versão
congelada — a pessoa fica num app que nunca atualiza e não tem como saber por quê.
Uma página de "mudamos de endereço" não resolve isso.

O [assets/js/migracao.js](assets/js/migracao.js) cuida disso: desregistra o
service worker, apaga o cache e leva a pessoa para o endereço novo, preservando a
página em que ela estava. Ele é o primeiro script de toda página e **não faz nada
enquanto `enderecoNovo` estiver vazio**.

Para ativar, preencha a constante no topo do arquivo e dê push. Passados alguns
meses, quando ninguém mais chegar pelo endereço antigo, apague o arquivo e as
linhas `<script>` que o chamam.

## Autenticação com Firebase

A configuração do Firebase fica embutida em [assets/js/core.js](assets/js/core.js) — é o único lugar onde ela existe.

- Providers: ative "Email/Password" em Authentication.
- Database: crie um Firestore em modo de produção e use as regras versionadas em [firestore.rules](firestore.rules).

Para apontar para outro projeto Firebase, copie o objeto de configuração Web (Project settings → Your apps → Web → Config) e substitua o `firebaseConfig` no topo do [core.js](assets/js/core.js).

### Publicar regras do Firestore

```powershell
firebase deploy --only firestore:rules
```

### Solução de problemas

- `auth/api-key-not-valid`: o `firebaseConfig` em [core.js](assets/js/core.js) está incorreto ou a chave tem restrições.
	- Use o config exato do Console.
	- Adicione seu domínio em Authentication → Settings → Authorized domains (ex.: `localhost`).
	- Se a API key tem restrições no Google Cloud, inclua o origin (ex.: `http://localhost:5500`).
- `databaseURL`: só é necessário para Realtime Database. Este projeto usa Firestore, então pode ser omitido.
- `measurementId`: opcional; inclua se for usar Analytics.

## Arquivos do Laudo (Word + PDF)

O laudo entra no sistema como arquivo enviado — não existe editor de laudo online.

- Upload manual de Word e PDF, com histórico de versões por caso.
- A versão ativa de cada tipo é a fonte oficial do laudo.
- Os arquivos ficam no Supabase Storage, enviados direto pelo frontend.

### Configuração do storage

Os valores padrão já estão em [assets/js/lib/storage-provider-config.js](assets/js/lib/storage-provider-config.js). Para apontar para outro projeto, configure no navegador (uma vez) e os valores ficam salvos em `localStorage`:

```javascript
window.setStorageProviderConfig({
	supabaseUrl: 'https://SEU-PROJETO.supabase.co',
	supabaseAnonKey: 'SUA_SUPABASE_ANON_KEY',
	supabaseReportsBucket: 'reports'
});
```

### Acesso ao bucket

O bucket guarda laudo com dado clínico identificado, então o acesso exige usuário autenticado. Como o login é do Firebase e o storage é do Supabase, são dois passos, nesta ordem:

1. **Supabase → Authentication → Sign In / Providers → Third-Party Auth**: adicione o Firebase com o project ID `labpatvet-9e06a`. É o que faz o Supabase validar a assinatura do token.
2. **SQL Editor**: rode [supabase/reports-storage-setup.sql](supabase/reports-storage-setup.sql), que cria o bucket e aplica as políticas.

Inverter a ordem derruba o upload: as políticas passam a exigir uma autenticação que ainda não existe.

As políticas identificam o usuário pelo emissor do token (`iss`), não pelo papel `authenticated`. É de propósito: o papel dependeria de uma claim gravada por fora do navegador, e como o cadastro é self-service, toda pessoa nova ficaria sem acesso até alguém lembrar de rodar um script. Pelo emissor, usuário novo funciona sozinho.

**Plano B** — se algum dia um usuário autenticado não conseguir abrir laudo, o caminho da claim continua disponível:

```powershell
npm install firebase-admin
node scripts/set-supabase-claims.mjs "C:\caminho\para\a-chave-de-servico.json"
```

A chave de serviço sai do Console do Firebase (Configurações do projeto → Contas de serviço) e dá acesso administrativo total ao projeto — guarde fora do repositório e nunca a compartilhe.

### Pausa do projeto gratuito

O plano gratuito do Supabase pausa o projeto após 7 dias sem requisição — e o intervalo aparece justamente em férias e recesso. O workflow [supabase-keepalive.yml](.github/workflows/supabase-keepalive.yml) acessa o projeto a cada 3 dias para evitar isso.

Atenção: o GitHub desativa workflows agendados em repositórios que passam 60 dias sem commit. Se o projeto ficar parado esse tempo, reative na aba Actions.

## Segurança

- Não versionar segredos em `README`, `.env` ou código cliente.
- Rotacione imediatamente qualquer credencial que já tenha sido publicada.
