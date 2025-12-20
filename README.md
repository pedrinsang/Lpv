## Autenticação com Firebase

- Configuração: edite [assets/js/firebase-config.js](assets/js/firebase-config.js) com as credenciais do seu projeto Firebase.
- Providers: ative "Email/Password" em Authentication.
- Database: crie um Firestore no modo de produção e permita leitura/escrita adequada (regras típicas por usuário). Este app grava documentos em `users/{uid}`.
- Páginas: use [pages/auth.html](pages/auth.html) para login/cadastro. A home protegida é [index.html](index.html).

### Passos
- Crie um projeto em https://console.firebase.google.com.
- Em "Project settings" copie o objeto de configuração Web e substitua os campos em [assets/js/firebase-config.js](assets/js/firebase-config.js).
- Em Authentication → Sign-in method, habilite Email/Password.
- Em Firestore Database, crie o banco. Regras exemplo:

```
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}
	}
}
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