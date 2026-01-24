import { auth, db } from '../core.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { doc, getDoc, collection, query, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 1. MAPEAMENTO DOS ELEMENTOS
const els = {
    userBadge: document.getElementById('user-role-badge'),
    adminCard: document.getElementById('admin-card'),
    queueContainer: document.getElementById('queue-list-container'),
    
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
            if (['admin', 'professor'].includes(currentUserData.role)) {
                if(els.adminCard) els.adminCard.classList.remove('hidden');
            }
        }
    } catch (e) { console.error(e); }
}

function updateUserBadge(role) {
    if(!els.userBadge) return;
    const display = role.charAt(0).toUpperCase() + role.slice(1).replace('-', ' ');
    els.userBadge.textContent = display;
}

// 4. DASHBOARD (LÓGICA CORRIGIDA)
function initRealTimeDashboard() {
    const q = query(collection(db, "tasks"));

    unsubscribeTasks = onSnapshot(q, (snapshot) => {
        // Zera contadores
        const counts = {
            necropsias: 0, // Totalizador
            biopsias: 0,   // Totalizador
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
            const status = task.status; // Onde está na esteira
            const type = task.type;     // 'biopsia' ou 'necropsia'

            // --- LÓGICA 1: TOTALIZADORES (Biopsias/Necropsias) ---
            // Conta sempre, a menos que já tenha sido liberado (saiu do lab)
            // (Consideramos 'liberar' como o último passo antes de arquivar)
            // Se você quiser que suma APÓS clicar em liberar, mantenha != 'liberar'
            // Se quiser que conte em liberar também, remova a condição.
            
            // Regra: Conta como ativo se NÃO estiver finalizado/arquivado
            // Assumindo que 'liberar' ainda é uma etapa ativa (o professor tem que clicar)
            // Se 'arquivado' for o fim, mude para != 'arquivado'
            
            // Neste exemplo: Conta sempre até que o status mude para algo como 'concluido' ou 'arquivado'.
            // Mas como sua esteira termina em "Liberar Laudo", vamos contar tudo.
            
            if (status !== 'concluido' && status !== 'arquivado') { 
                if (type === 'biopsia') counts.biopsias++;
                if (type === 'necropsia') counts.necropsias++;
            }

            // --- LÓGICA 2: ESTEIRA DE PRODUÇÃO (Onde está agora?) ---
            if (counts.hasOwnProperty(status)) {
                counts[status]++;
            } else {
                // Mapeamento de segurança para nomes antigos
                if (status === 'waiting') counts.processamento++;
            }

            // --- LÓGICA 3: MINHA FILA LATERAL ---
            if (isTaskRelevant(task, currentUserData.role)) {
                myQueue.push(task);
            }
        });

        updateCounters(counts);
        renderQueue(myQueue);

    }, (error) => console.warn(error));
}

function updateCounters(c) {
    // Totalizadores
    if(els.cNecropsias) els.cNecropsias.textContent = c.necropsias;
    if(els.cBiopsias) els.cBiopsias.textContent = c.biopsias;
    
    // Etapas
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
    if (role === 'admin' || role === 'professor') return true; // Vê tudo
    
    if (role === 'pós graduando' || role === 'pos-graduando') {
        return ['analise', 'liberar'].includes(task.status);
    }

    if (role === 'estagiario') {
        // Estagiário vê a parte técnica (Clivagem -> Coloração)
        return ['clivagem', 'processamento', 'emblocamento', 'corte', 'coloracao'].includes(task.status);
    }
    return false;
}

// 7. RENDERIZAR A LISTA LATERAL (ATUALIZADO COM CORES E CLIQUE)
function renderQueue(tasks) {
    if (!els.queueContainer) return;
    els.queueContainer.innerHTML = '';
    
    if (tasks.length === 0) {
        els.queueContainer.innerHTML = `<div style="text-align:center; padding:2rem; opacity:0.6;"><p>Sua fila está vazia.</p></div>`;
        return;
    }

    tasks.forEach(task => {
        // Define classe de badge
        let badgeClass = 'badge-process';
        if (task.status === 'analise') badgeClass = 'badge-warning'; 
        if (task.status === 'liberar') badgeClass = 'badge-success'; 

        // --- LÓGICA DE COR DO CARD (K7) ---
        // Se tiver cor definida no banco, usa. Senão, fica padrão glass.
        let k7Class = '';
        if (task.k7Color) {
            k7Class = `k7-${task.k7Color}`; // Ex: k7-rosa, k7-azul
        }

        const displayCode = task.protocolo || task.accessCode || "---";

        // ADICIONAMOS onclick="window.openTaskManager(...)"
        const html = `
            <div class="sample-ticket fade-in ${k7Class}" onclick="window.openTaskManager('${task.id}')" style="cursor: pointer;">
                <div>
                    <span style="font-weight:700; color:var(--text-primary);">#${displayCode}</span>
                    <br>
                    <span style="font-size:0.85rem;">${task.animalNome || 'Sem nome'}</span>
                    ${task.k7Quantity ? `<span style="font-size:0.7rem; opacity:0.8; display:block;">${task.k7Quantity} Cassetes</span>` : ''}
                </div>
                <div class="ticket-status-badge ${badgeClass}">${formatStatus(task.status)}</div>
            </div>`;
        els.queueContainer.insertAdjacentHTML('beforeend', html);
    });
}

function formatStatus(status) {
    const map = {
        necropsias: 'Necropsia', // (Caso raro aparecer como status)
        biopsias: 'Biópsia',     // (Caso raro aparecer como status)
        clivagem: 'Clivagem',
        processamento: 'Process.',
        emblocamento: 'Embloc.',
        corte: 'Corte',
        coloracao: 'Coloração',
        analise: 'Análise',
        liberar: 'Liberar'
    };
    return map[status] || status;
}