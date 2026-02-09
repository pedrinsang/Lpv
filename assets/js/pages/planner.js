import { db, auth } from '../core.js';
import { 
    collection, query, where, doc, getDoc, updateDoc, deleteDoc, onSnapshot, addDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

console.log("Planner Module - Floating Glass Design");

let tasksCache = [];
let draggingTask = null;
let currentDateView = null;
let canEdit = false;

const SLOT_HEIGHT_PX = 50;     
const MINS_PER_SLOT = 30;
const PIXELS_PER_MIN = SLOT_HEIGHT_PX / MINS_PER_SLOT; 
const START_HOUR = 8; 
const END_HOUR = 18; 
const TIMELINE_PADDING_TOP = 20; // O SEGREDO DO ALINHAMENTO (Igual ao CSS)

const dayTimeline = document.getElementById('day-timeline');
const modalPendingList = document.getElementById('modal-pending-list');
const dayModal = document.getElementById('day-view-modal');
const quickModal = document.getElementById('quick-task-modal');
const calendarGrid = document.getElementById('calendar-grid');

let selectedSlotTime = null;
let selectedSlotDate = null;

window.addEventListener('DOMContentLoaded', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');

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

function subscribeToTasks() {
    const q = query(collection(db, "tasks"), where("status", "!=", "arquivado"));
    onSnapshot(q, (snapshot) => {
        tasksCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCalendarGrid();
        if (currentDateView) renderDayView(currentDateView);
    });
}

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
    
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const monthEl = document.getElementById('calendar-month');
    const yearEl = document.getElementById('calendar-year');
    if(monthEl) monthEl.innerText = monthNames[currMonth];
    if(yearEl) yearEl.innerText = currYear;
    
    const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
    const firstDay = new Date(currYear, currMonth, 1).getDay();

    for(let i=0; i<firstDay; i++) calendarGrid.appendChild(document.createElement('div'));

    for(let d=1; d<=daysInMonth; d++) {
        const dateStr = `${currYear}-${String(currMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const tasksForDay = tasksCache.filter(t => t.scheduledDate === dateStr);
        tasksForDay.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
        
        // Contagem de Cores
        let countNecro = 0, countBio = 0, countOther = 0;
        tasksForDay.forEach(t => {
            if ((t.type === 'necropsia') || (!t.type && t.k7Color === 'azul')) countNecro++;
            else if ((t.type === 'biopsia') || (!t.type && t.k7Color === 'rosa')) countBio++;
            else countOther++;
        });

        // Barra de Densidade
        let densityBarHtml = '';
        if (tasksForDay.length > 0) {
            const necroSegment = countNecro > 0 ? `<div class="density-segment necro" style="flex:${countNecro}"></div>` : '';
            const bioSegment = countBio > 0 ? `<div class="density-segment bio" style="flex:${countBio}"></div>` : '';
            const otherSegment = countOther > 0 ? `<div class="density-segment other" style="flex:${countOther}"></div>` : '';
            densityBarHtml = `<div class="task-density-bar">${necroSegment}${bioSegment}${otherSegment}</div>`;
        }

        // Preview Pop-up
        let detailsHtml = '';
        if (tasksForDay.length > 0) {
            detailsHtml = `<div class="day-tasks-preview">`;
            tasksForDay.slice(0, 5).forEach(t => {
                let colorClass = 'task-other';
                if ((t.type === 'biopsia') || (!t.type && t.k7Color === 'rosa')) colorClass = 'task-pink';
                else if ((t.type === 'necropsia') || (!t.type && t.k7Color === 'azul')) colorClass = 'task-blue';

                const endTime = addMinutes(t.scheduledTime, t.duration || 60);
                detailsHtml += `
                    <div class="preview-task-item ${colorClass}">
                        <span>${t.scheduledTime} - ${endTime}</span> 
                        <span style="max-width:50px; overflow:hidden; text-overflow:ellipsis;">${t.protocolo}</span>
                    </div>`;
            });
            if (tasksForDay.length > 5) detailsHtml += `<div style="font-size:0.6rem; text-align:center; color:#999;">+${tasksForDay.length - 5} mais</div>`;
            detailsHtml += `</div>`;
        }

        const el = document.createElement('div');
        el.className = 'calendar-day';
        if (dateStr === new Date().toISOString().split('T')[0]) el.classList.add('today');

        el.innerHTML = `
            <div class="day-number">${d}</div>
            ${densityBarHtml}
            ${detailsHtml}
        `;
        
        el.onclick = () => openDayView(dateStr);
        calendarGrid.appendChild(el);
    }

    // Legenda
    let legend = document.getElementById('calendar-legend');
    if (!legend) {
        legend = document.createElement('div');
        legend.id = 'calendar-legend';
        legend.className = 'calendar-legend-container';
        legend.innerHTML = `
            <div class="legend-item"><div class="legend-dot blue"></div> Necropsia</div>
            <div class="legend-item"><div class="legend-dot pink"></div> Biópsia</div>
            <div class="legend-item"><div class="legend-dot gray"></div> Outros</div>
        `;
        calendarGrid.parentNode.appendChild(legend);
    }
}

function openDayView(dateStr) {
    currentDateView = dateStr;
    const [y, m, d] = dateStr.split('-');
    const dateObj = new Date(y, m-1, d);
    document.getElementById('selected-date-title').innerText = dateObj.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', weekday: 'long' });
    dayModal.classList.remove('hidden');
    renderDayView(dateStr);
}

function renderDayView(dateStr) {
    modalPendingList.innerHTML = "";
    const pendings = tasksCache.filter(t => !t.scheduledDate && t.status !== 'concluido');
    
    // Renderiza Pendentes (Sem alterações)
    pendings.forEach(task => {
        const card = document.createElement('div');
        let colorClass = 'task-other';
        let typeLabel = 'GERAL';
        
        if ((task.type === 'biopsia') || (!task.type && task.k7Color === 'rosa')) { colorClass = 'task-pink'; typeLabel = 'BIO'; }
        else if ((task.type === 'necropsia') || (!task.type && task.k7Color === 'azul')) { colorClass = 'task-blue'; typeLabel = 'NECRO'; }
        
        card.className = `planner-task-card ${colorClass}`;
        card.draggable = canEdit;
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <span style="font-weight:700; font-size:0.9rem; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${task.protocolo || 'Sem Título'}</span>
                <span style="font-size:0.65rem; font-weight:700; color:var(--text-secondary); background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px;">${typeLabel}</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); line-height:1.3; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${task.animalNome || ''}</div>
            ${canEdit ? `<button class="btn-delete-task" title="Excluir"><i class="fas fa-trash-alt"></i></button>` : ''}
        `;
        
        card.addEventListener('dragstart', (e) => {
            draggingTask = task;
            e.dataTransfer.setData('text/plain', task.id);
            setTimeout(() => card.classList.add('dragging'), 0);
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        if(canEdit) {
            const btn = card.querySelector('.btn-delete-task');
            if(btn) btn.onclick = (e) => { e.stopPropagation(); deleteTask(task.id, task.protocolo); };
            initPendingTouchDrag(card, task, dateStr);
        }
        modalPendingList.appendChild(card);
    });

    // Renderiza Slots
    dayTimeline.innerHTML = "";
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        createTimelineSlot(h, '00', dateStr);
        if (h !== END_HOUR) createTimelineSlot(h, '30', dateStr);
    }

    // Renderiza Agendados (COM CORREÇÃO DE POSIÇÃO)
    const scheduled = tasksCache.filter(t => t.scheduledDate === dateStr);
    scheduled.forEach(task => {
        const startHour = parseInt(task.scheduledTime.split(':')[0]);
        const startMin = parseInt(task.scheduledTime.split(':')[1] || '0');
        const minutesFromStart = (startHour - START_HOUR) * 60 + startMin;
        
        // --- CORREÇÃO MATEMÁTICA ---
        const topPos = (minutesFromStart * PIXELS_PER_MIN) + TIMELINE_PADDING_TOP;
        // ---------------------------
        
        const duration = task.duration || 60;
        const height = (duration * PIXELS_PER_MIN) - 1; // -1px para ver a linha da próxima hora

        let colorClass = 'task-other';
        let typeLabel = '';
        if ((task.type === 'biopsia') || (!task.type && task.k7Color === 'rosa')) { colorClass = 'task-pink'; typeLabel = 'BIO'; }
        else if ((task.type === 'necropsia') || (!task.type && task.k7Color === 'azul')) { colorClass = 'task-blue'; typeLabel = 'NECRO'; }

        const taskEl = document.createElement('div');
        taskEl.className = `scheduled-task ${colorClass}`;
        taskEl.style.top = `${topPos}px`;
        taskEl.style.height = `${height}px`;

        const endTime = addMinutes(task.scheduledTime, duration);
        
        taskEl.innerHTML = `
            <div class="task-content">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="task-time">${task.scheduledTime} - ${endTime}</span>
                    <span class="task-type-badge" style="background:rgba(255,255,255,0.2); border-radius:4px; padding:1px 4px; font-size:0.6rem; font-weight:700;">${typeLabel}</span>
                </div>
                <span class="task-title">${task.protocolo}</span>
            </div>
            ${canEdit ? '<div class="resize-handle"></div><button class="task-remove-btn" style="position:absolute; top:2px; right:2px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,0.2); color:white; display:flex; justify-content:center; align-items:center; cursor:pointer;"><i class="fas fa-times" style="font-size:0.7rem;"></i></button>' : ''}
        `;

        if(canEdit) {
            taskEl.draggable = true;
            taskEl.addEventListener('dragstart', (e) => {
                draggingTask = task;
                e.dataTransfer.setData('text/plain', task.id);
                setTimeout(() => taskEl.classList.add('dragging'), 0);
            });
            taskEl.addEventListener('dragend', () => taskEl.classList.remove('dragging'));
            
            const removeBtn = taskEl.querySelector('.task-remove-btn');
            if(removeBtn) removeBtn.onclick = (e) => { e.stopPropagation(); unscheduleTask(task.id, true); };
            
            const handle = taskEl.querySelector('.resize-handle');
            initResizeLogic(handle, taskEl, task);
            initTouchDragLogic(taskEl, task, dateStr);
        }
        dayTimeline.appendChild(taskEl);
    });
}

// ... (Funções auxiliares createTimelineSlot, initResizeLogic, etc mantêm iguais ao anterior) ...
// (Para economizar espaço, use as mesmas funções da resposta anterior, elas são compatíveis)
function setupSidebarDropZone() {
    const pendingsColumn = document.getElementById('modal-pendings-area');
    if (!canEdit || !pendingsColumn) return;
    pendingsColumn.addEventListener('dragover', (e) => { e.preventDefault(); pendingsColumn.classList.add('drag-over'); });
    pendingsColumn.addEventListener('dragleave', () => pendingsColumn.classList.remove('drag-over'));
    pendingsColumn.addEventListener('drop', async (e) => {
        e.preventDefault(); pendingsColumn.classList.remove('drag-over');
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
        contentDiv.addEventListener('click', (e) => { if (e.target === contentDiv) openQuickTaskModal(dateStr, timeLabel); });
        contentDiv.addEventListener('dragover', (e) => { e.preventDefault(); contentDiv.classList.add('drag-over'); });
        contentDiv.addEventListener('dragleave', () => contentDiv.classList.remove('drag-over'));
        
        contentDiv.addEventListener('drop', async (e) => {
            e.preventDefault(); contentDiv.classList.remove('drag-over');
            if (draggingTask) {
                const duration = draggingTask.duration || 60;
                const [slotH, slotM] = timeLabel.split(':').map(Number);
                const startMins = slotH * 60 + slotM;
                const endMins = startMins + duration;
                const limitMins = END_HOUR * 60;

                let finalDuration = duration;
                if (endMins > limitMins) finalDuration = limitMins - startMins;
                if (finalDuration <= 0) return;

                await scheduleTask(draggingTask.id, dateStr, timeLabel, finalDuration);
                draggingTask = null;
            }
        });
    }
    slot.appendChild(labelDiv); slot.appendChild(contentDiv); dayTimeline.appendChild(slot);
}

function initResizeLogic(handle, element, task) {
    function startResize(startY) {
        element.setAttribute('draggable', 'false');
        element.classList.add('resizing-active');
        const startHeight = parseInt(element.style.height, 10);

        function calcHeight(currentY) {
            let newHeight = startHeight + (currentY - startY);
            if (newHeight < (SLOT_HEIGHT_PX/2)) newHeight = (SLOT_HEIGHT_PX/2);
            const currentTop = element.offsetTop;
            const maxTimelineHeight = ((END_HOUR - START_HOUR) * 60 * PIXELS_PER_MIN) + 20;
            if (currentTop + newHeight > maxTimelineHeight) newHeight = maxTimelineHeight - currentTop;
            element.style.height = newHeight + 'px';
        }

        function finishResize() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
            element.classList.remove('resizing-active');
            element.setAttribute('draggable', 'true');

            let finalHeightPx = parseInt(element.style.height, 10);
            let snappedHeightPx = Math.round(finalHeightPx / (SLOT_HEIGHT_PX/2)) * (SLOT_HEIGHT_PX/2);
            if (snappedHeightPx < (SLOT_HEIGHT_PX/2)) snappedHeightPx = (SLOT_HEIGHT_PX/2);
            element.style.height = snappedHeightPx + 'px';
            const newDurationMins = Math.round(snappedHeightPx / PIXELS_PER_MIN);
            updateTaskDuration(task.id, newDurationMins);
        }

        function onMouseMove(e) { calcHeight(e.clientY); }
        function onMouseUp() { finishResize(); }
        function onTouchMove(e) { e.preventDefault(); calcHeight(e.touches[0].clientY); }
        function onTouchEnd() { finishResize(); }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    handle.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation();
        startResize(e.clientY);
    }, false);

    handle.addEventListener('touchstart', function(e) {
        e.preventDefault(); e.stopPropagation();
        startResize(e.touches[0].clientY);
    }, { passive: false });
}

function initTouchDragLogic(taskEl, task, dateStr) {
    let touchStartY = 0;
    let touchStartX = 0;
    let origTop = 0;
    let isDragging = false;
    let ghost = null;
    const DRAG_THRESHOLD = 8;

    const taskContent = taskEl.querySelector('.task-content');
    const dragTarget = taskContent || taskEl;

    dragTarget.addEventListener('touchstart', function(e) {
        if (e.target.closest('.resize-handle') || e.target.closest('.task-remove-btn')) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        origTop = parseInt(taskEl.style.top, 10) || 0;
        isDragging = false;
    }, { passive: true });

    dragTarget.addEventListener('touchmove', function(e) {
        if (e.target.closest('.resize-handle') || e.target.closest('.task-remove-btn')) return;
        const deltaY = e.touches[0].clientY - touchStartY;

        if (!isDragging && Math.abs(deltaY) > DRAG_THRESHOLD) {
            isDragging = true;
            taskEl.style.opacity = '0.85';
            taskEl.style.zIndex = '100';
            taskEl.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
            // Highlight da zona de pendentes
            const pendingsCol = document.getElementById('modal-pendings-area');
            if (pendingsCol) pendingsCol.classList.add('drag-over');
        }

        if (isDragging) {
            e.preventDefault();
            let newTop = origTop + deltaY;
            const minTop = TIMELINE_PADDING_TOP;
            const maxTop = ((END_HOUR - START_HOUR) * 60 * PIXELS_PER_MIN) + TIMELINE_PADDING_TOP - parseInt(taskEl.style.height, 10);
            if (newTop < minTop) newTop = minTop;
            if (newTop > maxTop) newTop = maxTop;
            taskEl.style.top = newTop + 'px';

            // Verifica se está sobre a coluna de pendentes
            const touch = e.touches[0];
            const pendingsCol = document.getElementById('modal-pendings-area');
            if (pendingsCol) {
                const rect = pendingsCol.getBoundingClientRect();
                if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                    pendingsCol.classList.add('drag-over');
                } else {
                    pendingsCol.classList.remove('drag-over');
                }
            }
        }
    }, { passive: false });

    dragTarget.addEventListener('touchend', async function(e) {
        const pendingsCol = document.getElementById('modal-pendings-area');
        if (pendingsCol) pendingsCol.classList.remove('drag-over');

        if (!isDragging) return;

        taskEl.style.opacity = '';
        taskEl.style.zIndex = '';
        taskEl.style.boxShadow = '';

        // Verifica se soltou sobre a coluna de pendentes
        const lastTouch = e.changedTouches[0];
        if (pendingsCol) {
            const rect = pendingsCol.getBoundingClientRect();
            if (lastTouch.clientX >= rect.left && lastTouch.clientX <= rect.right && lastTouch.clientY >= rect.top && lastTouch.clientY <= rect.bottom) {
                isDragging = false;
                await unscheduleTask(task.id, false);
                return;
            }
        }

        // Snap to nearest slot na timeline
        const currentTop = parseInt(taskEl.style.top, 10);
        const minsFromStart = (currentTop - TIMELINE_PADDING_TOP) / PIXELS_PER_MIN;
        const snappedMins = Math.round(minsFromStart / MINS_PER_SLOT) * MINS_PER_SLOT;
        const snappedTop = (snappedMins * PIXELS_PER_MIN) + TIMELINE_PADDING_TOP;
        taskEl.style.top = snappedTop + 'px';

        const totalMins = (START_HOUR * 60) + snappedMins;
        const newHour = Math.floor(totalMins / 60);
        const newMin = totalMins % 60;
        const newTime = `${String(newHour).padStart(2,'0')}:${String(newMin).padStart(2,'0')}`;

        const duration = task.duration || 60;
        await scheduleTask(task.id, dateStr, newTime, duration);
        isDragging = false;
    });
}

// Touch drag para cards pendentes → timeline
function initPendingTouchDrag(card, task, dateStr) {
    let touchStartY = 0;
    let touchStartX = 0;
    let isDragging = false;
    let ghost = null;
    const DRAG_THRESHOLD = 8;

    card.addEventListener('touchstart', function(e) {
        if (e.target.closest('.btn-delete-task')) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        isDragging = false;
    }, { passive: true });

    card.addEventListener('touchmove', function(e) {
        if (e.target.closest('.btn-delete-task')) return;
        const deltaX = e.touches[0].clientX - touchStartX;
        const deltaY = e.touches[0].clientY - touchStartY;

        if (!isDragging && (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD)) {
            isDragging = true;
            draggingTask = task;
            // Cria ghost flutuante
            ghost = card.cloneNode(true);
            ghost.className = 'touch-drag-ghost';
            ghost.style.width = card.offsetWidth + 'px';
            document.body.appendChild(ghost);
            card.style.opacity = '0.3';
        }

        if (isDragging && ghost) {
            e.preventDefault();
            ghost.style.left = (e.touches[0].clientX - ghost.offsetWidth / 2) + 'px';
            ghost.style.top = (e.touches[0].clientY - 20) + 'px';

            // Highlight nos slots da timeline
            highlightSlotUnderTouch(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    card.addEventListener('touchend', async function(e) {
        if (!isDragging) return;
        card.style.opacity = '';
        clearSlotHighlights();

        if (ghost) { ghost.remove(); ghost = null; }

        const lastTouch = e.changedTouches[0];
        const dropSlot = getSlotUnderPoint(lastTouch.clientX, lastTouch.clientY);

        if (dropSlot && draggingTask) {
            const timeLabel = dropSlot.dataset.time;
            const duration = draggingTask.duration || 60;
            const [slotH, slotM] = timeLabel.split(':').map(Number);
            const startMins = slotH * 60 + slotM;
            const endMins = startMins + duration;
            const limitMins = END_HOUR * 60;

            let finalDuration = duration;
            if (endMins > limitMins) finalDuration = limitMins - startMins;
            if (finalDuration > 0) {
                await scheduleTask(draggingTask.id, dateStr, timeLabel, finalDuration);
            }
        }

        draggingTask = null;
        isDragging = false;
    });
}

function highlightSlotUnderTouch(x, y) {
    clearSlotHighlights();
    const slot = getSlotUnderPoint(x, y);
    if (slot) slot.classList.add('drag-over');
}

function clearSlotHighlights() {
    document.querySelectorAll('.slot-content.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function getSlotUnderPoint(x, y) {
    const slots = document.querySelectorAll('.slot-content');
    for (const slot of slots) {
        const rect = slot.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return slot;
        }
    }
    return null;
}

function openQuickTaskModal(date, time) {
    selectedSlotDate = date; selectedSlotTime = time;
    document.getElementById('quick-task-title').value = ""; document.getElementById('quick-task-desc').value = "";
    document.querySelector('input[name="taskColor"][value="task-blue"]').checked = true;
    quickModal.classList.remove('hidden'); setTimeout(() => document.getElementById('quick-task-title').focus(), 100);
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
    const date = new Date(); date.setHours(h, m + minsToAdd);
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

async function scheduleTask(id, date, time, duration) {
    await updateDoc(doc(db, "tasks", id), { scheduledDate: date, scheduledTime: time, duration: duration, updatedAt: new Date().toISOString() });
}

async function unscheduleTask(id, confirmAction) {
    if(confirmAction && !confirm("Desagendar tarefa?")) return;
    await updateDoc(doc(db, "tasks", id), { scheduledDate: null, scheduledTime: null, duration: null });
}

async function updateTaskDuration(id, minutes) { await updateDoc(doc(db, "tasks", id), { duration: minutes }); }

async function deleteTask(id, title) {
    if(confirm(`Tem certeza que deseja excluir "${title}"?`)) {
        try { await deleteDoc(doc(db, "tasks", id)); } catch (e) { console.error(e); alert("Erro."); }
    }
}