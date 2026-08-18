import { auth, db, normalizeRoles, hasAnyRole } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, collection, query, onSnapshot, where } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { pesoProtocolo } from '../lib/protocolo.js';
import { NIVEIS, bandeiraDoNivel, classeDoNivel, nivelDaAmostra, pesoPrioridade } from '../lib/prioridade.js';
import {
    describeDeadline,
    formatDate,
    getCycleInfo,
    getItemStatus,
    isAlertStatus
} from '../lib/estoque-ciclo.js';

// 1. MAPEAMENTO DOS ELEMENTOS
const els = {
    userBadge: document.getElementById('user-role-badge'),
    urgentList: document.getElementById('urgent-list'),
    urgentCount: document.getElementById('urgent-count'),
    priorityCount: document.getElementById('priority-count'),
    queueFilterContainer: document.getElementById('queue-filter-container'),
    queueFilterAll: document.getElementById('queue-filter-all'),
    queueFilterMine: document.getElementById('queue-filter-mine')
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
            initInventorySummary();
            initWeekAgenda();
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

// ALERTAS DO ESTOQUE
//
// O estoque não é contado unidade a unidade: cada item guarda quanto se compra
// e quanto tempo aquilo costuma durar. Aqui só aparece o que está chegando no
// fim do prazo previsto — o aviso para conferir o armário antes de comprar.
const HUB_STOCK_MAX_ROWS = 4;

function initInventorySummary() {
    const list = document.getElementById('hub-stock-alerts');
    const subtitle = document.getElementById('hub-stock-subtitle');
    if (!list) return;

    onSnapshot(collection(db, 'inventory_items'), (snapshot) => {
        const alerts = [];

        snapshot.forEach((itemDoc) => {
            const item = { id: itemDoc.id, ...itemDoc.data() };
            const cycle = getCycleInfo(item);
            const status = getItemStatus(item, cycle);
            if (isAlertStatus(status)) alerts.push({ item, cycle, status });
        });

        alerts.sort((a, b) => a.cycle.daysLeft - b.cycle.daysLeft);
        renderInventoryAlerts(list, subtitle, alerts);
    }, (error) => {
        console.warn('Resumo do estoque indisponível:', error.message);
    });
}

function renderInventoryAlerts(list, subtitle, alerts) {
    document.querySelector('.inventory-hub-panel')?.classList.toggle('has-attention', alerts.length > 0);

    if (subtitle) {
        subtitle.textContent = alerts.length === 0
            ? 'Nenhum prazo perto do fim'
            : `${alerts.length} ${alerts.length === 1 ? 'produto para conferir' : 'produtos para conferir'}`;
    }

    if (alerts.length === 0) {
        list.innerHTML = `
            <div class="inventory-hub-empty">
                <i class="far fa-check-circle"></i>
                <span>Estoque dentro do prazo previsto.</span>
            </div>`;
        return;
    }

    const rows = alerts.slice(0, HUB_STOCK_MAX_ROWS).map(({ item, cycle, status }) => `
        <div class="inventory-hub-alert ${status === 'due' ? 'is-late' : 'is-near'}">
            <span class="inventory-hub-alert-icon">
                <i class="fas ${status === 'due' ? 'fa-triangle-exclamation' : 'fa-hourglass-half'}"></i>
            </span>
            <div class="inventory-hub-alert-text">
                <strong>${escapeHtml(item.name)}</strong>
                <small>${describeDeadline(cycle)} · previsão ${formatDate(cycle.expectedEndDate)}</small>
            </div>
        </div>`).join('');

    const extra = alerts.length - HUB_STOCK_MAX_ROWS;
    list.innerHTML = rows + (extra > 0
        ? `<div class="inventory-hub-more">+${extra} ${extra === 1 ? 'outro item' : 'outros itens'}</div>`
        : '');
}

// 4. DASHBOARD (LÓGICA CORRIGIDA COM FILTRO)

/**
 * Uma consulta por marcador, e não um `or()` sobre os dois campos: o Firestore
 * só devolve documento que TEM o campo consultado, e `isPriority` nasceu depois
 * — a disjunção deixaria de fora justamente os casos urgentes antigos, que é
 * quem mais precisa aparecer aqui. Cada consulta guarda o seu resultado e o
 * painel é redesenhado com a união das duas.
 */
const filaPorFonte = { urgentes: [], prioritarias: [] };

function initRealTimeDashboard() {
    // O filtro vai na consulta e não depois: o acervo de laudos liberados não
    // precisa sair do Firestore para ser descartado aqui — e leitura é o
    // recurso que acaba.
    const consultas = {
        urgentes: query(collection(db, "tasks"), where("isUrgent", "==", true)),
        prioritarias: query(collection(db, "tasks"), where("isPriority", "==", true))
    };

    const cancelamentos = Object.entries(consultas).map(([fonte, q]) => onSnapshot(q, (snapshot) => {
        filaPorFonte[fonte] = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            // Tarefa exclusiva do Planner não polui o Hub.
            .filter((task) => task.type !== 'agendamento_rapido' && isTaskRelevant(task));

        // As duas fontes podem trazer o mesmo caso (dado antigo com os dois
        // campos marcados); o id manda e o caso entra uma vez só.
        const porId = new Map();
        [...filaPorFonte.urgentes, ...filaPorFonte.prioritarias]
            .forEach((task) => porId.set(task.id, task));

        queueSourceTasks = [...porId.values()];
        applyQueueFilter();

    }, (error) => console.warn(error)));

    unsubscribeTasks = () => cancelamentos.forEach((cancelar) => cancelar());
}

// Entra na fila a amostra marcada como urgente ou como prioritária na entrada;
// o laudo liberado tira o caso da fila.
function isTaskRelevant(task) {
    return !task.releasedAt && nivelDaAmostra(task) !== null;
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
    els.queueFilterAll.classList.toggle('is-active', allActive);
    els.queueFilterMine.classList.toggle('is-active', !allActive);
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

    renderUrgentList(tasksToRender);
}

// 7. RENDERIZAR AS URGÊNCIAS
// Prazo de entrega em dias corridos contados a partir da data de entrada.
const DEADLINE_DAYS = { necropsia: 40, biopsia: 15 };

function isNecropsiaTask(task) {
    return (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
}

// Positivo = dias que faltam; negativo = dias de atraso. null quando não há
// data de entrada para contar.
function getDeadlineInfo(task) {
    if (!task.dataEntrada) return null;

    const entry = new Date(`${task.dataEntrada}T12:00:00`);
    if (Number.isNaN(entry.getTime())) return null;

    const limit = DEADLINE_DAYS[isNecropsiaTask(task) ? 'necropsia' : 'biopsia'];
    const due = new Date(entry);
    due.setDate(due.getDate() + limit);

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    return { remaining: Math.round((due - today) / 86400000), limit };
}

function renderDeadlineCell(info) {
    if (!info) {
        return '<span class="u-prazo is-unknown" title="Sem data de entrada">—</span>';
    }

    const { remaining, limit } = info;
    const late = remaining < 0;
    const days = Math.abs(remaining);

    let title;
    if (late) title = `${days} ${days === 1 ? 'dia' : 'dias'} em atraso (prazo de ${limit} dias)`;
    else if (remaining === 0) title = `Vence hoje (prazo de ${limit} dias)`;
    else title = `Faltam ${days} ${days === 1 ? 'dia' : 'dias'} (prazo de ${limit} dias)`;

    const icon = late ? 'fa-triangle-exclamation' : 'fa-clock';
    return `<span class="u-prazo ${late ? 'is-late' : 'is-ok'}" title="${title}">
        <i class="fas ${icon}"></i>${days} d</span>`;
}

/**
 * Contadores do cabeçalho: um por nível, cada um na sua cor. Com a fila vazia
 * sobra um só, em verde — dois zeros lado a lado não dizem nada.
 */
function renderPriorityCounts(urgentes, prioritarias) {
    const total = urgentes + prioritarias;
    const rotular = (n, nivel) =>
        `${n} ${n === 1 ? NIVEIS[nivel].rotulo.toLowerCase() : NIVEIS[nivel].plural}`;

    if (els.urgentCount) {
        els.urgentCount.textContent = total === 0 ? 'Nada na fila' : rotular(urgentes, 'urgente');
        els.urgentCount.classList.toggle('is-clear', total === 0);
    }

    if (els.priorityCount) {
        els.priorityCount.hidden = total === 0;
        els.priorityCount.textContent = rotular(prioritarias, 'prioritaria');
    }
}

// Urgente antes de prioritária, sempre: é a ordem da escala, e um prazo
// confortável numa urgente não a faz esperar atrás de uma prioritária estourada.
// Dentro de cada nível vale o prazo — o caso mais perto de estourar (ou mais
// atrasado) vem primeiro.
function renderUrgentList(tasks) {
    if (!els.urgentList) return;

    const rows = [...tasks].sort((a, b) => {
        const nivel = pesoPrioridade(a) - pesoPrioridade(b);
        if (nivel !== 0) return nivel;

        const infoA = getDeadlineInfo(a);
        const infoB = getDeadlineInfo(b);
        if (!infoA !== !infoB) return infoA ? -1 : 1;   // sem data vai pro fim
        if (infoA && infoB && infoA.remaining !== infoB.remaining) {
            return infoA.remaining - infoB.remaining;
        }
        // Protocolo é cronológico: ano da série primeiro, depois o número.
        return pesoProtocolo(a.protocolo) - pesoProtocolo(b.protocolo);
    });

    renderPriorityCounts(
        rows.filter((task) => nivelDaAmostra(task) === 'urgente').length,
        rows.filter((task) => nivelDaAmostra(task) === 'prioritaria').length
    );

    els.urgentList.innerHTML = '';
    els.urgentList.classList.toggle('is-empty', rows.length === 0);

    if (rows.length === 0) {
        els.urgentList.innerHTML = `
            <div class="urgent-empty">
                <i class="far fa-check-circle fa-2x"></i>
                <p>Nenhuma amostra urgente ou prioritária no momento.</p>
            </div>`;
        return;
    }

    rows.forEach((task) => {
        const isNecropsia = isNecropsiaTask(task);
        const typeClass = isNecropsia ? 'type-necro' : 'type-bio';

        const card = document.createElement('div');
        card.className = `urgent-card ${classeDoNivel(task)} ${typeClass}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.title = `${task.protocolo || ''} — ${task.animalNome || ''}`;

        const openDetails = () => openTaskManagerWithRetry(task.id);
        card.addEventListener('click', openDetails);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDetails();
            }
        });

        const dataEntrada = task.dataEntrada
            ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            : '—';

        card.innerHTML = `
            <span class="u-prot">${bandeiraDoNivel(task, 'u-flag')}${escapeHtml(task.protocolo || '---')}</span>
            <span class="u-animal"><strong>${escapeHtml(task.animalNome || 'Sem Nome')}</strong>
                <span class="u-species">(${escapeHtml(task.especie || '?')})</span></span>
            <span class="u-type ${typeClass}">${isNecropsia ? 'NECROPSIA' : 'BIÓPSIA'}</span>
            <span class="u-date"><i class="far fa-calendar"></i>${dataEntrada}</span>
            <span class="u-resp"><i class="fas fa-user-graduate"></i>${escapeHtml(getShortName(task.posGraduando || 'Sem Pós'))}</span>
            ${renderDeadlineCell(getDeadlineInfo(task))}`;

        els.urgentList.appendChild(card);
    });
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

function escapeHtml(value) {
    return (value ?? '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =====================================================================
//  CALENDÁRIO — utilitários compartilhados
// =====================================================================

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

// =====================================================================
//  AGENDA SEMANAL (Seg-Sex, separada por manhã e tarde)
//  Fonte: agendamentos do Planner na coleção "tasks".
// =====================================================================

const AGENDA_DAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const AGENDA_SHIFTS = [
    { key: 'manha', label: 'Manhã', icon: 'fa-sun' },
    { key: 'tarde', label: 'Tarde', icon: 'fa-moon' }
];
// Antes disso é manhã; a partir daí, tarde.
const AGENDA_SHIFT_CUTOFF = '12:00';

let weekOffset = 0;              // 0 = semana corrente
let weekTasksCache = [];
let unsubscribeWeek = null;

function initWeekAgenda() {
    renderWeekAgenda();
    subscribeWeekTasks();

    document.getElementById('week-prev')?.addEventListener('click', () => shiftWeek(-1));
    document.getElementById('week-next')?.addEventListener('click', () => shiftWeek(1));
    document.getElementById('week-today')?.addEventListener('click', () => {
        if (weekOffset === 0) return;
        weekOffset = 0;
        renderWeekAgenda();
        subscribeWeekTasks();
    });
}

function shiftWeek(delta) {
    weekOffset += delta;
    renderWeekAgenda();
    subscribeWeekTasks();
}

function subscribeWeekTasks() {
    if (unsubscribeWeek) unsubscribeWeek();

    const days = getWeekDates(weekOffset);
    const q = query(
        collection(db, "tasks"),
        where("scheduledDate", ">=", dateToStr(days[0])),
        where("scheduledDate", "<=", dateToStr(days[4]))
    );

    unsubscribeWeek = onSnapshot(q, (snap) => {
        weekTasksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderWeekAgenda();
    }, (error) => {
        console.warn('Agenda semanal indisponível:', error.message);
        weekTasksCache = [];
        renderWeekAgenda();
    });
}

function getAgendaShift(task) {
    return (task.scheduledTime || '') < AGENDA_SHIFT_CUTOFF ? 'manha' : 'tarde';
}

function getAgendaTypeClass(task) {
    if (task.type === 'necropsia' || (!task.type && task.k7Color === 'azul')) return 'type-necro';
    if (task.type === 'biopsia' || (!task.type && task.k7Color === 'rosa')) return 'type-bio';
    return 'type-other';
}

// Uma coluna por dia; dentro dela os agendamentos vêm rotulados por turno.
function renderWeekAgenda() {
    const grid = document.getElementById('week-grid');
    if (!grid) return;

    const days = getWeekDates(weekOffset);
    const todayStr = dateToStr(new Date());

    const label = document.getElementById('week-range-label');
    if (label) {
        const [start] = days;
        const end = days[days.length - 1];
        label.textContent = `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} — ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`;
    }

    grid.innerHTML = '';

    days.forEach((date, index) => {
        const dStr = dateToStr(date);
        const isToday = dStr === todayStr;

        const col = document.createElement('div');
        col.className = `week-day${isToday ? ' today' : ''}`;
        col.innerHTML = `
            <div class="week-day-header">
                <span class="week-day-name">${AGENDA_DAY_SHORT[index]}</span>
                <span class="week-day-num">${date.getDate()}</span>
            </div>`;

        const body = document.createElement('div');
        body.className = 'week-day-body';

        const dayTasks = weekTasksCache.filter(t => t.scheduledDate === dStr);

        // Os dois turnos são sempre desenhados, mesmo vazios: é a divisão
        // manhã/tarde que dá a leitura do dia de relance.
        AGENDA_SHIFTS.forEach(({ key, label: shiftLabel, icon }) => {
            const items = dayTasks
                .filter(t => getAgendaShift(t) === key)
                .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

            const block = document.createElement('div');
            block.className = `week-shift-block shift-${key}`;
            block.innerHTML = `<div class="week-shift"><i class="fas ${icon}"></i>${shiftLabel}</div>`;

            const itemsWrap = document.createElement('div');
            itemsWrap.className = 'week-shift-items';

            if (items.length === 0) {
                itemsWrap.innerHTML = '<span class="week-shift-empty">—</span>';
            }

            items.forEach((task) => {
                const chip = document.createElement('div');
                chip.className = `week-chip ${getAgendaTypeClass(task)}`;
                chip.innerHTML = `
                    <span class="week-chip-time">${escapeHtml(task.scheduledTime || '--:--')}</span>
                    <span class="week-chip-label">${escapeHtml(task.protocolo || task.animalNome || 'Sem título')}</span>`;
                chip.title = `${task.protocolo || ''} — ${task.animalNome || ''} (${task.scheduledTime || '--:--'})`;
                chip.addEventListener('click', () => { window.location.href = 'planner.html'; });
                itemsWrap.appendChild(chip);
            });

            block.appendChild(itemsWrap);
            body.appendChild(block);
        });

        col.appendChild(body);
        grid.appendChild(col);
    });
}
