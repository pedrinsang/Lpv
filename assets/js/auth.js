/**
 * PATOLOGIA VETERINÁRIA - AUTH.JS
 * Gerenciador de Autenticação com Interatividade
 * Responsável por: Troca de abas, validação de formulários, efeitos visuais
 */

// ================================================================
// CONFIGURAÇÃO E CONSTANTES
// ================================================================

const CONFIG = {
  FORM_SECTIONS: {
    LOGIN: "login",
    REGISTER: "register",
  },
  SELECTORS: {
    TAB_BUTTONS: ".tab-button",
    TAB_SWITCH_BUTTONS: ".tab-switch",
    FORM_SECTIONS: ".form-section",
    FORM_CONTENT: ".form-content",
    LOGIN_FORM: "#login-form",
    REGISTER_FORM: "#register-form",
    LOGIN_CONTENT: "#login-content",
    REGISTER_CONTENT: "#register-content",
    FORM_INPUTS: ".form-input",
    CHECKBOX_INPUT: ".checkbox-input",
    FORM_GROUPS: ".form-group",
    ALERT_MESSAGE: ".alert-message",
    FORGOT_LINK: ".forgot-link",
    TERMS_LINK: ".terms-link",
  },
  VALIDATION: {
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PASSWORD_MIN_LENGTH: 6,
    NAME_MIN_LENGTH: 3,
  },
  CLASSES: {
    ACTIVE: "active",
    ERROR: "error",
    SUCCESS: "success",
  },
  ANIMATION_DURATION: 350,
};

// ================================================================
// GERENCIADOR DE AUTENTICAÇÃO
// ================================================================

class AuthManager {
  constructor() {
    this.currentTab = CONFIG.FORM_SECTIONS.LOGIN;
    this.init();
  }

  /**
   * Inicializa o gerenciador de autenticação
   */
  init() {
    this.cacheElements();
    this.attachEventListeners();
    this.setupFormInteractions();
    this.adjustFormHeight();
    this.logInit();
  }

  /**
   * Cache de elementos do DOM para melhor performance
   */
  cacheElements() {
    this.tabButtons = document.querySelectorAll(CONFIG.SELECTORS.TAB_BUTTONS);
    this.tabSwitchButtons = document.querySelectorAll(CONFIG.SELECTORS.TAB_SWITCH_BUTTONS);
    this.formSections = document.querySelectorAll(CONFIG.SELECTORS.FORM_SECTIONS);
    this.loginForm = document.querySelector(CONFIG.SELECTORS.LOGIN_FORM);
    this.registerForm = document.querySelector(CONFIG.SELECTORS.REGISTER_FORM);
    this.formContent = document.querySelector(CONFIG.SELECTORS.FORM_CONTENT);
    this.loginContent = document.querySelector(CONFIG.SELECTORS.LOGIN_CONTENT);
    this.registerContent = document.querySelector(CONFIG.SELECTORS.REGISTER_CONTENT);
    this.allInputs = document.querySelectorAll(CONFIG.SELECTORS.FORM_INPUTS);
    this.forgotLink = document.querySelector(CONFIG.SELECTORS.FORGOT_LINK);
    this.termsLinks = document.querySelectorAll(CONFIG.SELECTORS.TERMS_LINK);
  }

  /**
   * Anexa os event listeners aos elementos
   */
  attachEventListeners() {
    // Tab buttons
    this.tabButtons.forEach((button) => {
      button.addEventListener("click", (e) => this.handleTabClick(e));
    });

    // Tab switch buttons (within forms)
    this.tabSwitchButtons.forEach((button) => {
      button.addEventListener("click", (e) => this.handleTabSwitch(e));
    });

    // Form submissions
    this.loginForm.addEventListener("submit", (e) => this.handleLoginSubmit(e));
    this.registerForm.addEventListener("submit", (e) => this.handleRegisterSubmit(e));

    // Form inputs - floating label functionality
    this.allInputs.forEach((input) => {
      input.addEventListener("focus", (e) => this.handleInputFocus(e));
      input.addEventListener("blur", (e) => this.handleInputBlur(e));
      input.addEventListener("change", (e) => this.validateField(e.target));
    });

    // Links
    if (this.forgotLink) {
      this.forgotLink.addEventListener("click", (e) => this.handleForgotPassword(e));
    }

    this.termsLinks.forEach((link) => {
      link.addEventListener("click", (e) => this.handleTermsLink(e));
    });
  }

  /**
   * Configura interações adicionais do formulário
   */
  setupFormInteractions() {
    // Adiciona focus visual nos inputs
    this.allInputs.forEach((input) => {
      input.addEventListener("input", (e) => {
        this.updateInputState(e.target);
      });
    });

    // Tecla Enter para submeter
    this.loginForm.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.loginForm.dispatchEvent(new Event("submit"));
      }
    });

    this.registerForm.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.registerForm.dispatchEvent(new Event("submit"));
      }
    });
  }

  /**
   * Manipula o clique nas abas principais
   * @param {Event} event
   */
  handleTabClick(e) {
    e.preventDefault();
    const tab = e.target.getAttribute("data-tab");
    this.switchTab(tab);
  }

  /**
   * Manipula o clique nos botões de troca dentro dos formulários
   * @param {Event} event
   */
  handleTabSwitch(e) {
    e.preventDefault();
    const tab = e.target.getAttribute("data-tab");
    this.switchTab(tab);
  }

  /**
   * Troca a aba ativa com animação
   * @param {string} tabName
   */
  switchTab(tabName) {
    // Validação
    if (!Object.values(CONFIG.FORM_SECTIONS).includes(tabName)) {
      console.warn(`Tab inválida: ${tabName}`);
      return;
    }

    // Não fazer nada se a aba já está ativa
    if (this.currentTab === tabName) {
      return;
    }

    // Atualizar estado das abas
    this.updateTabButtons(tabName);
    this.updateFormSections(tabName);
    this.currentTab = tabName;

    // Analytics (se disponível)
    if (window.gtag) {
      window.gtag("event", "auth_tab_switched", {
        tab: tabName,
      });
    }
  }

  /**
   * Atualiza o estado visual dos botões de aba
   * @param {string} tabName
   */
  updateTabButtons(tabName) {
    this.tabButtons.forEach((button) => {
      const isActive = button.getAttribute("data-tab") === tabName;
      button.classList.toggle(CONFIG.CLASSES.ACTIVE, isActive);
      button.setAttribute("aria-selected", isActive);
    });
  }

  /**
   * Atualiza o estado visual das seções de formulário
   * @param {string} tabName
   */
  updateFormSections(tabName) {
    this.formSections.forEach((section) => {
      const isActive = section.id === `${tabName}-content`;
      section.classList.toggle(CONFIG.CLASSES.ACTIVE, isActive);
    });

    // Ajusta a altura do container para a seção ativa
    this.adjustFormHeight();
  }

  /**
   * Ajusta dinamicamente a altura do container das seções
   */
  adjustFormHeight() {
    if (!this.formContent) return;
    // Em telas móveis, deixe a altura automática para evitar jumps
    if (window.innerWidth <= 768) {
      this.formContent.style.height = "auto";
      return;
    }
    const activeSection = document.querySelector(".form-section.active");
    if (!activeSection) return;

    // Mede a altura real do conteúdo ativo
    const targetHeight = activeSection.scrollHeight;
    // Aplica com transição suave
    this.formContent.style.height = `${targetHeight}px`;
  }

  /**
   * Manipula o foco nos inputs
   * @param {Event} event
   */
  handleInputFocus(e) {
    const input = e.target;
    const wrapper = input.closest(CONFIG.SELECTORS.FORM_SECTIONS);

    if (wrapper) {
      input.parentElement.classList.add("focused");
    }
  }

  /**
   * Manipula a perda de foco nos inputs
   * @param {Event} event
   */
  handleInputBlur(e) {
    const input = e.target;
    input.parentElement.classList.remove("focused");
  }

  /**
   * Atualiza o estado visual do input
   * @param {HTMLInputElement} input
   */
  updateInputState(input) {
    const wrapper = input.parentElement;
    const hasValue = input.value.trim() !== "";

    if (hasValue) {
      wrapper.classList.add("has-value");
    } else {
      wrapper.classList.remove("has-value");
    }
  }

  /**
   * Valida um campo individual
   * @param {HTMLInputElement} input
   * @returns {boolean}
   */
  validateField(input) {
    const type = input.type;
    const value = input.value.trim();
    const errorElement = document.getElementById(`${input.id}-error`);

    let isValid = true;
    let errorMessage = "";

    // Validação requerida
    if (input.required && value === "") {
      isValid = false;
      errorMessage = "Este campo é obrigatório";
    }

    // Validações específicas por tipo
    if (isValid && value) {
      if (type === "email") {
        isValid = CONFIG.VALIDATION.EMAIL_REGEX.test(value);
        if (!isValid) {
          errorMessage = "Email inválido";
        }
      }

      if (input.id.includes("password")) {
        if (value.length < CONFIG.VALIDATION.PASSWORD_MIN_LENGTH) {
          isValid = false;
          errorMessage = `Mínimo ${CONFIG.VALIDATION.PASSWORD_MIN_LENGTH} caracteres`;
        }
      }

      if (input.id.includes("name")) {
        if (value.length < CONFIG.VALIDATION.NAME_MIN_LENGTH) {
          isValid = false;
          errorMessage = `Mínimo ${CONFIG.VALIDATION.NAME_MIN_LENGTH} caracteres`;
        }
      }

      // Validação de confirmação de senha
      if (input.id === "register-confirm-password") {
        const passwordInput = document.getElementById("register-password");
        if (value !== passwordInput.value) {
          isValid = false;
          errorMessage = "As senhas não correspondem";
        }
      }
    }

    // Atualizar UI
    this.updateFieldErrorState(input, errorElement, isValid, errorMessage);

    return isValid;
  }

  /**
   * Atualiza o estado de erro visual de um campo
   * @param {HTMLInputElement} input
   * @param {HTMLElement} errorElement
   * @param {boolean} isValid
   * @param {string} errorMessage
   */
  updateFieldErrorState(input, errorElement, isValid, errorMessage) {
    if (!isValid) {
      input.classList.add(CONFIG.CLASSES.ERROR);
      if (errorElement) {
        errorElement.textContent = errorMessage;
      }
    } else {
      input.classList.remove(CONFIG.CLASSES.ERROR);
      if (errorElement) {
        errorElement.textContent = "";
      }
    }
  }

  /**
   * Valida o formulário de login
   * @returns {boolean}
   */
  validateLoginForm() {
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");

    const emailValid = this.validateField(emailInput);
    const passwordValid = this.validateField(passwordInput);

    return emailValid && passwordValid;
  }

  /**
   * Valida o formulário de registro
   * @returns {boolean}
   */
  validateRegisterForm() {
    const nameInput = document.getElementById("register-name");
    const emailInput = document.getElementById("register-email");
    const passwordInput = document.getElementById("register-password");
    const confirmPasswordInput = document.getElementById("register-confirm-password");
    const termsCheckbox = document.getElementById("register-terms");

    const nameValid = this.validateField(nameInput);
    const emailValid = this.validateField(emailInput);
    const passwordValid = this.validateField(passwordInput);
    const confirmPasswordValid = this.validateField(confirmPasswordInput);

    let termsValid = termsCheckbox.checked;
    const termsError = document.getElementById("register-terms-error");

    if (!termsValid) {
      termsError.textContent = "Você deve concordar com os termos";
    } else {
      termsError.textContent = "";
    }

    return nameValid && emailValid && passwordValid && confirmPasswordValid && termsValid;
  }

  /**
   * Manipula o envio do formulário de login
   * @param {Event} event
   */
  async handleLoginSubmit(e) {
    e.preventDefault();

    // Validar
    if (!this.validateLoginForm()) {
      this.showAlert("login-alert", "Por favor, corrija os erros acima", "error");
      return;
    }

    // Obter dados
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const remember = document.getElementById("login-remember").checked;

    // Simular requisição ao Firebase (será implementado depois)
    this.handleLoginAttempt(email, password, remember);
  }

  /**
   * Manipula o envio do formulário de registro
   * @param {Event} event
   */
  async handleRegisterSubmit(e) {
    e.preventDefault();

    // Validar
    if (!this.validateRegisterForm()) {
      this.showAlert("register-alert", "Por favor, corrija os erros acima", "error");
      return;
    }

    // Obter dados
    const name = document.getElementById("register-name").value;
    const email = document.getElementById("register-email").value;
    const password = document.getElementById("register-password").value;

    // Simular requisição ao Firebase (será implementado depois)
    this.handleRegisterAttempt(name, email, password);
  }

  /**
   * Processa a tentativa de login
   * @param {string} email
   * @param {string} password
   * @param {boolean} remember
   */
  handleLoginAttempt(email, password, remember) {
    // Desabilitar botão
    const submitButton = this.loginForm.querySelector(".btn-primary");
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Entrando...";

    // Simular delay de rede (será substituído por Firebase)
    setTimeout(() => {
      // Aqui será integrado com Firebase
      console.log("Login attempt:", { email, password, remember });

      // Simulação de sucesso
      this.showAlert("login-alert", "Login bem-sucedido! Redirecionando...", "success");

      // Restaurar botão
      submitButton.disabled = false;
      submitButton.textContent = originalText;

      // Redirecionar após sucesso (será removido quando integrar Firebase)
      setTimeout(() => {
        // window.location.href = '/';
      }, 1500);
    }, 800);
  }

  /**
   * Processa a tentativa de registro
   * @param {string} name
   * @param {string} email
   * @param {string} password
   */
  handleRegisterAttempt(name, email, password) {
    // Desabilitar botão
    const submitButton = this.registerForm.querySelector(".btn-primary");
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Criando conta...";

    // Simular delay de rede (será substituído por Firebase)
    setTimeout(() => {
      // Aqui será integrado com Firebase
      console.log("Register attempt:", { name, email, password });

      // Simulação de sucesso
      this.showAlert(
        "register-alert",
        "Conta criada com sucesso! Faça login para continuar.",
        "success"
      );

      // Restaurar botão
      submitButton.disabled = false;
      submitButton.textContent = originalText;

      // Resetar formulário
      this.registerForm.reset();

      // Trocar para login após sucesso
      setTimeout(() => {
        this.switchTab(CONFIG.FORM_SECTIONS.LOGIN);
      }, 1500);
    }, 800);
  }

  /**
   * Mostra uma mensagem de alerta
   * @param {string} alertId
   * @param {string} message
   * @param {string} type - 'success' ou 'error'
   */
  showAlert(alertId, message, type = "error") {
    const alertElement = document.getElementById(alertId);

    if (!alertElement) {
      console.warn(`Alert element not found: ${alertId}`);
      return;
    }

    // Atualizar conteúdo e classe
    alertElement.textContent = message;
    alertElement.className = `alert-message ${type}`;
    alertElement.removeAttribute("hidden");

    // Auto-hide após 5 segundos
    setTimeout(() => {
      alertElement.setAttribute("hidden", "");
    }, 5000);
  }

  /**
   * Manipula o clique em "Esqueci minha senha"
   * @param {Event} event
   */
  handleForgotPassword(e) {
    e.preventDefault();
    console.log("Forgot password link clicked");

    // Implementar modal de reset de senha
    alert("Funcionalidade de reset de senha será implementada em breve.");
  }

  /**
   * Manipula os links de termos
   * @param {Event} event
   */
  handleTermsLink(e) {
    const href = e.target.getAttribute("href");
    console.log("Terms link clicked:", href);
    // Deixa o link navegar normalmente
  }

  /**
   * Log de inicialização
   */
  logInit() {
    console.log(
      "%c✓ AuthManager Inicializado",
      "color: #0d47a1; font-weight: bold; font-size: 12px;"
    );
    console.log("Abas disponíveis:", Object.values(CONFIG.FORM_SECTIONS));
  }
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener("DOMContentLoaded", () => {
  new AuthManager();
});

// Exportar para uso em módulos (se necessário)
export default AuthManager;
