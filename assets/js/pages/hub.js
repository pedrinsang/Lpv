import { auth, db } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, collection, query, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 1. MAPEAMENTO DOS ELEMENTOS
const els = {
    userBadge: document.getElementById('user-role-badge'),
    adminCard: document.getElementById('admin-card'),
    queueContainer: document.getElementById('queue-list-container'),
    queueFilterContainer: document.getElementById('queue-filter-container'),
    queueFilterAll: document.getElementById('queue-filter-all'),
    queueFilterMine: document.getElementById('queue-filter-mine'),
    
    // Totalizadores (Casos Ativos)
    cNecropsias: document.getElementById('count-necropsias'),
    cBiopsias: document.getElementById('count-biopsias'),
    
    // Etapas da Esteira
    cClivagem: document.getElementById('count-clivagem'),
    cProcessamento: document.getElementById('count-processamento'),
    cEmblocamento: document.getElementById('count-emblocamento'),
    cCorte: document.getElementById('count-corte'),
    cColoracao: document.getElementById('count-coloracao'),
    cAnalise: document.getElementById('count-analise'),
    cLiberar: document.getElementById('count-liberar')
};

let currentUserData = null;
let unsubscribeTasks = null;
let queueSourceTasks = [];
let queueFilterMode = 'all';

// 2. INICIALIZAÇÃO
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadUserProfile(user.uid);
        if (currentUserData) initRealTimeDashboard();
    } else {
        window.location.href = '../pages/auth.html';
    }
});

document.getElementById('logout-btn')?.addEventListener('click', () => signOut(auth));

// 3. CARREGAR PERFIL
async function loadUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            updateUserBadge(currentUserData.role);
            setupQueueFilters();

        }
    } catch (e) { console.error(e); }
}

function updateUserBadge(role) {
    if(!els.userBadge) return;
    const display = role.charAt(0).toUpperCase() + role.slice(1).replace('-', ' ');
    els.userBadge.textContent = display;
}

// Renderiza botão do Planner dinamicamente
function checkAndRenderAdminButtons() {
    // Evita duplicatas
    if(document.getElementById('btn-planner-menu')) return;

    // Busca a grid principal (Hub Grid)
    const grid = document.querySelector('.hub-grid');
    
    if(grid) {
        const btn = document.createElement('div');
        // Usa as classes nativas do seu CSS (tool-card)
        btn.className = 'tool-card'; 
        btn.id = 'btn-planner-menu';
        btn.style.cursor = 'pointer';
        btn.style.borderLeft = '4px solid #f97316'; // Laranja para destaque
        btn.onclick = () => window.location.href = '../pages/planner.html';
        
        btn.innerHTML = `
            <div class="tool-icon" style="background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);">
                <i class="fas fa-calendar-alt"></i>
            </div>
            <div style="display:flex; flex-direction:column; gap:2px;">
                <span style="font-weight:700; font-size:1rem;">Planner</span>
                <span style="font-size:0.8rem; opacity:0.8;">Agenda & Tarefas</span>
            </div>
        `;
        
        // Insere como primeiro item da grid
        grid.insertBefore(btn, grid.firstChild);
    }
}

// 4. DASHBOARD (LÓGICA CORRIGIDA COM FILTRO)
function initRealTimeDashboard() {
    const q = query(collection(db, "tasks"));

    unsubscribeTasks = onSnapshot(q, (snapshot) => {
        // Zera contadores
        const counts = {
            necropsias: 0, 
            biopsias: 0,   
            clivagem: 0,
            processamento: 0,
            emblocamento: 0,
            corte: 0,
            coloracao: 0,
            analise: 0,
            liberar: 0
        };

        let myQueue = [];

        snapshot.forEach(doc => {
            const task = { id: doc.id, ...doc.data() };
            
            // --- FILTRO CRÍTICO ---
            // Ignora tarefas exclusivas do Planner para não poluir o Hub
            if (task.type === 'agendamento_rapido') return;

            const status = task.status; 
            const type = task.type;     

            // --- LÓGICA 1: TOTALIZADORES ---
            // Conta apenas se NÃO estiver concluído/arquivado
            if (status !== 'concluido' && status !== 'arquivado') { 
                if (type === 'biopsia') counts.biopsias++;
                if (type === 'necropsia') counts.necropsias++;
                
                // --- LÓGICA 2: ESTEIRA DE PRODUÇÃO ---
                if (counts.hasOwnProperty(status)) {
                    counts[status]++;
                }
            }

            // --- LÓGICA 3: MINHA FILA LATERAL ---
            if (isTaskRelevant(task, currentUserData.role)) {
                myQueue.push(task);
            }
        });

        updateCounters(counts);
        queueSourceTasks = myQueue;
        applyQueueFilter();

    }, (error) => console.warn(error));
}

function updateCounters(c) {
    if(els.cNecropsias) els.cNecropsias.textContent = c.necropsias;
    if(els.cBiopsias) els.cBiopsias.textContent = c.biopsias;
    
    if(els.cClivagem) els.cClivagem.textContent = c.clivagem;
    if(els.cProcessamento) els.cProcessamento.textContent = c.processamento;
    if(els.cEmblocamento) els.cEmblocamento.textContent = c.emblocamento;
    if(els.cCorte) els.cCorte.textContent = c.corte;
    if(els.cColoracao) els.cColoracao.textContent = c.coloracao;
    if(els.cAnalise) els.cAnalise.textContent = c.analise;
    if(els.cLiberar) els.cLiberar.textContent = c.liberar;
}

// QUEM VÊ O QUE NA BARRA LATERAL
function isTaskRelevant(task, role) {
    // Se já foi concluído ou arquivado, ninguém vê na lista lateral
    if (task.status === 'concluido' || task.status === 'arquivado') {
        return false;
    }

    const cleanRole = role ? role.toLowerCase() : 'student';

    if (cleanRole === 'admin' || cleanRole === 'professor') return true; 
    
    if (cleanRole === 'pós graduando' || cleanRole === 'pos-graduando') return true;

    if (cleanRole === 'estagiario') {
        return ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao'].includes(task.status);
    }
    return false;
}

function setupQueueFilters() {
    const cleanRole = (currentUserData?.role || '').toLowerCase();
    const isPosGrad = cleanRole === 'pós graduando' || cleanRole === 'pos-graduando';

    if (els.queueFilterContainer) {
        els.queueFilterContainer.classList.toggle('hidden', !isPosGrad);
    }

    if (!isPosGrad) return;

    if (els.queueFilterAll && !els.queueFilterAll.dataset.bound) {
        els.queueFilterAll.addEventListener('click', () => {
            queueFilterMode = 'all';
            updateQueueFilterButtons();
            applyQueueFilter();
        });
        els.queueFilterAll.dataset.bound = 'true';
    }

    if (els.queueFilterMine && !els.queueFilterMine.dataset.bound) {
        els.queueFilterMine.addEventListener('click', () => {
            queueFilterMode = 'mine';
            updateQueueFilterButtons();
            applyQueueFilter();
        });
        els.queueFilterMine.dataset.bound = 'true';
    }

    updateQueueFilterButtons();
}

function updateQueueFilterButtons() {
    if (!els.queueFilterAll || !els.queueFilterMine) return;
    const allActive = queueFilterMode === 'all';
    els.queueFilterAll.classList.toggle('btn-primary', allActive);
    els.queueFilterAll.classList.toggle('btn-secondary', !allActive);
    els.queueFilterMine.classList.toggle('btn-primary', !allActive);
    els.queueFilterMine.classList.toggle('btn-secondary', allActive);
}

function applyQueueFilter() {
    const cleanRole = (currentUserData?.role || '').toLowerCase();
    const isPosGrad = cleanRole === 'pós graduando' || cleanRole === 'pos-graduando';

    let tasksToRender = queueSourceTasks;
    if (isPosGrad && queueFilterMode === 'mine') {
        const currentUserName = normalizeText(currentUserData?.name || '');
        if (!currentUserName) {
            tasksToRender = [];
        } else {
            tasksToRender = queueSourceTasks.filter((task) => normalizeText(task.posGraduando || '') === currentUserName);
        }
    }

    renderQueue(tasksToRender);
}

// 7. RENDERIZAR A LISTA LATERAL
function renderQueue(tasks) {
    const necropsiaList = document.getElementById('queue-necropsia-list');
    const biopsiaList = document.getElementById('queue-biopsia-list');
    const necropsiaCount = document.getElementById('queue-count-necropsia');
    const biopsiaCount = document.getElementById('queue-count-biopsia');
    if (!necropsiaList || !biopsiaList) return;

    necropsiaList.innerHTML = '';
    biopsiaList.innerHTML = '';

    const activeTasks = [...tasks].sort((a, b) => {
        const protA = a.protocolo || a.accessCode || '';
        const protB = b.protocolo || b.accessCode || '';
        return protA.localeCompare(protB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const queueByType = { necropsia: [], biopsia: [] };

    activeTasks.forEach((task) => {
        const isNecropsia = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        queueByType[isNecropsia ? 'necropsia' : 'biopsia'].push(task);
    });

    necropsiaCount.textContent = queueByType.necropsia.length;
    biopsiaCount.textContent = queueByType.biopsia.length;

    renderQueueColumn(necropsiaList, queueByType.necropsia, 'necropsia');
    renderQueueColumn(biopsiaList, queueByType.biopsia, 'biopsia');

    initQueueMobileCarousel();
}

function renderQueueColumn(container, tasks, type) {
    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="queue-empty">
                <i class="far fa-check-circle fa-2x" style="margin-bottom: 10px; opacity: 0.5;"></i>
                <p>Nenhuma amostra de ${type === 'necropsia' ? 'necropsia' : 'biópsia'}.</p>
            </div>`;
        return;
    }

    tasks.forEach((task, index) => {
        const div = document.createElement('div');
        const colorClass = task.k7Color ? `k7-${task.k7Color}` : '';
        div.className = `sample-ticket ${colorClass}`;
        div.style.setProperty('--card-index', index);
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');

        const openDetails = () => openTaskManagerWithRetry(task.id);
        div.addEventListener('click', openDetails);
        div.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDetails();
            }
        });

        const protocol = task.protocolo || task.accessCode || '---';
        const isNecropsia = type === 'necropsia';
        const typeLabel = isNecropsia ? 'NECROPSIA' : 'BIÓPSIA';
        const typeColor = isNecropsia ? '#3b82f6' : '#ec4899';

        const shortPos = getShortName(task.posGraduando || 'Sem Pós');

        const statusMap = {
            clivagem: 'Clivagem', processamento: 'Processamento', emblocamento: 'Emblocamento',
            corte: 'Corte', coloracao: 'Coloração', analise: 'Análise', liberar: 'Liberar'
        };
        const statusName = statusMap[task.status] || task.status;

        div.innerHTML = `
            <div style="width: 100%;">
                <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                     <span style="font-weight: 800; font-size: 1rem; color: var(--text-primary);">${protocol}</span>
                     <span style="font-size: 0.65rem; font-weight: 800; color: ${typeColor}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${typeColor}30;">
                        ${typeLabel}
                     </span>
                </div>

                <div style="font-size: 0.9rem; color: var(--text-primary); margin-bottom: 2px;">
                    <strong>${task.animalNome || 'Sem Nome'}</strong>
                    <span style="opacity: 0.6; font-size: 0.8rem;">(${task.especie || '?'})</span>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 5px;">
                        <span style="width: 8px; height: 8px; background: var(--color-primary); border-radius: 50%; display: inline-block;"></span>
                        ${statusName}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px;">
                        <i class="fas fa-user-graduate"></i> ${shortPos}
                    </div>
                </div>
            </div>`;

        container.appendChild(div);
    });
}

function initQueueMobileCarousel() {
    const carousel = document.getElementById('queue-mobile-carousel');
    const dots = document.getElementById('queue-mobile-dots');
    if (!carousel || !dots) return;

    if (!dots.dataset.ready) {
        dots.innerHTML = `
            <span class="queue-dot active" data-index="0"></span>
            <span class="queue-dot" data-index="1"></span>`;
        dots.dataset.ready = 'true';
    }

    const columns = Array.from(carousel.querySelectorAll('.queue-column'));
    const dotItems = Array.from(dots.querySelectorAll('.queue-dot'));

    const syncActive = () => {
        if (window.innerWidth > 900) {
            columns.forEach((col) => col.classList.remove('active'));
            dotItems.forEach((dot, idx) => dot.classList.toggle('active', idx === 0));
            return;
        }

        const colWidth = columns[0]?.offsetWidth || 1;
        const activeIndex = Math.round(carousel.scrollLeft / (colWidth + 10));
        columns.forEach((col, idx) => col.classList.toggle('active', idx === activeIndex));
        dotItems.forEach((dot, idx) => dot.classList.toggle('active', idx === activeIndex));
    };

    if (!carousel.dataset.bound) {
        carousel.addEventListener('scroll', syncActive, { passive: true });
        window.addEventListener('resize', syncActive);
        dotItems.forEach((dot) => {
            dot.addEventListener('click', () => {
                const idx = Number(dot.dataset.index);
                const offset = (columns[0]?.offsetWidth || 0) + 10;
                carousel.scrollTo({ left: offset * idx, behavior: 'smooth' });
            });
        });
        carousel.dataset.bound = 'true';
    }

    syncActive();
}

async function openTaskManagerWithRetry(taskId) {
    if (typeof window.openTaskManager === 'function') {
        window.openTaskManager(taskId);
        return;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (typeof window.openTaskManager === 'function') {
            window.openTaskManager(taskId);
            return;
        }
    }

    console.warn('Task manager indisponível no momento.');
}

// SCROLL HORIZONTAL
const productionWrapper = document.querySelector('.production-wrapper');

if (productionWrapper) {
    productionWrapper.addEventListener('wheel', (evt) => {
        if (evt.deltaY !== 0) {
            evt.preventDefault();
            productionWrapper.scrollLeft += evt.deltaY;
        }
    });
}

// AUXILIARES
function getShortName(fullName) {
    if (!fullName) return '-';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0]; 
    return `${parts[0]} ${parts[1][0]}.`;
}

function normalizeText(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
