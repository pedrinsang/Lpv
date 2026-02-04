import { db, auth } from '../core.js';
import { 
    collection, query, where, doc, getDoc, updateDoc, onSnapshot, addDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log("Planner Module - Visual Labels Update");

let tasksCache = [];
let draggingTask = null;
let currentDateView = null;
let canEdit = false;

// --- CONFIGURAÇÃO DA GRADE ---
const SLOT_HEIGHT_PX = 40;     // Altura visual de 30 minutos
const MINS_PER_SLOT = 30;
const PIXELS_PER_MIN = SLOT_HEIGHT_PX / MINS_PER_SLOT; 

const START_HOUR = 7; 
const END_HOUR = 19; 

// Elementos
const dayTimeline = document.getElementById('day-timeline');
const modalPendingList = document.getElementById('modal-pending-list');
const dayModal = document.getElementById('day-view-modal');
const quickModal = document.getElementById('quick-task-modal');
const calendarGrid = document.getElementById('calendar-grid');

let selectedSlotTime = null;
let selectedSlotDate = null;

window.addEventListener('DOMContentLoaded', async () => {
    if(localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

    auth.onAuthStateChanged(async (user) => {
        if (!user) return window.location.href = '../pages/auth.html';

        const userSnap = await getDoc(doc(db, "users", user.uid));
        const role = userSnap.exists() ? (userSnap.data().role || 'student').toLowerCase() : 'student';
        canEdit = (role === 'admin' || role === 'professor');

        initCalendarControls();
        subscribeToTasks();
        setupQuickModal();
        setupSidebarDropZone();
    });
});

/* --- LÓGICA DE VOLTAR PARA PENDENTES --- */
function setupSidebarDropZone() {
    const pendingsColumn = document.getElementById('modal-pendings-area');
    if (!canEdit || !pendingsColumn) return;

    pendingsColumn.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        pendingsColumn.classList.add('drag-over');
    });

    pendingsColumn.addEventListener('dragleave', () => pendingsColumn.classList.remove('drag-over'));

    pendingsColumn.addEventListener('drop', async (e) => {
        e.preventDefault();
        pendingsColumn.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const task = tasksCache.find(t => t.id === taskId);
        if (task && task.scheduledDate) {
            await unscheduleTask(taskId, false);
        }
    });
}

/* --- DADOS --- */
function subscribeToTasks() {
    const q = query(collection(db, "tasks"), where("status", "!=", "arquivado"));
    onSnapshot(q, (snapshot) => {
        tasksCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCalendarGrid();
        if (currentDateView) renderDayView(currentDateView);
    });
}

/* --- CALENDÁRIO MENSAL --- */
let currMonth = new Date().getMonth();
let currYear = new Date().getFullYear();

function initCalendarControls() {
    renderCalendarGrid();
    document.getElementById('prev-month').onclick = () => { currMonth--; if(currMonth<0){currMonth=11;currYear--}; renderCalendarGrid(); };
    document.getElementById('next-month').onclick = () => { currMonth++; if(currMonth>11){currMonth=0;currYear++}; renderCalendarGrid(); };
    document.getElementById('today-btn').onclick = () => { const d = new Date(); currMonth = d.getMonth(); currYear = d.getFullYear(); renderCalendarGrid(); };
    document.getElementById('close-day-view').onclick = () => { dayModal.classList.add('hidden'); currentDateView = null; };
}

function renderCalendarGrid() {
    if(!calendarGrid) return;
    calendarGrid.innerHTML = "";
    document.getElementById('current-month-display').innerText = `${currMonth+1}/${currYear}`;
    
    const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
    const firstDay = new Date(currYear, currMonth, 1).getDay();

    for(let i=0; i<firstDay; i++) calendarGrid.appendChild(document.createElement('div'));

    for(let d=1; d<=daysInMonth; d++) {
        const dateStr = `${currYear}-${String(currMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const count = tasksCache.filter(t => t.scheduledDate === dateStr).length;
        
        const el = document.createElement('div');
        el.className = 'calendar-day';
        const todayStr = new Date().toISOString().split('T')[0];
        if (dateStr === todayStr) el.classList.add('today');

        el.innerHTML = `<span class="day-number">${d}</span>${count > 0 ? `<span class="day-badge" style="background:${canEdit?'var(--color-primary)':'var(--text-secondary)'}">${count}</span>` : ''}`;
        el.onclick = () => openDayView(dateStr);
        calendarGrid.appendChild(el);
    }
}

/* --- VISÃO DO DIA (TIMELINE) --- */
function openDayView(dateStr) {
    currentDateView = dateStr;
    const [y, m, d] = dateStr.split('-');
    document.getElementById('selected-date-title').innerText = `${d}/${m}/${y}`;
    dayModal.classList.remove('hidden');
    renderDayView(dateStr);
}

function renderDayView(dateStr) {
    // 1. PENDENTES (Mantenha igual a antes)
    modalPendingList.innerHTML = "";
    const pendings = tasksCache.filter(t => !t.scheduledDate && t.status !== 'concluido');
    
    pendings.forEach(task => {
        // ... (código da lista de pendentes mantém igual) ...
        // Para economizar espaço aqui na resposta, vou focar na parte 3 (Agendadas)
        // Mas certifique-se de manter o código da parte 1 que você já tem.
        const card = document.createElement('div');
        let colorClass = 'task-blue';
        if (task.type === 'biopsia') colorClass = 'task-pink';
        if (task.type === 'necropsia') colorClass = 'task-blue';
        card.className = `planner-task-card ${colorClass}`;
        card.draggable = canEdit;
        const icon = task.type === 'necropsia' ? '<i class="fas fa-skull"></i>' : '<i class="fas fa-microscope"></i>';
        card.innerHTML = `<div style="font-weight:700;">${icon} ${task.protocolo || 'Task'}</div><small>${task.animalNome || ''}</small>`;
        card.addEventListener('dragstart', (e) => {
            draggingTask = task;
            e.dataTransfer.setData('text/plain', task.id);
            e.dataTransfer.effectAllowed = "move";
        });
        modalPendingList.appendChild(card);
    });

    // 2. TIMELINE (Mantenha igual)
    dayTimeline.innerHTML = "";
    for (let h = START_HOUR; h < END_HOUR; h++) {
        createTimelineSlot(h, '00', dateStr);
        createTimelineSlot(h, '30', dateStr);
    }

    // 3. TAREFAS AGENDADAS (AQUI ESTÁ A MUDANÇA)
    const scheduled = tasksCache.filter(t => t.scheduledDate === dateStr);
    
    scheduled.forEach(task => {
        const startHour = parseInt(task.scheduledTime.split(':')[0]);
        const startMin = parseInt(task.scheduledTime.split(':')[1] || '0');
        const minutesFromStart = (startHour - START_HOUR) * 60 + startMin;
        const topPos = minutesFromStart * PIXELS_PER_MIN;
        const duration = task.duration || 60;
        const height = duration * PIXELS_PER_MIN;

        const taskEl = document.createElement('div');
        
        // Determina Tipo e Cor
        const isNecro = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        const isBio = (task.type === 'biopsia') || (!task.type && task.k7Color === 'rosa');

        let colorClass = 'task-blue';
        let typeLabel = ''; // Texto do Tipo

        if (task.customColor) {
            colorClass = task.customColor;
            typeLabel = 'TAREFA'; // Para tarefas manuais
        } else if (isBio) {
            colorClass = 'task-pink';
            typeLabel = 'BIÓPSIA';
        } else if (isNecro) {
            colorClass = 'task-blue';
            typeLabel = 'NECROPSIA';
        }

        taskEl.className = `scheduled-task ${colorClass}`;
        taskEl.style.top = `${topPos}px`;
        taskEl.style.height = `${height}px`;

        taskEl.draggable = canEdit;
        if(canEdit) {
            taskEl.addEventListener('dragstart', (e) => {
                draggingTask = task;
                e.dataTransfer.setData('text/plain', task.id);
                e.dataTransfer.effectAllowed = "move";
                taskEl.classList.add('dragging');
            });
            taskEl.addEventListener('dragend', () => taskEl.classList.remove('dragging'));
        }

        const endTime = addMinutes(task.scheduledTime, duration);

        // --- HTML ALTERADO COM O BADGE ---
        taskEl.innerHTML = `
            <div class="task-content">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span class="task-time">${task.scheduledTime} - ${endTime}</span>
                    ${typeLabel ? `<span class="task-type-badge">${typeLabel}</span>` : ''}
                </div>
                <span class="task-title">${task.protocolo || 'Sem Título'}</span>
            </div>
            ${canEdit ? '<div class="resize-handle"></div>' : ''}
            ${canEdit ? '<button class="task-remove-btn"><i class="fas fa-times"></i></button>' : ''}
        `;

        if (canEdit) {
            taskEl.querySelector('.task-remove-btn').onclick = (e) => { e.stopPropagation(); unscheduleTask(task.id, true); };
            const handle = taskEl.querySelector('.resize-handle');
            initResizeLogic(handle, taskEl, task);
        }

        dayTimeline.appendChild(taskEl);
    });
}

function createTimelineSlot(hour, minutes, dateStr) {
    const timeLabel = `${String(hour).padStart(2,'0')}:${minutes}`;
    
    const slot = document.createElement('div');
    slot.className = `time-slot ${minutes === '30' ? 'half-hour' : ''}`;
    slot.dataset.time = timeLabel;
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'slot-label';
    labelDiv.innerText = timeLabel; 
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'slot-content';
    contentDiv.dataset.time = timeLabel;

    if (canEdit) {
        contentDiv.addEventListener('click', (e) => {
            if (e.target === contentDiv) openQuickTaskModal(dateStr, timeLabel);
        });
        
        contentDiv.addEventListener('dragover', (e) => {
            e.preventDefault();
            contentDiv.classList.add('drag-over');
        });
        contentDiv.addEventListener('dragleave', () => contentDiv.classList.remove('drag-over'));
        
        contentDiv.addEventListener('drop', async (e) => {
            e.preventDefault();
            contentDiv.classList.remove('drag-over');
            if (draggingTask) {
                await scheduleTask(draggingTask.id, dateStr, timeLabel, draggingTask.duration || 60);
                draggingTask = null;
            }
        });
    }

    slot.appendChild(labelDiv);
    slot.appendChild(contentDiv);
    dayTimeline.appendChild(slot);
}

function initResizeLogic(handle, element, task) {
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        element.classList.add('resizing');
        const startY = e.clientY;
        
        function doDrag(e) {
            let newHeight = parseInt(element.style.height, 10) + (e.movementY);
            if (newHeight < (SLOT_HEIGHT_PX/2)) newHeight = (SLOT_HEIGHT_PX/2);
            element.style.height = newHeight + 'px';
        }

        function stopDrag(e) {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
            element.classList.remove('resizing');

            let finalHeightPx = parseInt(element.style.height, 10);
            let snappedHeightPx = Math.round(finalHeightPx / SLOT_HEIGHT_PX) * SLOT_HEIGHT_PX;
            if (snappedHeightPx < SLOT_HEIGHT_PX) snappedHeightPx = SLOT_HEIGHT_PX;

            element.style.height = snappedHeightPx + 'px';
            const newDurationMins = Math.round(snappedHeightPx / PIXELS_PER_MIN);
            updateTaskDuration(task.id, newDurationMins);
        }

        document.documentElement.addEventListener('mousemove', doDrag, false);
        document.documentElement.addEventListener('mouseup', stopDrag, false);
    }, false);
}

function openQuickTaskModal(date, time) {
    selectedSlotDate = date;
    selectedSlotTime = time;
    document.getElementById('quick-task-title').value = "";
    document.getElementById('quick-task-desc').value = "";
    document.querySelector('input[name="taskColor"][value="task-blue"]').checked = true;
    quickModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('quick-task-title').focus(), 100);
}

function setupQuickModal() {
    document.getElementById('cancel-quick-task').onclick = () => quickModal.classList.add('hidden');
    document.getElementById('save-quick-task').onclick = async () => {
        const title = document.getElementById('quick-task-title').value;
        const desc = document.getElementById('quick-task-desc').value;
        const colorInput = document.querySelector('input[name="taskColor"]:checked');
        const color = colorInput ? colorInput.value : 'task-blue';

        if (!title) return alert("Digite um título.");
        try {
            await addDoc(collection(db, "tasks"), {
                protocolo: title,
                animalNome: desc,
                status: 'agendado',
                scheduledDate: selectedSlotDate,
                scheduledTime: selectedSlotTime,
                duration: 60,
                createdAt: new Date().toISOString(),
                type: 'agendamento_rapido',
                customColor: color 
            });
            quickModal.classList.add('hidden');
        } catch (e) { console.error(e); }
    };
}

function addMinutes(time, minsToAdd) {
    const [h, m] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m + minsToAdd);
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

async function scheduleTask(id, date, time, duration) {
    await updateDoc(doc(db, "tasks", id), {
        scheduledDate: date,
        scheduledTime: time,
        duration: duration,
        updatedAt: new Date().toISOString()
    });
}

async function unscheduleTask(id, confirmAction) {
    if(confirmAction && !confirm("Desagendar tarefa?")) return;
    await updateDoc(doc(db, "tasks", id), {
        scheduledDate: null,
        scheduledTime: null,
        duration: null
    });
}

async function updateTaskDuration(id, minutes) {
    await updateDoc(doc(db, "tasks", id), { duration: minutes });
}