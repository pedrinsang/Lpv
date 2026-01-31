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
const activeGrid = document.getElementById('active-list');
const searchInput = document.getElementById('admin-search');

// --- SETUP ---
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

// --- DADOS EM TEMPO REAL ---
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

// --- AUXILIAR: Iniciais do Nome ---
function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// --- RENDERIZAR PENDENTES ---
function renderPending(users) {
    if (users.length === 0) {
        pendingSection.classList.add('hidden');
        return;
    }
    
    pendingSection.classList.remove('hidden');
    pendingGrid.innerHTML = users.map(u => `
        <div class="admin-card pending fade-in">
            <div class="card-header">
                <div class="card-role" style="color:var(--color-warning); background:rgba(245, 158, 11, 0.1);">Pendente</div>
                <div class="card-date">${new Date(u.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</div>
            </div>
            
            <div class="card-body">
                <div class="user-avatar-initials" style="background:var(--bg-body); color:var(--text-tertiary); border-color:var(--color-warning);">?</div>
                <div class="user-details">
                    <div class="card-title">${u.name}</div>
                    <div class="card-subtitle"><i class="far fa-envelope"></i> ${u.email}</div>
                </div>
            </div>

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

// --- RENDERIZAR ATIVOS ---
function renderActive(users) {
    if (users.length === 0) {
        activeGrid.innerHTML = '<div class="empty-state"><p>Nenhum membro ativo.</p></div>';
        return;
    }

    activeGrid.innerHTML = users.map(u => {
        const isMe = u.id === auth.currentUser?.uid;
        const initials = getInitials(u.name);
        
        return `
        <div class="admin-card fade-in">
            <div class="card-header">
                <div class="card-role">${u.role}</div>
                ${isMe ? '<div class="card-date" style="font-weight:bold; color:var(--color-primary);">VOCÊ</div>' : `<div class="card-date">Membro</div>`}
            </div>
            
            <div class="card-body">
                <div class="user-avatar-initials">${initials}</div>
                <div class="user-details">
                    <div class="card-title">${u.name}</div>
                    <div class="card-subtitle"><i class="far fa-envelope"></i> ${u.email}</div>
                </div>
            </div>

            <div class="card-actions">
                <select class="role-select" onchange="window.updateRole('${u.id}', this.value)" ${isMe ? 'disabled' : ''}>
                    <option value="estagiario" ${u.role === 'estagiario' ? 'selected' : ''}>Estagiário</option>
                    <option value="pós graduando" ${u.role === 'pós graduando' || u.role === 'pos-graduando' ? 'selected' : ''}>Pós-Graduando</option>
                    <option value="professor" ${u.role === 'professor' ? 'selected' : ''}>Professor</option>
                </select>

                ${!isMe ? `
                <button class="btn-icon-action btn-delete" onclick="window.deleteUser('${u.id}', '${u.name}')" title="Remover Acesso">
                    <i class="fas fa-trash-alt" style="color:var(--color-error);"></i>
                </button>
                ` : '<div style="width:36px;"></div>'}
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
    if (!confirm(`Remover ${name} do sistema?\nEssa ação é irreversível.`)) return;
    try { await deleteDoc(doc(db, "users", uid)); } 
    catch (e) { alert("Erro ao remover."); }
};