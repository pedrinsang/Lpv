import { auth, db, normalizeRoles, hasRole, hasAnyRole, primaryRole } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, where } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 1. MAPEAMENTO DOS ELEMENTOS
const els = {
    userBadge: document.getElementById('user-role-badge'),
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
        if (currentUserData) {
            initRealTimeDashboard();
            initWeeklyPlanner();
            initInternSchedule();
        }
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
    const roles = normalizeRoles(role);
    const display = roles.map(r => r.charAt(0).toUpperCase() + r.slice(1).replace('-', ' ')).join(' / ');
    els.userBadge.textContent = display;
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
    if (task.status === 'concluido' || task.status === 'arquivado') {
        return false;
    }

    const roles = normalizeRoles(role);

    if (hasAnyRole(role, ['admin', 'professor'])) return true;
    if (hasAnyRole(role, ['pós graduando', 'pos-graduando'])) return true;

    if (roles.includes('estagiario')) {
        return ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao'].includes(task.status);
    }
    return false;
}

function setupQueueFilters() {
    const isPosGrad = hasAnyRole(currentUserData?.role, ['pós graduando', 'pos-graduando']);

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
    const isPosGrad = hasAnyRole(currentUserData?.role, ['pós graduando', 'pos-graduando']);

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

// =====================================================================
//  PLANNER SEMANAL (puxa dados do Planner mensal — coleção "tasks")
// =====================================================================

let weekOffset = 0;          // 0 = semana atual
let weeklyTasksCache = [];
let unsubscribeWeekly = null;

function getWeekDates(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0=Dom
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 5; i++) { // Seg-Sex only
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
    }
    return days;
}

function dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initWeeklyPlanner() {
    renderWeeklyGrid();
    subscribeWeeklyTasks();

    document.getElementById('week-prev')?.addEventListener('click', () => { weekOffset--; renderWeeklyGrid(); subscribeWeeklyTasks(); });
    document.getElementById('week-next')?.addEventListener('click', () => { weekOffset++; renderWeeklyGrid(); subscribeWeeklyTasks(); });
    document.getElementById('week-today')?.addEventListener('click', () => { weekOffset = 0; renderWeeklyGrid(); subscribeWeeklyTasks(); });
}

function subscribeWeeklyTasks() {
    if (unsubscribeWeekly) unsubscribeWeekly();

    const days = getWeekDates(weekOffset);
    const startStr = dateToStr(days[0]);
    const endStr = dateToStr(days[4]);

    const q = query(
        collection(db, "tasks"),
        where("scheduledDate", ">=", startStr),
        where("scheduledDate", "<=", endStr)
    );

    unsubscribeWeekly = onSnapshot(q, (snap) => {
        weeklyTasksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        populateWeeklyGrid();
    });
}

function renderWeeklyGrid() {
    const grid = document.getElementById('weekly-grid');
    const label = document.getElementById('week-range-label');
    if (!grid) return;

    const days = getWeekDates(weekOffset);
    const todayStr = dateToStr(new Date());

    const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    if (label) {
        const s = days[0], e = days[4];
        label.textContent = `${s.getDate()} ${monthNames[s.getMonth()]} — ${e.getDate()} ${monthNames[e.getMonth()]}`;
    }

    grid.innerHTML = '';
    days.forEach((d, i) => {
        const dStr = dateToStr(d);
        const isToday = dStr === todayStr;
        const col = document.createElement('div');
        col.className = `week-day-col${isToday ? ' today' : ''}`;
        col.dataset.date = dStr;
        col.innerHTML = `
            <div class="week-day-header">
                <span class="week-day-name">${dayNames[i]}</span>
                <span class="week-day-num">${d.getDate()}</span>
            </div>
            <div class="week-day-body" data-date="${dStr}"></div>`;
        grid.appendChild(col);
    });

    populateWeeklyGrid();
}

function populateWeeklyGrid() {
    const grid = document.getElementById('weekly-grid');
    if (!grid) return;

    grid.querySelectorAll('.week-day-body').forEach(body => {
        const dStr = body.dataset.date;
        const tasks = weeklyTasksCache
            .filter(t => t.scheduledDate === dStr)
            .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

        body.innerHTML = '';
        if (tasks.length === 0) {
            body.innerHTML = '<div class="week-empty">—</div>';
            return;
        }

        tasks.forEach(t => {
            const chip = document.createElement('div');
            let colorClass = 'wp-other';
            if (t.type === 'necropsia' || (!t.type && t.k7Color === 'azul')) colorClass = 'wp-necro';
            else if (t.type === 'biopsia' || (!t.type && t.k7Color === 'rosa')) colorClass = 'wp-bio';

            chip.className = `wp-chip ${colorClass}`;
            chip.innerHTML = `
                <span class="wp-time">${t.scheduledTime || '--:--'}</span>
                <span class="wp-label">${t.protocolo || t.animalNome || 'Sem título'}</span>`;
            chip.title = `${t.protocolo || ''} — ${t.animalNome || ''} (${t.scheduledTime || ''})`;

            chip.addEventListener('click', () => {
                // Abre direto no planner mensal
                window.location.href = `planner.html`;
            });

            body.appendChild(chip);
        });
    });
}

// =====================================================================
//  ESCALA DE ESTAGIÁRIOS (Tabela fixa Seg-Sex, por turno)
// =====================================================================

const SCHEDULE_DAYS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
const SCHEDULE_DAY_LABELS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const SCHEDULE_SHIFTS = ['manha', 'tarde'];
const SCHEDULE_SHIFT_LABELS = { manha: 'Manhã', tarde: 'Tarde' };

let internUsers = [];
let internScheduleCache = [];
let unsubscribeSchedule = null;
let unsubscribeInterns = null;
let canEditSchedule = false;
let scheduleScrolledToToday = false;

function initInternSchedule() {
    canEditSchedule = hasAnyRole(currentUserData?.role, ['admin', 'professor', 'pós graduando', 'pos-graduando']);

    const addBtn = document.getElementById('btn-add-schedule');
    if (addBtn && canEditSchedule) addBtn.classList.remove('hidden');

    subscribeInterns();
    subscribeScheduleData();
    setupScheduleModal();
}

function subscribeInterns() {
    if (unsubscribeInterns) unsubscribeInterns();

    const q = query(collection(db, "users"));
    unsubscribeInterns = onSnapshot(q, (snap) => {
        internUsers = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => {
                const status = (u.status || '').toLowerCase();
                return status === 'active' || status === 'aprovado' || status === '';
            });

        populateInternSelect();
        renderInternWeekGrid();
    });
}

function subscribeScheduleData() {
    if (unsubscribeSchedule) unsubscribeSchedule();

    const q = query(collection(db, "intern_schedule"));
    unsubscribeSchedule = onSnapshot(q, (snap) => {
        internScheduleCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderInternWeekGrid();
    }, (error) => {
        console.warn("Escala: sem permissão ou coleção inexistente.", error.message);
        internScheduleCache = [];
        renderInternWeekGrid();
    });
}

function getTodayDayKey() {
    const jsDay = new Date().getDay(); // 0=Dom
    const map = { 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta' };
    return map[jsDay] || null;
}

function renderInternWeekGrid() {
    const container = document.getElementById('intern-week-grid');
    if (!container) return;

    const todayKey = getTodayDayKey();
    container.innerHTML = '';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'intern-row intern-header-row';
    headerRow.innerHTML = `<div class="intern-name-cell">Turno</div>`;
    SCHEDULE_DAYS.forEach((dayKey, i) => {
        const isToday = dayKey === todayKey;
        headerRow.innerHTML += `<div class="intern-day-cell${isToday ? ' today' : ''}">${SCHEDULE_DAY_LABELS[i]}</div>`;
    });
    container.appendChild(headerRow);

    // One row per shift
    SCHEDULE_SHIFTS.forEach(shift => {
        const row = document.createElement('div');
        row.className = 'intern-row';

        const nameCell = document.createElement('div');
        nameCell.className = 'intern-name-cell';
        nameCell.innerHTML = `<i class="fas ${shift === 'manha' ? 'fa-sun' : 'fa-moon'}" style="margin-right:6px; opacity:0.6;"></i>${SCHEDULE_SHIFT_LABELS[shift]}`;
        row.appendChild(nameCell);

        SCHEDULE_DAYS.forEach(dayKey => {
            const isToday = dayKey === todayKey;
            const cell = document.createElement('div');
            cell.className = `intern-day-cell${isToday ? ' today' : ''}`;

            const entries = internScheduleCache.filter(s => s.day === dayKey && s.shift === shift);

            if (entries.length > 0) {
                entries.forEach(entry => {
                    const tag = document.createElement('div');
                    tag.className = `intern-task-tag shift-${shift}`;
                    const internName = getShortName(entry.internName || internUsers.find(u => u.id === entry.internId)?.name || '?');
                    tag.innerHTML = `<span class="sched-intern-name">${internName}</span><span class="sched-task-text">${entry.task || '—'}</span>`;
                    tag.title = `${entry.internName || '?'} — ${entry.task}`;
                    if (canEditSchedule) {
                        tag.style.cursor = 'pointer';
                        tag.addEventListener('click', () => openScheduleModal(entry));
                    }
                    cell.appendChild(tag);
                });
            }

            if (canEditSchedule) {
                const addHint = document.createElement('button');
                addHint.className = 'intern-add-hint';
                addHint.innerHTML = '<i class="fas fa-plus"></i>';
                addHint.title = 'Adicionar';
                addHint.addEventListener('click', () => openScheduleModal(null, null, null, dayKey, shift));
                cell.appendChild(addHint);
            }

            row.appendChild(cell);
        });

        container.appendChild(row);
    });

    // Scroll para o dia atual apenas na primeira renderização
    if (!scheduleScrolledToToday && todayKey) {
        scheduleScrolledToToday = true;
        requestAnimationFrame(() => {
            const todayCell = container.querySelector('.intern-day-cell.today');
            if (todayCell) {
                todayCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        });
    }
}

// --- MODAL DE ESCALA ---
function populateInternSelect() {
    const select = document.getElementById('sched-intern');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Selecione...</option>';
    internUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name || u.email || u.id;
        select.appendChild(opt);
    });
    if (current) select.value = current;
}

function setupScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    const form = document.getElementById('schedule-form');
    const closeBtn = document.getElementById('close-schedule-modal');
    const deleteBtn = document.getElementById('sched-delete-btn');
    const addBtn = document.getElementById('btn-add-schedule');

    if (addBtn) addBtn.addEventListener('click', () => openScheduleModal(null));
    if (closeBtn) closeBtn.addEventListener('click', () => modal?.classList.add('hidden'));
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const internId = document.getElementById('sched-intern').value;
            const task = document.getElementById('sched-task').value.trim();
            const day = document.getElementById('sched-day').value;
            const shift = document.getElementById('sched-shift').value;
            const editId = document.getElementById('sched-id').value;

            if (!internId || !task) return alert('Preencha todos os campos.');

            const internName = internUsers.find(u => u.id === internId)?.name || '';
            const payload = { internId, internName, day, task, shift, updatedAt: new Date().toISOString() };

            modal.classList.add('hidden');

            if (editId) {
                updateDoc(doc(db, "intern_schedule", editId), payload).catch(err => { console.error(err); alert('Erro ao salvar escala.'); });
            } else {
                payload.createdAt = new Date().toISOString();
                addDoc(collection(db, "intern_schedule"), payload).catch(err => { console.error(err); alert('Erro ao salvar escala.'); });
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const editId = document.getElementById('sched-id').value;
            if (!editId) return;
            if (!confirm('Remover esta escala?')) return;
            modal.classList.add('hidden');
            deleteDoc(doc(db, "intern_schedule", editId)).catch(err => { console.error(err); alert('Erro ao remover.'); });
        });
    }
}

function openScheduleModal(entry, _unused, _unused2, preDay, preShift) {
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;

    const titleEl = document.getElementById('sched-modal-title');
    const shiftKey = entry?.shift || preShift || 'manha';
    const dayKey = entry?.day || preDay || 'segunda';
    const dayLabel = SCHEDULE_DAY_LABELS[SCHEDULE_DAYS.indexOf(dayKey)] || dayKey;
    const shiftLabel = SCHEDULE_SHIFT_LABELS[shiftKey] || shiftKey;

    if (titleEl) titleEl.textContent = `${dayLabel} — ${shiftLabel}`;

    document.getElementById('sched-intern').value = entry?.internId || '';
    document.getElementById('sched-task').value = entry?.task || '';
    document.getElementById('sched-day').value = dayKey;
    document.getElementById('sched-shift').value = shiftKey;
    document.getElementById('sched-id').value = entry?.id || '';

    const deleteBtn = document.getElementById('sched-delete-btn');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !entry?.id);

    modal.classList.remove('hidden');
}
