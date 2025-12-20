/**
 * EXEMPLO DE INTEGRAÇÃO COM FIREBASE
 * Este arquivo mostra como integrar o módulo de autenticação com Firebase
 * 
 * INSTRUÇÕES:
 * 1. Instale o Firebase CLI: npm install -g firebase-tools
 * 2. Copie as credenciais do seu projeto Firebase do Firebase Console
 * 3. Descomente o código abaixo e adapte conforme necessário
 * 4. Remova este arquivo após implementar a integração
 */

// ================================================================
// CONFIGURAÇÃO DO FIREBASE (DESCOMENTE E CONFIGURE)
// ================================================================


import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

// Suas credenciais do Firebase Console
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "your-messaging-sender-id",
  appId: "your-app-id",
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ================================================================
// INTEGRAÇÃO COM AUTHMANAGER
// ================================================================

// Modificar a classe AuthManager para usar Firebase
// Localizar as funções abaixo e integrar com auth.js

class FirebaseAuthManager extends AuthManager {
  constructor() {
    super();
    this.auth = auth;
  }

  /**
   * Sobrescrever handleLoginAttempt para usar Firebase
   */
  async handleLoginAttempt(email, password, remember) {
    const submitButton = this.loginForm.querySelector(".btn-primary");
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Entrando...";

    try {
      // Fazer login com Firebase
      const credential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = credential.user;

      // Salvar opção "Manter conectado" (opcional)
      if (remember) {
        localStorage.setItem("rememberUser", email);
      }

      // Mostrar sucesso
      this.showAlert("login-alert", "Login bem-sucedido! Redirecionando...", "success");

      // Redirecionar após sucesso
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);

    } catch (error) {
      // Tratar erros
      let errorMessage = "Erro ao fazer login";

      switch (error.code) {
        case "auth/user-not-found":
          errorMessage = "Usuário não encontrado";
          break;
        case "auth/wrong-password":
          errorMessage = "Senha incorreta";
          break;
        case "auth/invalid-email":
          errorMessage = "Email inválido";
          break;
        case "auth/user-disabled":
          errorMessage = "Usuário desativado";
          break;
        default:
          errorMessage = error.message;
      }

      this.showAlert("login-alert", errorMessage, "error");
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }

  /**
   * Sobrescrever handleRegisterAttempt para usar Firebase
   */
  async handleRegisterAttempt(name, email, password) {
    const submitButton = this.registerForm.querySelector(".btn-primary");
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Criando conta...";

    try {
      // Criar usuário no Firebase
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);
      const user = credential.user;

      // Atualizar perfil com nome
      await updateProfile(user, {
        displayName: name,
      });

      // Mostrar sucesso
      this.showAlert(
        "register-alert",
        "Conta criada com sucesso! Faça login para continuar.",
        "success"
      );

      // Resetar formulário
      this.registerForm.reset();

      // Trocar para login
      setTimeout(() => {
        this.switchTab("login");
      }, 1500);

    } catch (error) {
      // Tratar erros
      let errorMessage = "Erro ao criar conta";

      switch (error.code) {
        case "auth/email-already-in-use":
          errorMessage = "Este email já está registrado";
          break;
        case "auth/weak-password":
          errorMessage = "Senha muito fraca";
          break;
        case "auth/invalid-email":
          errorMessage = "Email inválido";
          break;
        default:
          errorMessage = error.message;
      }

      this.showAlert("register-alert", errorMessage, "error");
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }

  /**
   * Sobrescrever handleForgotPassword para usar Firebase
   */
  async handleForgotPassword(e) {
    e.preventDefault();

    const email = prompt("Digite seu email:");
    if (!email) return;

    try {
      await sendPasswordResetEmail(this.auth, email);
      alert("Email de recuperação enviado! Verifique sua caixa de entrada.");
    } catch (error) {
      let errorMessage = "Erro ao enviar email";

      switch (error.code) {
        case "auth/user-not-found":
          errorMessage = "Usuário não encontrado";
          break;
        case "auth/invalid-email":
          errorMessage = "Email inválido";
          break;
        default:
          errorMessage = error.message;
      }

      alert(errorMessage);
    }
  }
}

// ================================================================
// MONITORAR ESTADO DE AUTENTICAÇÃO
// ================================================================

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

// Monitorar mudanças no estado de autenticação
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Usuário está logado
    console.log("Usuário logado:", user.displayName, user.email);
    // Redirecionar para página principal
    // window.location.href = "/";
  } else {
    // Usuário não está logado
    console.log("Usuário não está logado");
    // Manter na página de autenticação
  }
});

// ================================================================
// EXPORTAR PARA USO
// ================================================================

export { FirebaseAuthManager, auth };



// ================================================================
// INSTRUÇÕES DE CONFIGURAÇÃO PASSO A PASSO
// ================================================================

/*

## PASSO 1: Configurar Firebase Console

1. Ir para https://console.firebase.google.com
2. Criar um novo projeto
3. Clicar em "Autenticação" no menu esquerdo
4. Clicar em "Começar"
5. Habilitar "Email/Senha"
6. Copiar as credenciais (Project Settings -> Web)

## PASSO 2: Preparar o Projeto

1. Criar um arquivo `firebase-auth.js` na pasta `assets/js/`
2. Copiar o código acima para esse arquivo
3. Descomentar o código e preencher as credenciais
4. Remover este arquivo (firebase-integration-example.js)

## PASSO 3: Atualizar auth.html

Adicionar um script que carregue o firebase-auth.js:

```html
<script type="module">
  import { FirebaseAuthManager } from "/assets/js/firebase-auth.js";
  
  document.addEventListener("DOMContentLoaded", () => {
    new FirebaseAuthManager();
  });
</script>
```

## PASSO 4: Testar a Integração

1. Abrir a página em http://localhost:8000/pages/auth.html
2. Criar uma nova conta
3. Fazer login
4. Verificar no Firebase Console se o usuário foi criado

## PASSO 5: Deploy

1. Configurar o Firebase Hosting (opcional)
2. Usar `firebase deploy` para publicar
3. O app estará disponível em https://seu-projeto.web.app

## Variáveis de Ambiente

Para maior segurança, use variáveis de ambiente:

.env:
```
VITE_FIREBASE_API_KEY=sua_chave_aqui
VITE_FIREBASE_AUTH_DOMAIN=seu_dominio_aqui
VITE_FIREBASE_PROJECT_ID=seu_id_aqui
```

Acessar em JavaScript:
```javascript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  // ...
};
```

## Tratamento de Erros do Firebase

Códigos de erro comuns:
- `auth/user-not-found`: Email não registrado
- `auth/wrong-password`: Senha incorreta
- `auth/email-already-in-use`: Email já registrado
- `auth/weak-password`: Senha muito fraca
- `auth/invalid-email`: Email inválido

## Segurança

Nunca comita credenciais do Firebase! Use:
1. Variáveis de ambiente
2. Firebase Local Emulator Suite para desenvolvimento
3. Regras de segurança do Firebase Firestore/Storage

## Referências

- https://firebase.google.com/docs/auth
- https://firebase.google.com/docs/auth/web/start
- https://firebase.google.com/docs/reference/js/auth

*/
