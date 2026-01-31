import { db, auth } from '../core.js';
import { collection, query, where, onSnapshot, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// Elementos
const columns = {
    clivagem: document.getElementById('col-clivagem'),
    processamento: document.getElementById('col-processamento'),
    emblocamento: document.getElementById('col-emblocamento'),
    corte: document.getElementById('col-corte'),
    coloracao: document.getElementById('col-coloracao'),
    analise: document.getElementById('col-analise'),
    liberar: document.getElementById('col-liberar')
};

// Wrappers (para aplicar estilo active-col no mobile)
const columnWrappers = [
    document.getElementById('col-wrap-clivagem'),
    document.getElementById('col-wrap-processamento'),
    document.getElementById('col-wrap-emblocamento'),
    document.getElementById('col-wrap-corte'),
    document.getElementById('col-wrap-coloracao'),
    document.getElementById('col-wrap-analise'),
    document.getElementById('col-wrap-liberar')
];

const counters = {
    clivagem: document.getElementById('count-clivagem'),
    processamento: document.getElementById('count-processamento'),
    emblocamento: document.getElementById('count-emblocamento'),
    corte: document.getElementById('count-corte'),
    coloracao: document.getElementById('count-coloracao'),
    analise: document.getElementById('count-analise'),
    liberar: document.getElementById('count-liberar')
};

const totalNecro = document.getElementById('total-necropsias');
const totalBio = document.getElementById('total-biopsias');
const filterContainer = document.getElementById('filter-container');
const btnAll = document.getElementById('filter-all');
const btnMine = document.getElementById('filter-mine');

// Elementos UI Mobile
const kanbanBoard = document.getElementById('kanban-board');
const dotsContainer = document.getElementById('carousel-dots');

let currentFilter = 'all'; 
let allTasks = []; 
let currentUserRole = null;
let currentUserName = null;

// --- INICIALIZAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            currentUserRole = (data.role || '').toLowerCase();
            currentUserName = data.name;

            if (currentUserRole.includes('graduando')) {
                filterContainer.style.display = 'flex';
            } else {
                filterContainer.style.display = 'none';
            }
        }
        initBoard();
        initMobileCarousel();
        initDesktopScroll(); // Ativa scroll horizontal com roda do mouse
    } else {
        window.location.href = '../auth.html'; 
    }
});

function initBoard() {
    const q = query(
        collection(db, "tasks"), 
        where("status", "!=", "concluido"),
        orderBy("status"), 
        orderBy("createdAt", "desc")
    );
    
    onSnapshot(q, (snapshot) => {
        allTasks = [];
        snapshot.forEach(doc => {
            allTasks.push({ id: doc.id, ...doc.data() });
        });
        renderBoard();
    });
}

function renderBoard() {
    Object.values(columns).forEach(col => col.innerHTML = '');
    Object.values(counters).forEach(span => span.textContent = '0');
    
    let countNecro = 0;
    let countBio = 0;
    const counts = { clivagem: 0, processamento: 0, emblocamento: 0, corte: 0, coloracao: 0, analise: 0, liberar: 0 };

    allTasks.forEach(task => {
        if (task.status === 'concluido' || task.status === 'arquivado') return;

        const isNecropsia = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        if (isNecropsia) countNecro++; else countBio++;

        if (currentFilter === 'mine') {
            const isMine = (task.docente === currentUserName) || (task.posGraduando === currentUserName);
            if (!isMine) return; 
        }

        const status = task.status;
        const col = columns[status];

        if (col) {
            const card = document.createElement('div');
            const k7Class = task.k7Color ? `k7-${task.k7Color}` : '';
            card.className = `mural-card ${k7Class}`;
            card.onclick = () => window.openTaskManager(task.id);
            
            const displayProtocol = task.protocolo || task.accessCode || "---";
            const shortPos = getShortName(task.posGraduando || "Sem Pós");
            const typeLabel = isNecropsia ? 'NECROPSIA' : 'BIÓPSIA';
            const typeColor = isNecropsia ? '#3b82f6' : '#ec4899';

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <span style="font-weight:800; font-size:0.95rem; color:var(--color-primary);">
                        ${displayProtocol}
                    </span>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <span class="mural-tag" style="color: ${typeColor}; border: 1px solid ${typeColor}40; font-weight:800; font-size:0.65rem;">
                            ${typeLabel}
                        </span>
                        ${task.k7Quantity ? `<span class="mural-tag" style="font-weight:600;">${task.k7Quantity} K7</span>` : ''}
                    </div>
                </div>
                <div style="font-size:0.9rem; margin-top:8px; font-weight:700; color:var(--text-primary); line-height:1.2;">
                    ${task.animalNome || 'Sem Nome'}
                </div>
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px; text-transform:uppercase; font-weight:600;">
                    ${task.especie || ''}
                </div>
                <div style="margin-top:10px; display:flex; gap:6px; align-items:center; font-size:0.75rem; color:var(--text-tertiary);">
                    <i class="fas fa-user-graduate"></i> ${shortPos}
                </div>
            `;
            col.appendChild(card);
            if (counts[status] !== undefined) counts[status]++;
        }
    });

    for (const key in counts) {
        if (counters[key]) counters[key].textContent = counts[key];
    }
    if(totalNecro) totalNecro.textContent = countNecro;
    if(totalBio) totalBio.textContent = countBio;
}

// --- LÓGICA DO CARROSSEL MOBILE ---
function initMobileCarousel() {
    if(!dotsContainer || !kanbanBoard) return;
    
    // Cria as bolinhas (dots)
    dotsContainer.innerHTML = '';
    columnWrappers.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = index === 0 ? 'dot active' : 'dot';
        dotsContainer.appendChild(dot);
    });

    // Evento de Scroll Mobile (Sincroniza bolinhas)
    kanbanBoard.addEventListener('scroll', () => {
        // Verifica se é mobile (snap ativo)
        if (window.innerWidth >= 1024) return;

        const scrollLeft = kanbanBoard.scrollLeft;
        const colWidth = columnWrappers[0].offsetWidth + 15; 
        const activeIndex = Math.round(scrollLeft / colWidth);

        const dots = document.querySelectorAll('.dot');
        dots.forEach((d, i) => {
            if (i === activeIndex) d.classList.add('active');
            else d.classList.remove('active');
        });

        columnWrappers.forEach((col, i) => {
            if (i === activeIndex) col.classList.add('active-col');
            else col.classList.remove('active-col');
        });
    });
}

// --- LÓGICA DESKTOP (SCROLL HORIZONTAL COM RODA) ---
function initDesktopScroll() {
    if(!kanbanBoard) return;
    
    kanbanBoard.addEventListener("wheel", (evt) => {
        // Apenas se for desktop (>=1024px) e scroll vertical (deltaY)
        if (window.innerWidth >= 1024 && evt.deltaY !== 0) {
            evt.preventDefault();
            kanbanBoard.scrollLeft += evt.deltaY;
        }
    });
}

// Filtros
if(btnAll) btnAll.addEventListener('click', () => {
    currentFilter = 'all';
    btnAll.classList.replace('btn-secondary', 'btn-primary');
    btnMine.classList.replace('btn-primary', 'btn-secondary');
    renderBoard();
});

if(btnMine) btnMine.addEventListener('click', () => {
    currentFilter = 'mine';
    btnMine.classList.replace('btn-secondary', 'btn-primary');
    btnAll.classList.replace('btn-primary', 'btn-secondary');
    renderBoard();
});

function getShortName(fullName) {
    if (!fullName) return '-';
    const parts = fullName.split(' ');
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0]}.`;
}