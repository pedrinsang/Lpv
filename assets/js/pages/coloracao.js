/**
 * LPV - ASSISTENTE DE COLORAÇÃO
 */

import { auth, onAuthStateChanged } from '../core.js';

// Verifica Login (Segurança)
onAuthStateChanged(auth, (user) => {
    if (!user) {
        // Opcional: Redirecionar se tentar acessar direto sem login
        // window.location.href = "auth.html";
    }
});

// =========================================
// DADOS DOS PROTOCOLOS
// =========================================

// Placeholder para protocolos ainda não cadastrados
const EM_BREVE = [
    { 
        nome: 'Em Desenvolvimento', 
        tipo: 'manual', 
        instrucao: 'Os passos detalhados para esta coloração serão adicionados em breve.' 
    }
];

// Protocolo HE (Exemplo Completo)
const HE_STEPS = [
    { nome: 'Desparafinização', tipo: 'timer', tempo: 40, unidade: 'min' },
    { nome: 'Xilol Frio 1', tipo: 'timer', tempo: 20, unidade: 'min' },
    { nome: 'Xilol Frio 2', tipo: 'timer', tempo: 5, unidade: 'min' },
    { nome: 'Álcool Absoluto 1', tipo: 'timer', tempo: 1, unidade: 'min' },
    { nome: 'Álcool Absoluto 2', tipo: 'timer', tempo: 30, unidade: 'seg' },
    { nome: 'Álcool 96º', tipo: 'timer', tempo: 30, unidade: 'seg' },
    { nome: 'Álcool 70º', tipo: 'timer', tempo: 1, unidade: 'min' },
    { nome: 'Água Corrente', tipo: 'timer', tempo: 1, unidade: 'min' },
    { nome: 'Hematoxilina', tipo: 'timer', tempo: 90, unidade: 'seg' },
    { nome: 'Água Corrente', tipo: 'timer', tempo: 6, unidade: 'min' },
    { nome: 'Aviso Importante', tipo: 'manual', instrucao: 'Esgotar bem a água.\n(Bater o carrinho sobre papel toalha)' },
    { nome: 'Eosina', tipo: 'timer', tempo: 90, unidade: 'seg' },
    { nome: 'Lavagem Final', tipo: 'manual', instrucao: 'Álcool Absoluto: 3 séries de 10 mergulhos.' },
    { nome: 'Clarificação', tipo: 'timer', tempo: 2, unidade: 'min' },
    { nome: 'Finalização', tipo: 'manual', instrucao: 'Aplicar Xilol de Montagem e cobrir com lamínula.' }
];

// MAPA DE PROTOCOLOS
// Mapeia o atributo 'data-protocol' do HTML para a lista de passos
const PROTOCOLS = {
    'he': HE_STEPS,
    'toluidina': EM_BREVE,
    'grocott': EM_BREVE,
    'pas': EM_BREVE,
    'fontana': EM_BREVE,
    'perls': EM_BREVE,
    'tricromico': EM_BREVE,
    'ziehl': EM_BREVE,
    'gram': EM_BREVE,
    'alciano': EM_BREVE
};

// =========================================
// ESTADO E UI
// =========================================
let currentSteps = [];
let currentStepIndex = 0;
let remainingTime = 0;
let totalTime = 0;
let timerInterval = null;
let isPaused = false;

// Elementos DOM
const menuState = document.getElementById('menu-state');
const executionState = document.getElementById('execution-state');
const progressCircle = document.querySelector('.progress-ring__circle');

// =========================================
// FUNÇÕES DE FLUXO
// =========================================

function startProtocol(key) {
    currentSteps = PROTOCOLS[key] || EM_BREVE;
    document.getElementById('protocol-name-display').textContent = key.toUpperCase();
    
    // Troca de Tela
    menuState.classList.add('hidden');
    executionState.classList.remove('hidden');
    
    // Inicializa SVG (Círculo Cheio)
    const radius = progressCircle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    progressCircle.style.strokeDashoffset = 0;
    
    currentStepIndex = 0;
    loadStep(0);
}

function loadStep(index) {
    if (index >= currentSteps.length) {
        showCompletion();
        return;
    }

    const step = currentSteps[index];
    document.getElementById('step-counter').textContent = `${index + 1}/${currentSteps.length}`;

    // Reset visual
    document.getElementById('timed-step').classList.add('hidden');
    document.getElementById('manual-step').classList.add('hidden');
    document.getElementById('completion-state').classList.add('hidden');

    if (step.tipo === 'timer') {
        setupTimer(step);
    } else {
        setupManual(step);
    }
}

function setupTimer(step) {
    document.getElementById('timed-step').classList.remove('hidden');
    document.getElementById('step-title').textContent = step.nome;
    
    remainingTime = step.unidade === 'min' ? step.tempo * 60 : step.tempo;
    totalTime = remainingTime;
    
    updateTimerDisplay();
    // Reseta círculo visualmente para cheio
    progressCircle.style.strokeDashoffset = 0; 
    
    isPaused = true;
    togglePause(); // Inicia automaticamente
}

function setupManual(step) {
    document.getElementById('manual-step').classList.remove('hidden');
    document.getElementById('manual-title').textContent = step.nome;
    document.getElementById('manual-instruction').textContent = step.instrucao;
    clearInterval(timerInterval);
}

function showCompletion() {
    document.getElementById('completion-state').classList.remove('hidden');
    clearInterval(timerInterval);
}

// =========================================
// TIMER ENGINE
// =========================================

function togglePause() {
    const btn = document.getElementById('btn-pause');
    const icon = btn.querySelector('i');
    
    if (isPaused) {
        isPaused = false;
        icon.className = 'fas fa-pause';
        timerInterval = setInterval(tick, 1000);
    } else {
        isPaused = true;
        icon.className = 'fas fa-play';
        clearInterval(timerInterval);
    }
}

function tick() {
    if (remainingTime > 0) {
        remainingTime--;
        updateTimerDisplay();
        
        // Atualiza SVG
        const radius = progressCircle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        // Calcula quanto "falta" para esvaziar
        const offset = circumference - (remainingTime / totalTime) * circumference;
        progressCircle.style.strokeDashoffset = offset;
    } else {
        clearInterval(timerInterval);
        playAlarm();
    }
}

function updateTimerDisplay() {
    const m = Math.floor(remainingTime / 60);
    const s = remainingTime % 60;
    document.getElementById('timer-minutes').textContent = String(m).padStart(2, '0');
    document.getElementById('timer-seconds').textContent = String(s).padStart(2, '0');
}

function playAlarm() {
    // Tenta tocar um som simples
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // Configuração do som (Beep)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch(e) { 
        console.log('Alarme visual ativado (som bloqueado pelo navegador)'); 
    }
}

function returnToMenu() {
    clearInterval(timerInterval);
    executionState.classList.add('hidden');
    menuState.classList.remove('hidden');
}

// =========================================
// EVENTOS DE INICIALIZAÇÃO
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    // Evento nos cards
    document.querySelectorAll('.protocol-card').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.dataset.protocol;
            if (PROTOCOLS[key]) {
                startProtocol(key);
            } else {
                alert('Protocolo não reconhecido.');
            }
        });
    });

    // Botões de controle
    document.getElementById('btn-back-menu').addEventListener('click', returnToMenu);
    document.getElementById('btn-finish').addEventListener('click', returnToMenu);
    document.getElementById('btn-pause').addEventListener('click', togglePause);
    
    document.getElementById('btn-next').addEventListener('click', () => {
        clearInterval(timerInterval);
        loadStep(currentStepIndex + 1);
        currentStepIndex++;
    });
    
    document.getElementById('btn-manual-next').addEventListener('click', () => {
        loadStep(currentStepIndex + 1);
        currentStepIndex++;
    });
});