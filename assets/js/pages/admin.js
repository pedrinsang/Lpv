import { db, auth } from '../core.js';
import { 
    collection, 
    query, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const pendingList = document.getElementById('pending-list');
const pendingSection = document.getElementById('pending-section');
const activeList = document.getElementById('active-list');
const searchInput = document.getElementById('search-users');

// --- SEGURANÇA: Verificar se é Professor ---
// (Verificação de frontend apenas para UX. As regras do Firestore garantem a segurança real)
setTimeout(() => {
    // Se a role já carregou
    if (window.currentUserRole) {
        const role = window.currentUserRole;
        if (role !== 'professor' && role !== 'admin') {
            alert("Acesso Negado: Área restrita.");
            window.location.href = 'hub.html';
        }
    } else {
        // Se demorou, verifica de novo
        const checkInterval = setInterval(() => {
            if (window.currentUserRole) {
                clearInterval(checkInterval);
                const role = window.currentUserRole;
                
                if (role !== 'professor' && role !== 'admin') {
                    alert("Acesso Negado: Área restrita.");
                    window.location.href = 'hub.html';
                }
            }
        }, 500);
    }
}, 1000);

// --- LISTAR USUÁRIOS (Tempo Real) ---
const q = query(collection(db, "users"));

// Array para guardar dados para busca
let allUsers = [];

const unsubscribe = onSnapshot(q, (snapshot) => {
    const pending = [];
    const active = [];

    snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const user = { id: docSnap.id, ...data };
        
        // Separa por status
        if (data.status === 'pending') {
            pending.push(user);
        } else {
            active.push(user);
        }
    });

    allUsers = active; // Para filtro de busca
    renderPending(pending);
    renderActive(active);
}, (error) => {
    console.error("Erro ao ler usuários:", error);
    activeList.innerHTML = `<div style="padding:1rem; color:var(--color-error)">Erro de permissão: Você não é Professor.</div>`;
});

// --- RENDERIZAR PENDENTES ---
function renderPending(users) {
    if (users.length === 0) {
        pendingSection.classList.add('hidden');
        return;
    }
    
    pendingSection.classList.remove('hidden');
    pendingList.innerHTML = users.map(u => `
        <div class="user-card-pending fade-in">
            <div class="user-info">
                <h3>${u.name}</h3>
                <p>${u.email}</p>
                <div style="margin-top:5px; font-size:0.8rem; opacity:0.8;">
                    <i class="fas fa-clock"></i> Aguardando desde: ${new Date(u.createdAt.seconds * 1000).toLocaleDateString()}
                </div>
            </div>
            <div class="action-group">
                <button class="btn-sm btn-approve" onclick="window.approveUser('${u.id}')">
                    <i class="fas fa-check"></i> Aprovar
                </button>
                <button class="btn-sm btn-reject" onclick="window.deleteUser('${u.id}', '${u.name}')">
                    <i class="fas fa-times"></i> Rejeitar
                </button>
            </div>
        </div>
    `).join('');
}

// --- RENDERIZAR ATIVOS ---
function renderActive(users) {
    if (users.length === 0) {
        activeList.innerHTML = '<div style="text-align:center; padding:2rem;">Nenhum usuário ativo.</div>';
        return;
    }

    activeList.innerHTML = users.map(u => {
        // Não permitir que eu edite eu mesmo (opcional, mas seguro)
        const isMe = u.id === auth.currentUser?.uid;
        
        return `
        <div class="user-card fade-in">
            <div class="user-info">
                <h3>${u.name} ${isMe ? '<span class="user-badge" style="background:#e0f2fe; color:#0284c7;">Você</span>' : ''}</h3>
                <p>${u.email}</p>
                <div style="margin-top:5px;">
                    <span class="user-badge">${u.role}</span>
                </div>
            </div>
            
            <div class="action-group" style="align-items: center;">
                <select class="role-select" onchange="window.updateRole('${u.id}', this.value)" ${isMe ? 'disabled' : ''}>
                    <option value="estagiario" ${u.role === 'estagiario' ? 'selected' : ''}>Estagiário</option>
                    <option value="pós graduando" ${u.role === 'pós graduando' ? 'selected' : ''}>Pós-Grad.</option>
                    <option value="professor" ${u.role === 'professor' ? 'selected' : ''}>Professor</option>
                </select>

                ${!isMe ? `
                <button class="btn-icon" style="color:var(--text-tertiary); margin-left:5px;" onclick="window.deleteUser('${u.id}', '${u.name}')" title="Remover Usuário">
                    <i class="fas fa-trash-alt"></i>
                </button>
                ` : ''}
            </div>
        </div>
    `}).join('');
}

// --- BUSCA ---
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u => 
        u.name.toLowerCase().includes(term) || 
        u.email.toLowerCase().includes(term)
    );
    renderActive(filtered);
});

// --- FUNÇÕES GLOBAIS (Para o HTML acessar) ---

// 1. APROVAR
window.approveUser = async (uid) => {
    if (!confirm("Confirmar aprovação deste usuário?")) return;
    try {
        await updateDoc(doc(db, "users", uid), {
            status: 'active',
            role: 'estagiario' // Padrão ao aprovar
        });
        // Feedback visual acontece automaticamente pelo onSnapshot
    } catch (error) {
        console.error("Erro:", error);
        alert("Erro ao aprovar.");
    }
};

// 2. MUDAR CARGO
window.updateRole = async (uid, newRole) => {
    try {
        await updateDoc(doc(db, "users", uid), {
            role: newRole
        });
    } catch (error) {
        console.error("Erro:", error);
        alert("Erro ao mudar cargo.");
    }
};

// 3. EXCLUIR / REJEITAR
window.deleteUser = async (uid, name) => {
    const msg = `Tem certeza que deseja remover ${name} do sistema?\n\nEsta ação impedirá o acesso dele imediatamente.`;
    if (!confirm(msg)) return;

    try {
        // Ao deletar o documento 'users', o core.js não vai mais encontrar o perfil
        // e vai deslogar o usuário automaticamente na próxima vez que ele tentar acessar.
        await deleteDoc(doc(db, "users", uid));
    } catch (error) {
        console.error("Erro:", error);
        alert("Erro ao remover usuário.");
    }
};