/**
 * ================================================================
 * LPV - MURAL DE RESULTADOS - LÓGICA
 * Sistema de Consulta de Laudos
 * ================================================================
 */

// Elementos do DOM
const cpfInput = document.getElementById('cpf');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('toggle-password');
const loginForm = document.getElementById('login-form');
const loadingContainer = document.getElementById('loading-container');
const resultContainer = document.getElementById('result-container');
const btnCloseResult = document.getElementById('btn-close-result');
const btnNewSearch = document.getElementById('btn-new-search');
const btnDownload = document.getElementById('btn-download');

// Elementos de erro
const cpfError = document.getElementById('cpf-error');
const passwordError = document.getElementById('password-error');

// Elementos de resultado
const laudoAnimal = document.getElementById('laudo-animal');
const laudoData = document.getElementById('laudo-data');
const laudoTipo = document.getElementById('laudo-tipo');

/**
 * Aplica máscara de CPF no input
 * Formato: 000.000.000-00
 */
function maskCPF(value) {
  // Remove tudo que não é dígito
  value = value.replace(/\D/g, '');
  
  // Aplica a máscara
  if (value.length <= 11) {
    value = value.replace(/(\d{3})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  
  return value;
}

/**
 * Remove máscara do CPF
 * Retorna apenas os números
 */
function removeMask(value) {
  return value.replace(/\D/g, '');
}

/**
 * Valida CPF
 * Retorna true se o CPF é válido
 */
function validateCPF(cpf) {
  cpf = removeMask(cpf);
  
  // Verifica se tem 11 dígitos
  if (cpf.length !== 11) {
    return false;
  }
  
  // Verifica se todos os dígitos são iguais (CPF inválido)
  if (/^(\d)\1{10}$/.test(cpf)) {
    return false;
  }
  
  // Validação do dígito verificador
  let sum = 0;
  let remainder;
  
  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  }
  
  remainder = (sum * 10) % 11;
  
  if (remainder === 10 || remainder === 11) {
    remainder = 0;
  }
  
  if (remainder !== parseInt(cpf.substring(9, 10))) {
    return false;
  }
  
  sum = 0;
  
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  }
  
  remainder = (sum * 10) % 11;
  
  if (remainder === 10 || remainder === 11) {
    remainder = 0;
  }
  
  if (remainder !== parseInt(cpf.substring(10, 11))) {
    return false;
  }
  
  return true;
}

/**
 * Valida senha (primeiros 7 dígitos do CPF)
 */
function validatePassword(cpf, password) {
  const cleanCPF = removeMask(cpf);
  const first7Digits = cleanCPF.substring(0, 7);
  
  return password === first7Digits;
}

/**
 * Mostra mensagem de erro
 */
function showError(element, message) {
  const errorElement = element.nextElementSibling;
  if (errorElement && errorElement.classList.contains('form-error')) {
    errorElement.textContent = message;
    errorElement.classList.add('show');
    element.classList.add('error');
  }
}

/**
 * Limpa mensagem de erro
 */
function clearError(element) {
  const errorElement = element.nextElementSibling;
  if (errorElement && errorElement.classList.contains('form-error')) {
    errorElement.textContent = '';
    errorElement.classList.remove('show');
    element.classList.remove('error');
  }
}

/**
 * Limpa todos os erros
 */
function clearAllErrors() {
  clearError(cpfInput);
  clearError(passwordInput);
}

/**
 * Mostra loading
 */
function showLoading() {
  loginForm.style.display = 'none';
  loadingContainer.classList.add('show');
}

/**
 * Esconde loading
 */
function hideLoading() {
  loadingContainer.classList.remove('show');
  loginForm.style.display = 'flex';
}

/**
 * Mostra resultados
 */
function showResults(data) {
  hideLoading();
  
  // Oculta o formulário de login
  const mainCard = document.querySelector('.glass-card');
  if (mainCard) {
    mainCard.style.display = 'none';
  }
  
  // Preenche os dados do laudo
  laudoAnimal.textContent = data.animal || 'Nome do Animal';
  laudoData.textContent = data.data || '--/--/----';
  laudoTipo.textContent = data.tipo || 'Tipo de Exame';
  
  // Mostra o container de resultados
  resultContainer.classList.add('show');
  
  // Scroll suave para o topo
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Esconde resultados e volta para o formulário
 */
function hideResults() {
  resultContainer.classList.remove('show');
  
  const mainCard = document.querySelector('.glass-card');
  if (mainCard) {
    mainCard.style.display = 'block';
  }
  
  // Limpa os campos
  cpfInput.value = '';
  passwordInput.value = '';
  clearAllErrors();
  
  // Scroll suave para o topo
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Simula busca de laudo no backend
 * NOTA: Esta é uma simulação. Em produção, você deve fazer uma requisição real
 * para o backend para buscar o laudo no banco de dados.
 * 
 * Retorna null se o laudo não for encontrado
 */
async function searchLaudo(cpf) {
  // Simula delay de requisição
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Simula que a maioria dos CPFs não tem laudo
  // Em produção, substituir por uma chamada real à API
  // que retornará null ou erro se o laudo não existir
  
  // Para testes, apenas CPFs que terminam em 0 terão laudo
  if (cpf.endsWith('0')) {
    const mockData = {
      animal: 'Rex',
      data: '15/12/2024',
      tipo: 'Histopatológico',
      pdfUrl: '/assets/protocolos/laudo-exemplo.pdf'
    };
    return mockData;
  }
  
  // Retorna null se não encontrar laudo
  return null;
}

/**
 * Handler do submit do formulário
 */
async function handleSubmit(e) {
  e.preventDefault();
  
  clearAllErrors();
  
  const cpf = cpfInput.value;
  const password = passwordInput.value;
  
  let hasError = false;
  
  // Valida CPF
  if (!cpf) {
    showError(cpfInput, 'Por favor, informe o CPF');
    hasError = true;
  } else if (!validateCPF(cpf)) {
    showError(cpfInput, 'CPF inválido');
    hasError = true;
  }
  
  // Valida Senha
  if (!password) {
    showError(passwordInput, 'Por favor, informe a senha');
    hasError = true;
  } else if (password.length !== 7) {
    showError(passwordInput, 'A senha deve ter 7 dígitos');
    hasError = true;
  } else if (!/^\d+$/.test(password)) {
    showError(passwordInput, 'A senha deve conter apenas números');
    hasError = true;
  }
  
  // Se houver erros, não continua
  if (hasError) {
    return;
  }
  
  // Valida se a senha corresponde aos primeiros 7 dígitos do CPF
  if (!validatePassword(cpf, password)) {
    showError(passwordInput, 'Senha incorreta. Use os 7 primeiros dígitos do CPF');
    return;
  }
  
  // Tudo OK, busca o laudo
  try {
    showLoading();
    
    const cleanCPF = removeMask(cpf);
    const laudoData = await searchLaudo(cleanCPF);
    
    // Verifica se o laudo foi encontrado
    if (laudoData) {
      // Mostra os resultados
      showResults(laudoData);
    } else {
      // Laudo não encontrado
      hideLoading();
      alert('❌ Nenhum laudo encontrado para este CPF.\n\nVerifique o número informado e tente novamente.');
    }
    
  } catch (error) {
    hideLoading();
    alert('Erro ao buscar laudo. Por favor, tente novamente.');
    console.error('Erro:', error);
  }
}

/**
 * Handler do toggle de senha
 */
function togglePasswordVisibility() {
  const type = passwordInput.type === 'password' ? 'text' : 'password';
  passwordInput.type = type;
  
  const icon = togglePasswordBtn.querySelector('i');
  if (type === 'password') {
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  } else {
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  }
}

/**
 * Handler do botão de download
 */
function handleDownload() {
  // Em produção, aqui você deve fazer o download do PDF real
  alert('Download do laudo em PDF será iniciado.\n\n(Em produção, isso baixará o PDF do servidor)');
  
  // Exemplo de como seria em produção:
  // window.open('/api/laudos/download?cpf=' + removeMask(cpfInput.value), '_blank');
}

/**
 * Inicialização
 */
document.addEventListener('DOMContentLoaded', () => {
  // Máscara de CPF
  cpfInput.addEventListener('input', (e) => {
    e.target.value = maskCPF(e.target.value);
    clearError(cpfInput);
  });
  
  // Limpa erro ao digitar na senha
  passwordInput.addEventListener('input', () => {
    clearError(passwordInput);
  });
  
  // Só permite números na senha
  passwordInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  
  // Toggle de visibilidade da senha
  togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
  
  // Submit do formulário
  loginForm.addEventListener('submit', handleSubmit);
  
  // Botão de fechar resultados
  btnCloseResult.addEventListener('click', hideResults);
  
  // Botão de nova busca
  btnNewSearch.addEventListener('click', hideResults);
  
  // Botão de download
  btnDownload.addEventListener('click', handleDownload);
  
  // Pressionar Enter no CPF vai para a senha
  cpfInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      passwordInput.focus();
    }
  });
  
  console.log('Sistema de Consulta de Laudos inicializado');
});

/**
 * NOTAS PARA PRODUÇÃO:
 * 
 * 1. Integração com Backend:
 *    - Substituir a função searchLaudo() por uma chamada real à API
 *    - Usar fetch() ou axios para fazer requisições HTTP
 *    - Exemplo: fetch('/api/laudos/buscar', { method: 'POST', body: JSON.stringify({ cpf, senha }) })
 * 
 * 2. Segurança:
 *    - Nunca enviar senhas em texto puro
 *    - Usar HTTPS para todas as requisições
 *    - Implementar rate limiting no backend
 *    - Validar no backend também (nunca confiar apenas no frontend)
 * 
 * 3. Download de PDF:
 *    - Implementar endpoint no backend para servir PDFs
 *    - Usar autenticação/token para proteger o download
 *    - Registrar logs de acesso aos laudos
 * 
 * 4. Melhorias:
 *    - Adicionar tratamento de erros mais específico (laudo não encontrado, erro de servidor, etc)
 *    - Implementar cache para melhorar performance
 *    - Adicionar analytics para monitorar uso
 */
