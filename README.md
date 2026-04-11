## Autenticação com Firebase

- Configuração: edite [assets/js/firebase-config.js](assets/js/firebase-config.js) com as credenciais do seu projeto Firebase.
- Providers: ative "Email/Password" em Authentication.
- Database: crie um Firestore no modo de produção e use as regras versionadas em [firestore.rules](firestore.rules).
- Páginas: use [pages/auth.html](pages/auth.html) para login/cadastro. A home protegida é [index.html](index.html).

### Passos
- Crie um projeto em https://console.firebase.google.com.
- Em "Project settings" copie o objeto de configuração Web e substitua os campos em [assets/js/firebase-config.js](assets/js/firebase-config.js).
- Em Authentication → Sign-in method, habilite Email/Password.
- Em Firestore Database, crie o banco e publique as regras com:

```powershell
firebase deploy --only firestore:rules
```

### Rodar localmente
- Use um servidor estático para servir os módulos ES:

```powershell
npm install -g serve
serve -l 5500
```

- Ou com `http-server`:

```powershell
npm install -g http-server
http-server -p 5500
```

Abra http://localhost:5500 e acesse a página de autenticação em /pages/auth.html.

### Solução de problemas
- `auth/api-key-not-valid`: campos em [assets/js/firebase-config.js](assets/js/firebase-config.js) estão incorretos ou a chave tem restrições.
	- Use o config exato do Console (Project settings → Your apps → Web → Config).
	- Adicione seu domínio em Authentication → Settings → Authorized domains (ex.: `localhost`).
	- Se a API key tem restrições no Google Cloud, inclua o origin (ex.: `http://localhost:5500`).
- `databaseURL`: só é necessário para Realtime Database. Este projeto usa Firestore, então você pode omitir `databaseURL`.
- `measurementId`: opcional; inclua se for usar Analytics.

# Lpv

## Laudos Híbridos (PDF + Word)

O sistema agora suporta:

- Geração e download de PDF (fluxo existente).
- Geração e download de Word.
- Upload manual de Word e PDF com histórico de versões por caso.
- Conversão automática Word -> PDF no backend (quando configurada).
- Fonte oficial do laudo baseada no arquivo ativo (online/Word/PDF).

Regra funcional:

- Se houver Word ativo para um caso, o preenchimento do laudo online passa a ser opcional.

## Fotos Internas do Laboratório

- Upload de fotos internas na criação e edição de entradas.
- As fotos são mantidas no formato original enviado (ex: JPG, PNG, WEBP).
- As fotos NÃO entram no laudo PDF/Word e NÃO são expostas no portal público.

## Backend de Arquivos (Firebase Cloud Functions)

Este projeto agora inclui o diretório [functions](functions) com endpoints para:

- Upload/download versionado de Word/PDF em storage externo.
- Download público de PDF ativo por código de acesso (sem expor Word/fotos).
- Conversão Word -> PDF (serviço HTTP configurável).
- Upload/remoção de fotos internas no Cloudinary.

### 1. Instalar dependências das funções

```powershell
cd functions
npm install
```

### 2. Configurar variáveis das funções

- Copie [functions/.env.example](functions/.env.example) para `functions/.env` e preencha os valores.
- Variáveis obrigatórias:
	- `SUPABASE_URL`
	- `SUPABASE_SERVICE_ROLE_KEY`
	- `CLOUDINARY_CLOUD_NAME`
	- `CLOUDINARY_API_KEY`
	- `CLOUDINARY_API_SECRET`
- Variáveis opcionais (conversão automática Word -> PDF):
	- `WORD_TO_PDF_CONVERTER_ENABLED` (`false` por padrão; usar `true` para habilitar)
	- `WORD_TO_PDF_CONVERTER_URL` (obrigatória somente quando a flag estiver `true`)
	- `WORD_TO_PDF_CONVERTER_KEY` (segredo compartilhado opcional)

### 3. Rodar emulador (opcional)

```powershell
firebase emulators:start --only functions
```

### 4. Deploy das funções

```powershell
firebase deploy --only functions
```

### 5. Publicar regras do Firestore

As regras versionadas ficam em [firestore.rules](firestore.rules).

```powershell
firebase deploy --only firestore:rules
```

Observação:

- A página pública de resultados atualmente usa consulta direta no Firestore para localizar os casos concluídos.
- Garanta regras compatíveis com esse fluxo, sem expor dados internos sensíveis.

## Modo Direto (Sem Cloud Functions)

Se voce nao quiser usar Cloud Functions, o frontend pode enviar arquivos diretamente para:

- Supabase Storage (Word/PDF)
- Cloudinary (fotos internas)

Configure no navegador (uma vez) e os valores ficam salvos em `localStorage`:

```javascript
window.setStorageProviderConfig({
	supabaseUrl: 'https://SEU-PROJETO.supabase.co',
	supabaseAnonKey: 'SUA_SUPABASE_ANON_KEY',
	supabaseReportsBucket: 'reports',
	cloudinaryCloudName: 'SEU_CLOUD_NAME',
	cloudinaryUploadPreset: 'SEU_UPLOAD_PRESET_UNSIGNED',
	cloudinaryInternalPhotosFolder: 'lpv/internal-photos'
});
```

Observacoes importantes:

- Para upload direto no Supabase via frontend, use chave `anon` e politicas RLS do bucket adequadas.
- Para upload direto no Cloudinary via frontend, use um `upload preset` unsigned.
- Sem backend proprio, a remocao fisica da foto no Cloudinary pode depender de credenciais de servidor; o app sempre remove os metadados no Firestore.

## Segurança

- Não versionar segredos em `README`, `.env` ou código cliente.
- Rotacione imediatamente qualquer credencial que já tenha sido publicada.