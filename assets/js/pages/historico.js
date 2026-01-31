import { db, auth, logout } from '../core.js';
import { 
    collection, 
    query, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Elementos
const pendingGrid = document.getElementById('pending-grid');
const pendingSection = document.getElementById('pending-section');
const activeGrid = document.getElementById('active-list'); // Agora é um Grid
const searchInput = document.getElementById('admin-search');

// --- SETUP INICIAL ---
document.addEventListener('DOMContentLoaded', () => {
    const btnLogoutSidebar = document.getElementById('btn-logout');
    const btnLogoutHeader = document.getElementById('logout-btn-header');

    if (btnLogoutSidebar) btnLogoutSidebar.addEventListener('click', logout);
    if (btnLogoutHeader) btnLogoutHeader.addEventListener('click', logout);
});

// --- SEGURANÇA ---
setTimeout(() => {
    if (window.currentUserRole) {
        checkPermission(window.currentUserRole);
    } else {
        const checkInterval = setInterval(() => {
            if (window.currentUserRole) {
                clearInterval(checkInterval);
                checkPermission(window.currentUserRole);
            }
        }, 500);
    }
}, 1000);

function checkPermission(role) {
    if (role !== 'professor' && role !== 'admin') {
        alert("Acesso Negado: Área restrita.");
        window.location.href = 'hub.html';
    }
}

// --- LISTAR USUÁRIOS ---
const q = query(collection(db, "users"));
let allUsers = [];

onSnapshot(q, (snapshot) => {
    const pending = [];
    const active = [];

    snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const user = { id: docSnap.id, ...data };
        if (data.status === 'pending') pending.push(user);
        else active.push(user);
    });

    allUsers = active; 
    renderPending(pending);
    renderActive(active);
}, (error) => {
    console.error("Erro:", error);
    activeGrid.innerHTML = `<div class="empty-state" style="color:var(--color-error)">Erro de permissão.</div>`;
});

// --- RENDER PENDENTES (Cards Grid) ---
function renderPending(users) {
    if (users.length === 0) {
        pendingSection.classList.add('hidden');
        return;
    }
    
    pendingSection.classList.remove('hidden');
    pendingGrid.innerHTML = users.map(u => `
        <div class="admin-card pending fade-in">
            <div class="card-header">
                <div class="user-role-badge" style="background: var(--color-warning); color: #fff; border:none;">Pendente</div>
                <div style="font-size:0.8rem; opacity:0.7;">${new Date(u.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</div>
            </div>
            
            <div class="card-title">${u.name}</div>
            <div class="card-subtitle">${u.email}</div>

            <div class="card-actions">
                <button class="btn btn-sm" style="background:#10b981; color:white; border:none; flex:1;" onclick="window.approveUser('${u.id}')">
                    <i class="fas fa-check"></i> Aprovar
                </button>
                <button class="btn btn-sm" style="background:#ef4444; color:white; border:none; width:40px;" onclick="window.deleteUser('${u.id}', '${u.name}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// --- RENDER ATIVOS (Cards Grid) ---
function renderActive(users) {
    if (users.length === 0) {
        activeGrid.innerHTML = '<div class="empty-state"><p>Nenhum membro ativo.</p></div>';
        return;
    }

    activeGrid.innerHTML = users.map(u => {
        const isMe = u.id === auth.currentUser?.uid;
        
        return `
        <div class="admin-card fade-in">
            <div class="card-header">
                <div class="user-role-badge">${u.role}</div>
                ${isMe ? '<i class="fas fa-user-circle" style="color:var(--color-primary);"></i>' : ''}
            </div>
            
            <div class="card-title">${u.name}</div>
            <div class="card-subtitle">${u.email}</div>

            <div class="card-actions">
                <select class="role-select" onchange="window.updateRole('${u.id}', this.value)" ${isMe ? 'disabled' : ''}>
                    <option value="estagiario" ${u.role === 'estagiario' ? 'selected' : ''}>Estagiário</option>
                    <option value="pós graduando" ${u.role === 'pós graduando' || u.role === 'pos-graduando' ? 'selected' : ''}>Pós-Graduando</option>
                    <option value="professor" ${u.role === 'professor' ? 'selected' : ''}>Professor</option>
                </select>

                ${!isMe ? `
                <button class="btn btn-sm" style="color:var(--color-error); border:1px solid var(--color-error); background:transparent;" onclick="window.deleteUser('${u.id}', '${u.name}')" title="Remover">
                    <i class="fas fa-trash-alt"></i>
                </button>
                ` : ''}
            </div>
        </div>
    `}).join('');
}

// --- BUSCA ---
if(searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
            u.name.toLowerCase().includes(term) || 
            u.email.toLowerCase().includes(term)
        );
        renderActive(filtered);
    });
}

// --- FUNÇÕES GLOBAIS ---
window.approveUser = async (uid) => {
    if (!confirm("Aprovar este usuário?")) return;
    try { await updateDoc(doc(db, "users", uid), { status: 'active', role: 'estagiario' }); } 
    catch (e) { alert("Erro ao aprovar."); }
};

window.updateRole = async (uid, newRole) => {
    try { await updateDoc(doc(db, "users", uid), { role: newRole }); } 
    catch (e) { alert("Erro ao mudar cargo."); }
};

window.deleteUser = async (uid, name) => {
    if (!confirm(`Remover ${name} do sistema?`)) return;
    try { await deleteDoc(doc(db, "users", uid)); } 
    catch (e) { alert("Erro ao remover."); }
};