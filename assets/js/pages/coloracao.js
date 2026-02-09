/**
 * LPV - MOTOR DE COLORAÇÃO
 * Lógica de Timer, Background e UI.
 */

import { auth, initThemeSystem } from '../core.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { PROTOCOLS_DATA } from '../lib/timers.js'; 

initThemeSystem();

// Verificação de Segurança
onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = "../pages/auth.html";
});

// =========================================
// ESTADO DO SISTEMA
// =========================================
let currentSteps = [];
let currentStepIndex = 0;
let remainingTime = 0;
let endTime = 0; 
let timerInterval = null;
let isPaused = true;
let isAlarmRinging = false; // NOVO: Estado do alarme
let wakeLock = null;

// Configuração de Áudio
const audioAlert = new Audio('../assets/audio/alarm.mp3'); 
audioAlert.volume = 1.0; 

// Elementos UI
const menuView = document.getElementById('menu-view');
const execView = document.getElementById('execution-view');
const progressCircle = document.querySelector('.progress-ring__circle');
const listContainer = document.getElementById('protocol-list');

// Configuração SVG
if (progressCircle) {
    const radius = progressCircle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    progressCircle.style.strokeDashoffset = 0;
}

// =========================================
// INICIALIZAÇÃO
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    renderMenu();

    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    // Expor controles
    window.closeExecution = closeExecution;
    window.toggleTimer = toggleTimer;
    window.nextStep = nextStep;
    window.prevStep = prevStep;
});

function renderMenu() {
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    Object.entries(PROTOCOLS_DATA).forEach(([key, data], index) => {
        const stepCount = data.steps.length;
        const html = `
            <div class="protocol-card" style="--card-index: ${index}" onclick="startProtocol('${key}')">
                <div class="protocol-icon" style="background: ${data.color}">
                    ${key.substring(0,2).toUpperCase()}
                </div>
                <div>
                    <h3 style="margin:0; font-size:1rem; color:var(--text-primary);">${data.name}</h3>
                    <p style="margin:0; font-size:0.8rem; color:var(--text-secondary);">
                        ${stepCount === 1 ? 'Em breve' : stepCount + ' etapas'}
                    </p>
                </div>
                <div class="card-arrow" style="margin-left:auto;"><i class="fas fa-chevron-right"></i></div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', html);
    });
}

// =========================================
// LÓGICA DE CONTROLE
// =========================================

window.startProtocol = (key) => {
    const protocolData = PROTOCOLS_DATA[key];
    currentSteps = protocolData.steps;
    
    document.getElementById('exec-title').textContent = protocolData.name.toUpperCase();
    
    menuView.classList.add('hidden');
    execView.classList.remove('hidden');
    
    requestWakeLock();
    currentStepIndex = 0;
    loadStep(0);
};

function loadStep(index) {
    stopAlarm(); // Garante que o alarme pare ao trocar de passo
    
    const timerCard = document.querySelector('.timer-card');
    const timerWrapper = document.querySelector('.timer-wrapper');
    
    // Step transition animation
    if (timerCard && currentStepIndex !== index) {
        timerCard.classList.remove('step-enter');
        timerCard.classList.add('step-exit');
        setTimeout(() => {
            timerCard.classList.remove('step-exit');
            timerCard.classList.add('step-enter');
            applyStep(index);
        }, 250);
    } else {
        applyStep(index);
    }
    
    // Remove running glow when changing steps
    if (timerWrapper) timerWrapper.classList.remove('running');
}

function applyStep(index) {
    currentStepIndex = index;
    const step = currentSteps[index];
    
    document.getElementById('exec-step-count').textContent = `Passo ${index + 1}/${currentSteps.length}`;
    document.getElementById('step-name').textContent = step.nome;

    document.getElementById('timer-container').classList.add('hidden');
    document.getElementById('manual-container').classList.add('hidden');
    document.getElementById('completion-container').classList.add('hidden');
    document.getElementById('control-bar').classList.remove('hidden');

    const btn = document.getElementById('btn-main-action');

    // PASSO MANUAL
    if (step.tipo === 'manual') {
        document.getElementById('manual-container').classList.remove('hidden');
        document.getElementById('manual-instruction').innerText = step.instrucao;
        
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.className = 'btn-round-large btn-play';
        btn.style.background = 'var(--color-success)';
        
        isPaused = true;
        clearInterval(timerInterval);
    } 
    // PASSO TIMER
    else {
        document.getElementById('timer-container').classList.remove('hidden');
        
        remainingTime = step.tempo;
        updateTimerDisplay();
        
        btn.innerHTML = '<i class="fas fa-play"></i>';
        btn.className = 'btn-round-large btn-play';
        btn.style.background = 'var(--color-primary)';
        
        isPaused = true;
        clearInterval(timerInterval);
        
        if (progressCircle) progressCircle.style.strokeDashoffset = 0;
    }
}

function toggleTimer() {
    const step = currentSteps[currentStepIndex];

    // 1. SE O ALARME ESTIVER TOCANDO (Ação: Parar Som)
    if (isAlarmRinging) {
        stopAlarm();
        return; // Não avança, apenas para o som
    }
    
    // 2. SE FOR MANUAL OU O TEMPO JÁ ACABOU (Ação: Avançar)
    // Se o tempo acabou (remainingTime <= 0) e o alarme já foi parado, o botão serve para ir pro próximo
    if (step.tipo === 'manual' || remainingTime <= 0) {
        nextStep();
        return;
    }

    // 3. PLAY / PAUSE DO TIMER
    const btn = document.getElementById('btn-main-action');

    if (isPaused) {
        // PLAY
        isPaused = false;
        endTime = Date.now() + (remainingTime * 1000);
        
        btn.innerHTML = '<i class="fas fa-pause"></i>';
        btn.style.background = 'var(--color-warning)';
        
        // Add running glow to timer wrapper
        const timerWrapper = document.querySelector('.timer-wrapper');
        if (timerWrapper) timerWrapper.classList.add('running');
        
        timerInterval = setInterval(tick, 1000);
    } else {
        // PAUSE
        isPaused = true;
        clearInterval(timerInterval);
        btn.innerHTML = '<i class="fas fa-play"></i>';
        btn.style.background = 'var(--color-primary)';
        
        // Remove running glow
        const timerWrapper = document.querySelector('.timer-wrapper');
        if (timerWrapper) timerWrapper.classList.remove('running');
    }
}

function tick() {
    const now = Date.now();
    const distance = endTime - now;
    remainingTime = Math.ceil(distance / 1000);

    if (remainingTime > 0) {
        updateTimerDisplay();
        if (progressCircle) {
            const radius = progressCircle.r.baseVal.value;
            const circumference = radius * 2 * Math.PI;
            const totalTime = currentSteps[currentStepIndex].tempo;
            const displayTime = Math.max(0, remainingTime);
            const offset = circumference - (displayTime / totalTime) * circumference;
            progressCircle.style.strokeDashoffset = offset;
            
            // Color change based on remaining time percentage
            const pct = displayTime / totalTime;
            progressCircle.classList.remove('time-warning', 'time-critical');
            if (pct <= 0.1) {
                progressCircle.classList.add('time-critical');
            } else if (pct <= 0.25) {
                progressCircle.classList.add('time-warning');
            }
        }
        
        // Tick animation on digital timer
        const timerText = document.getElementById('timer-text');
        if (timerText) {
            timerText.classList.remove('tick');
            void timerText.offsetWidth; // Force reflow
            timerText.classList.add('tick');
        }
    } else {
        remainingTime = 0;
        updateTimerDisplay();
        clearInterval(timerInterval);
        finishStep();
    }
}

function finishStep() {
    isPaused = true;
    playAlarm(); // Toca som e vibra
    sendNotification("LPV Timer", `Etapa ${currentSteps[currentStepIndex].nome} concluída!`);
    
    // Remove running glow
    const timerWrapper = document.querySelector('.timer-wrapper');
    if (timerWrapper) timerWrapper.classList.remove('running');
    
    // Configura botão para PARAR ALARME (Vermelho com CSS animation)
    const btn = document.getElementById('btn-main-action');
    btn.innerHTML = '<i class="fas fa-bell-slash"></i>';
    btn.style.background = 'var(--color-error)';
    btn.classList.add('alarm-active');
    btn.style.animation = "none"; // Let CSS class handle it
}

function stopAlarm() {
    isAlarmRinging = false;
    
    // Para o som
    audioAlert.pause();
    audioAlert.currentTime = 0;

    // Remove progress ring warning colors
    if (progressCircle) {
        progressCircle.classList.remove('time-warning', 'time-critical');
    }

    // Configura botão para PRÓXIMO (Verde)
    const btn = document.getElementById('btn-main-action');
    btn.innerHTML = '<i class="fas fa-arrow-right"></i>';
    btn.style.background = 'var(--color-success)';
    btn.classList.remove('alarm-active');
    btn.style.animation = "none";
}

// --- NAVEGAÇÃO ---

function nextStep() {
    stopAlarm(); // Garante segurança
    clearInterval(timerInterval);
    if (currentStepIndex < currentSteps.length - 1) {
        loadStep(currentStepIndex + 1);
    } else {
        showCompletion();
    }
}

function prevStep() {
    stopAlarm();
    clearInterval(timerInterval);
    if (currentStepIndex > 0) {
        loadStep(currentStepIndex - 1);
    }
}

function showCompletion() {
    stopAlarm();
    document.getElementById('timer-container').classList.add('hidden');
    document.getElementById('manual-container').classList.add('hidden');
    document.getElementById('completion-container').classList.remove('hidden');
    document.getElementById('control-bar').classList.add('hidden');
    if (wakeLock) wakeLock.release();
}

function closeExecution() {
    stopAlarm();
    clearInterval(timerInterval);
    menuView.classList.remove('hidden');
    execView.classList.add('hidden');
    if (wakeLock) wakeLock.release();
}

// --- UTILITÁRIOS ---

function updateTimerDisplay() {
    const safeTime = Math.max(0, remainingTime);
    const m = Math.floor(safeTime / 60).toString().padStart(2, '0');
    const s = (safeTime % 60).toString().padStart(2, '0');
    document.getElementById('timer-text').textContent = `${m}:${s}`;
}

function playAlarm() {
    isAlarmRinging = true;
    try {
        if(navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
        
        audioAlert.loop = true; // Garante que toca até alguém parar
        audioAlert.play().catch(e => console.log("Interaja com a página para tocar o som."));
    } catch(e) {}
}

function sendNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: '../assets/images/lpvminilogo2.png' });
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { console.log(err); }
}