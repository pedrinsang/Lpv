import { db, auth } from '../core.js';
import { 
    collection, query, where, doc, getDoc, updateDoc, deleteDoc, onSnapshot, addDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log("Planner Module - Auto-Resize on Drop Fix");

let tasksCache = [];
let draggingTask = null;
let currentDateView = null;
let canEdit = false;

// --- CONFIGURAÇÃO ---
const SLOT_HEIGHT_PX = 40;     
const MINS_PER_SLOT = 30;
const PIXELS_PER_MIN = SLOT_HEIGHT_PX / MINS_PER_SLOT; 

const START_HOUR = 8; 
const END_HOUR = 18; 

// Elementos DOM
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
        
        const tasksForDay = tasksCache.filter(t => t.scheduledDate === dateStr);
        tasksForDay.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
        const count = tasksForDay.length;
        
        const el = document.createElement('div');
        el.className = 'calendar-day';
        const todayStr = new Date().toISOString().split('T')[0];
        if (dateStr === todayStr) el.classList.add('today');

        let detailsHtml = '';
        if (count > 0) {
            detailsHtml = `<div class="day-tasks-preview">`;
            tasksForDay.slice(0, 5).forEach(t => {
                let colorClass = 'task-blue';
                if (t.customColor) colorClass = t.customColor;
                else if (t.type === 'biopsia') colorClass = 'task-pink';
                else if (t.type === 'necropsia') colorClass = 'task-blue';

                const endTime = addMinutes(t.scheduledTime, t.duration || 60);

                detailsHtml += `
                    <div class="preview-task-item ${colorClass}">
                        <span style="font-weight:bold; margin-right:5px; font-size:0.6rem; min-width:65px;">${t.scheduledTime} - ${endTime}</span> 
                        <span>${t.protocolo}</span>
                    </div>
                `;
            });
            if (count > 5) detailsHtml += `<div style="font-size:0.6rem; color:var(--text-tertiary); text-align:center;">+${count - 5} mais</div>`;
            detailsHtml += `</div>`;
        }

        el.innerHTML = `
            <span class="day-number">${d}</span>
            ${count > 0 ? `<span class="day-badge" style="background:${canEdit?'var(--color-primary)':'var(--text-secondary)'}">${count}</span>` : ''}
            ${detailsHtml}
        `;
        
        el.onclick = () => openDayView(dateStr);
        calendarGrid.appendChild(el);
    }
}

/* --- VISÃO DO DIA --- */
function openDayView(dateStr) {
    currentDateView = dateStr;
    const [y, m, d] = dateStr.split('-');
    document.getElementById('selected-date-title').innerText = `${d}/${m}/${y}`;
    dayModal.classList.remove('hidden');
    renderDayView(dateStr);
}

function renderDayView(dateStr) {
    // 1. PENDENTES
    modalPendingList.innerHTML = "";
    const pendings = tasksCache.filter(t => !t.scheduledDate && t.status !== 'concluido');
    
    pendings.forEach(task => {
        const card = document.createElement('div');
        
        const isNecro = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        const isBio = (task.type === 'biopsia') || (!task.type && task.k7Color === 'rosa');
        
        let colorClass = 'task-blue';
        let typeLabel = 'TAREFA';
        let typeColor = 'var(--text-secondary)';
        
        if (isBio) { colorClass = 'task-pink'; typeLabel = 'BIÓPSIA'; typeColor = '#ec4899'; }
        else if (isNecro) { colorClass = 'task-blue'; typeLabel = 'NECROPSIA'; typeColor = '#3b82f6'; }
        else if (task.customColor) { colorClass = task.customColor; typeLabel = 'OUTRO'; }
        
        card.className = `planner-task-card ${colorClass}`;
        card.draggable = canEdit;
        
        const icon = isNecro ? '<i class="fas fa-skull"></i>' : (isBio ? '<i class="fas fa-microscope"></i>' : '<i class="fas fa-tasks"></i>');
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                <span style="font-weight:800; font-size:0.9rem;">${icon} ${task.protocolo || 'Task'}</span>
                <span style="font-size:0.6rem; font-weight:800; padding:2px 6px; border-radius:4px; border:1px solid ${typeColor}; color:${typeColor}; opacity:0.9;">
                    ${typeLabel}
                </span>
            </div>
            <div style="font-size:0.85rem; opacity:0.8; line-height:1.2;">${task.animalNome || ''}</div>
            
            ${canEdit ? `<button class="btn-delete-task" title="Excluir Definitivamente"><i class="fas fa-trash-alt"></i></button>` : ''}
        `;
        
        card.addEventListener('dragstart', (e) => {
            draggingTask = task;
            e.dataTransfer.setData('text/plain', task.id);
            e.dataTransfer.effectAllowed = "move";
            setTimeout(() => card.classList.add('dragging'), 0);
        });

        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        if (canEdit) {
            const btnDelete = card.querySelector('.btn-delete-task');
            if(btnDelete) {
                btnDelete.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteTask(task.id, task.protocolo);
                });
            }
        }

        modalPendingList.appendChild(card);
    });

    // 2. TIMELINE
    dayTimeline.innerHTML = "";
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        createTimelineSlot(h, '00', dateStr);
        if (h !== END_HOUR) createTimelineSlot(h, '30', dateStr);
    }

    // 3. AGENDADOS
    const scheduled = tasksCache.filter(t => t.scheduledDate === dateStr);
    
    scheduled.forEach(task => {
        const startHour = parseInt(task.scheduledTime.split(':')[0]);
        const startMin = parseInt(task.scheduledTime.split(':')[1] || '0');
        const minutesFromStart = (startHour - START_HOUR) * 60 + startMin;
        const topPos = minutesFromStart * PIXELS_PER_MIN;
        const duration = task.duration || 60;
        const height = duration * PIXELS_PER_MIN;

        const taskEl = document.createElement('div');
        
        const isNecro = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        const isBio = (task.type === 'biopsia') || (!task.type && task.k7Color === 'rosa');

        let colorClass = 'task-blue';
        let typeLabel = '';

        if (task.customColor) { colorClass = task.customColor; typeLabel = 'TAREFA'; } 
        else if (isBio) { colorClass = 'task-pink'; typeLabel = 'BIÓPSIA'; } 
        else if (isNecro) { colorClass = 'task-blue'; typeLabel = 'NECROPSIA'; }

        taskEl.className = `scheduled-task ${colorClass}`;
        taskEl.style.top = `${topPos}px`;
        taskEl.style.height = `${height}px`;

        taskEl.draggable = canEdit;
        if(canEdit) {
            taskEl.addEventListener('dragstart', (e) => {
                draggingTask = task;
                e.dataTransfer.setData('text/plain', task.id);
                e.dataTransfer.effectAllowed = "move";
                setTimeout(() => taskEl.classList.add('dragging'), 0);
            });
            taskEl.addEventListener('dragend', () => taskEl.classList.remove('dragging'));
        }

        const endTime = addMinutes(task.scheduledTime, duration);

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

// --- FUNÇÕES DE SUPORTE ---

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
        if(!taskId) return;
        const task = tasksCache.find(t => t.id === taskId);
        if (task && task.scheduledDate) await unscheduleTask(taskId, false);
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
        
        // --- EVENTO DROP MODIFICADO (AUTO-RESIZE) ---
        contentDiv.addEventListener('drop', async (e) => {
            e.preventDefault();
            contentDiv.classList.remove('drag-over');
            
            if (draggingTask) {
                // Duração original
                const duration = draggingTask.duration || 60;
                
                // Converte Slot (Início) em minutos
                const [slotH, slotM] = timeLabel.split(':').map(Number);
                const startMins = slotH * 60 + slotM;
                const endMins = startMins + duration;
                
                // Limite do dia (18:00 = 1080 min)
                const limitMins = END_HOUR * 60;

                // NOVA LÓGICA: Se passar do limite, corta.
                let finalDuration = duration;
                if (endMins > limitMins) {
                    finalDuration = limitMins - startMins;
                }

                // Segurança: Se tentar soltar EXATAMENTE às 18:00 (duração 0 ou negativa)
                if (finalDuration <= 0) {
                    alert("Não é possível iniciar uma tarefa no horário de encerramento.");
                    return;
                }

                await scheduleTask(draggingTask.id, dateStr, timeLabel, finalDuration);
                draggingTask = null;
            }
        });
    }

    slot.appendChild(labelDiv);
    slot.appendChild(contentDiv);
    dayTimeline.appendChild(slot);
}

// --- REDIMENSIONAMENTO COM LIMITE ---
function initResizeLogic(handle, element, task) {
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation();
        element.classList.add('resizing');
        
        function doDrag(e) {
            let newHeight = parseInt(element.style.height, 10) + (e.movementY);
            if (newHeight < (SLOT_HEIGHT_PX/2)) newHeight = (SLOT_HEIGHT_PX/2);
            
            // Validação de Limite no Resize
            const currentTop = element.offsetTop;
            const maxTimelineHeight = (END_HOUR - START_HOUR) * 60 * PIXELS_PER_MIN;
            
            if (currentTop + newHeight > maxTimelineHeight) {
                newHeight = maxTimelineHeight - currentTop;
            }
            
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
                protocolo: title, animalNome: desc, status: 'agendado',
                scheduledDate: selectedSlotDate, scheduledTime: selectedSlotTime, duration: 60,
                createdAt: new Date().toISOString(), type: 'agendamento_rapido', customColor: color 
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
        scheduledDate: date, scheduledTime: time, duration: duration, updatedAt: new Date().toISOString()
    });
}

async function unscheduleTask(id, confirmAction) {
    if(confirmAction && !confirm("Desagendar tarefa? (Ela voltará para Pendentes)")) return;
    await updateDoc(doc(db, "tasks", id), { scheduledDate: null, scheduledTime: null, duration: null });
}

async function updateTaskDuration(id, minutes) {
    await updateDoc(doc(db, "tasks", id), { duration: minutes });
}

async function deleteTask(id, title) {
    if(confirm(`Tem certeza que deseja excluir "${title}" permanentemente?`)) {
        try { await deleteDoc(doc(db, "tasks", id)); } 
        catch (e) { console.error(e); alert("Erro ao excluir."); }
    }
}