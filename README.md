# LPV Digital

Sistema web do Laboratório de Patologia Veterinária. App estático (HTML + módulos ES, sem build) com Firebase Auth e Firestore.

## Rodar localmente

O projeto usa módulos ES, então precisa de um servidor estático — abrir o arquivo direto no navegador não funciona.

```powershell
npx serve -l 5500
```

Abra http://localhost:5500. A página de login é [pages/auth.html](pages/auth.html) e a home protegida é [pages/hub.html](pages/hub.html).

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

O setup do bucket está em [supabase/reports-storage-setup.sql](supabase/reports-storage-setup.sql). Use a chave `anon` e políticas RLS adequadas no bucket — o upload é feito direto do navegador.

## Segurança

- Não versionar segredos em `README`, `.env` ou código cliente.
- Rotacione imediatamente qualquer credencial que já tenha sido publicada.
