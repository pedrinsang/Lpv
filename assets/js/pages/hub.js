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
    const container = document.getElementById('queue-list-container');
    if (!container) return;
    
    container.innerHTML = '';

    if (tasks.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-tertiary);">
                <i class="far fa-check-circle fa-2x" style="margin-bottom: 10px; opacity: 0.5;"></i>
                <p>Nenhuma amostra ativa no momento.</p>
            </div>`;
        return;
    }

    tasks.forEach(task => {
        // Cria o elemento da lista
        const div = document.createElement('div');
        div.className = 'sample-ticket'; // Classe CSS padrão do sistema
        
        // Define cor da borda esquerda baseada no status/cor k7
        if (task.k7Color === 'rosa') div.style.borderLeft = '4px solid #ec4899';
        else if (task.k7Color === 'azul') div.style.borderLeft = '4px solid #3b82f6';
        else div.style.borderLeft = '4px solid #cbd5e1';

        div.onclick = () => window.openTaskManager(task.id);

        // Define dados
        const protocol = task.protocolo || task.accessCode || '---';
        const isNecropsia = (task.type === 'necropsia') || (!task.type && task.k7Color === 'azul');
        
        // Configuração do Badge
        const typeLabel = isNecropsia ? 'NECROPSIA' : 'BIÓPSIA';
        const typeColor = isNecropsia ? '#3b82f6' : '#ec4899';
        
        // Responsável (Pós)
        const shortPos = getShortName(task.posGraduando || "Sem Pós");

        // Status formatado
        const statusMap = {
            'clivagem': 'Clivagem', 'processamento': 'Processamento', 'emblocamento': 'Emblocamento',
            'corte': 'Corte', 'coloracao': 'Coloração', 'analise': 'Análise', 'liberar': 'Liberar'
        };
        const statusName = statusMap[task.status] || task.status;

        div.innerHTML = `
            <div style="width: 100%;">
                <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                     <span style="font-weight: 800; font-size: 1rem; color: var(--text-primary);">
                        ${protocol}
                     </span>
                     <span style="font-size: 0.65rem; font-weight: 800; color: ${typeColor}; background: ${typeColor}15; padding: 2px 8px; border-radius: 4px; border: 1px solid ${typeColor}30;">
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
            </div>
        `;

        container.appendChild(div);
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

// --- FUNÇÃO EXTRA: SCROLL HORIZONTAL COM MOUSE NA ESTEIRA ---
const productionWrapper = document.querySelector('.production-wrapper');

if (productionWrapper) {
    productionWrapper.addEventListener('wheel', (evt) => {
        // Se o usuário estiver rolando para cima/baixo (deltaY)
        if (evt.deltaY !== 0) {
            // Impede a página de descer
            evt.preventDefault();
            
            // Transforma a rolagem vertical em horizontal
            // O '+= evt.deltaY' faz ir para direita/esquerda
            productionWrapper.scrollLeft += evt.deltaY;
        }
    });
}

// --- Função Auxiliar para Abreviar Nomes ---
function getShortName(fullName) {
    if (!fullName) return '-';
    // Remove espaços extras e divide
    const parts = fullName.trim().split(/\s+/);
    
    if (parts.length === 1) return parts[0]; // Se só tem um nome (ex: "Bruna")
    
    // Retorna Primeiro Nome + Inicial do Segundo (ex: "Bruna K.")
    return `${parts[0]} ${parts[1][0]}.`;
}