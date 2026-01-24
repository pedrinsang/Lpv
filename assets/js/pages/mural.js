import { db, auth } from '../core.js';
import { 
    collection, 
    query, 
    onSnapshot, 
    orderBy,
    doc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
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

const counters = {
    clivagem: document.getElementById('count-clivagem'),
    processamento: document.getElementById('count-processamento'),
    emblocamento: document.getElementById('count-emblocamento'),
    corte: document.getElementById('count-corte'),
    coloracao: document.getElementById('count-coloracao'),
    analise: document.getElementById('count-analise'),
    liberar: document.getElementById('count-liberar')
};

// Filtros
const filterContainer = document.getElementById('filter-container');
const btnAll = document.getElementById('filter-all');
const btnMine = document.getElementById('filter-mine');

let currentFilter = 'all'; 
let allTasks = []; 
let currentUserRole = null;
let currentUserName = null;

// --- INICIALIZAÇÃO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Carrega dados do usuário para saber a Role e o Nome
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            currentUserRole = data.role.toLowerCase();
            currentUserName = data.name;

            // LÓGICA DO FILTRO: APENAS PÓS-GRADUANDOS VEEM
            if (currentUserRole === 'pós graduando' || currentUserRole === 'pos-graduando') {
                filterContainer.style.display = 'flex';
            } else {
                filterContainer.style.display = 'none';
            }
        }
        
        // Inicia monitoramento das tarefas
        initBoard();
    } else {
        window.location.href = 'auth.html';
    }
});

function initBoard() {
    const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    
    onSnapshot(q, (snapshot) => {
        allTasks = [];
        snapshot.forEach(doc => {
            allTasks.push({ id: doc.id, ...doc.data() });
        });
        renderBoard();
    });
}

function renderBoard() {
    // 1. Limpar
    Object.values(columns).forEach(col => col.innerHTML = '');
    Object.values(counters).forEach(span => span.textContent = '0');

    const counts = {
        clivagem: 0, processamento: 0, emblocamento: 0, 
        corte: 0, coloracao: 0, analise: 0, liberar: 0
    };

    allTasks.forEach(task => {
        // 2. Filtro de "Minhas"
        if (currentFilter === 'mine') {
            const isMine = (task.docente === currentUserName) || (task.posGraduando === currentUserName);
            if (!isMine) return; 
        }

        const status = task.status;
        const col = columns[status];

        if (col) {
            // Cria Card
            const card = document.createElement('div');
            // Adiciona classe de cor do K7 se existir
            const k7Class = task.k7Color ? `k7-${task.k7Color}` : '';
            card.className = `mural-card ${k7Class}`;
            
            // Evento de clique
            card.onclick = () => window.openTaskManager(task.id);
            
            const code = task.accessCode || task.protocolo || "---";
            const shortDocente = getShortName(task.docente);

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <span style="font-weight:700; font-size:0.9rem; color:var(--color-primary);">#${code}</span>
                    ${task.k7Quantity ? `<span class="mural-tag">${task.k7Quantity} K7</span>` : ''}
                </div>
                <div style="font-size:0.9rem; margin-top:5px; font-weight:700; color:var(--text-primary);">
                    ${task.animalNome || 'Sem Nome'}
                </div>
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px; text-transform:uppercase; font-weight:600;">
                    ${task.especie || ''}
                </div>
                <div style="margin-top:8px; display:flex; gap:5px; align-items:center; font-size:0.75rem; color:var(--text-tertiary);">
                    <i class="fas fa-user-md"></i> ${shortDocente}
                </div>
            `;

            col.appendChild(card);
            if (counts[status] !== undefined) counts[status]++;
        }
    });

    // Atualiza contadores
    for (const key in counts) {
        if (counters[key]) counters[key].textContent = counts[key];
    }
}

// Eventos de Filtro
btnAll.addEventListener('click', () => {
    currentFilter = 'all';
    btnAll.classList.replace('btn-secondary', 'btn-primary');
    btnMine.classList.replace('btn-primary', 'btn-secondary');
    renderBoard();
});

btnMine.addEventListener('click', () => {
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