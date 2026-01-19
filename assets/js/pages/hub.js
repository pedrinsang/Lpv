import { auth, db } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const els = {
    userBadge: document.getElementById('user-role-badge'),
    queueContainer: document.getElementById('queue-list-container'),
    adminCard: document.getElementById('admin-card'),
    countEntry: document.getElementById('count-entry'),
    countProcess: document.getElementById('count-process'),
    countAnalysis: document.getElementById('count-analysis'),
    countReport: document.getElementById('count-report')
};

let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadUserProfile(user.uid);
        if (currentUserData) loadDashboardData();
    } else {
        window.location.href = '../pages/auth.html';
    }
});

document.getElementById('logout-btn')?.addEventListener('click', () => signOut(auth));

async function loadUserProfile(uid) {
    const docSnap = await getDoc(doc(db, "users", uid));
    if (docSnap.exists()) {
        currentUserData = docSnap.data();
        updateUserBadge(currentUserData.role);
        if (['admin', 'professor'].includes(currentUserData.role)) {
            if(els.adminCard) els.adminCard.classList.remove('hidden');
        }
    }
}

function updateUserBadge(role) {
    if(!els.userBadge) return;
    const map = { estagiario: 'Estagiário', 'pos-graduando': 'Pós-Grad', professor: 'Professor', admin: 'Admin' };
    els.userBadge.textContent = map[role] || 'Colaborador';
}

async function loadDashboardData() {
    try {
        const q = query(collection(db, "tasks"), where("status", "!=", "concluido"));
        const snapshot = await getDocs(q);
        
        let counts = { entrada: 0, processamento: 0, analise: 0, laudo: 0 };
        let myQueue = [];

        snapshot.forEach(doc => {
            const task = { id: doc.id, ...doc.data() };
            if (counts[task.status] !== undefined) counts[task.status]++;
            if (isTaskRelevant(task, currentUserData.role)) myQueue.push(task);
        });

        updateCounters(counts);
        renderQueue(myQueue);
    } catch (e) {
        console.warn("Sem dados ou erro:", e);
        updateCounters({ entrada: 0, processamento: 0, analise: 0, laudo: 0 });
        renderQueue([]);
    }
}

function isTaskRelevant(task, role) {
    if (role === 'estagiario' && task.status === 'processamento') return true;
    if (role === 'pos-graduando' && task.status === 'analise') return true;
    if (role === 'professor' && ['analise', 'laudo'].includes(task.status)) return true;
    if (role === 'admin') return true;
    return false;
}

function updateCounters(c) {
    if(els.countEntry) els.countEntry.textContent = c.entrada;
    if(els.countProcess) els.countProcess.textContent = c.processamento;
    if(els.countAnalysis) els.countAnalysis.textContent = c.analise;
    if(els.countReport) els.countReport.textContent = c.laudo;
}

function renderQueue(tasks) {
    if (!els.queueContainer) return;
    els.queueContainer.innerHTML = '';
    if (tasks.length === 0) {
        els.queueContainer.innerHTML = `<div style="text-align:center; padding:2rem; opacity:0.6;"><p>Fila vazia.</p></div>`;
        return;
    }
    tasks.forEach(task => {
        const html = `
            <div class="sample-ticket">
                <div><span style="font-weight:700; color:var(--color-primary);">#${task.code}</span><br><span>${task.title}</span></div>
                <div class="ticket-status-badge badge-process">${task.status}</div>
            </div>`;
        els.queueContainer.insertAdjacentHTML('beforeend', html);
    });
}