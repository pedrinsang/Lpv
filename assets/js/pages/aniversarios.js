/**
 * LPV - PÁGINA DE ANIVERSÁRIOS
 */
import { auth, db, onAuthStateChanged } from '../core.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { fetchBirthdays, addBirthday, deleteBirthday, groupBirthdaysByMonth, monthNames } from '../birthdays.js';

// Elementos
const container = document.getElementById('birthdays-container');
const loadingMsg = document.getElementById('loading-msg');
const btnAdd = document.getElementById('btn-add-bday');
const addModal = document.getElementById('add-modal');
const closeAddModal = document.getElementById('close-add-modal');
const formAdd = document.getElementById('form-add-bday');

let isAdmin = false;

// 1. Verifica Auth e Permissões
onAuthStateChanged(auth, async (user) => {
    if (!user) return window.location.href = "auth.html";

    // Verifica se é admin para mostrar controles
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().role === 'admin') {
            isAdmin = true;
            if (btnAdd) btnAdd.classList.remove('hidden'); // Mostra botão +
        }
    } catch (e) { console.error(e); }

    // Carrega a lista
    loadBirthdays();
});

// 2. Carregar e Renderizar
async function loadBirthdays() {
    try {
        const rawList = await fetchBirthdays();
        const grouped = groupBirthdaysByMonth(rawList);
        
        renderList(grouped);
    } catch (error) {
        console.error(error);
        container.innerHTML = '<p class="alert-message error">Erro ao carregar dados.</p>';
    } finally {
        loadingMsg.style.display = 'none';
    }
}

function renderList(groupedData) {
    container.innerHTML = '';
    
    if (Object.keys(groupedData).length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">Nenhum aniversário cadastrado.</p>';
        return;
    }

    const hoje = new Date();
    const diaHoje = hoje.getDate();
    const mesHoje = hoje.getMonth() + 1;

    for (let i = 1; i <= 12; i++) {
        if (groupedData[i]) {
            const section = document.createElement('div');
            section.className = 'month-section fade-in';
            
            let cardsHtml = '';
            groupedData[i].forEach(b => {
                const isToday = (b.dia === diaHoje && b.mes === mesHoje) ? 'is-today' : '';
                const textToday = isToday ? '<span style="color:var(--color-warning); font-size:0.75rem;">(Hoje!)</span>' : '';
                
                // Botão de delete (só se for admin)
                const deleteBtnHtml = isAdmin 
                    ? `<button class="btn-delete" onclick="window.removeBday('${b.id}', '${b.nome}')"><i class="fas fa-trash"></i></button>` 
                    : '';

                cardsHtml += `
                    <div class="bday-card ${isToday}">
                        <div class="bday-left">
                            <div class="bday-date">${b.dia}</div>
                            <div class="bday-info">
                                <h4>${b.nome} ${textToday}</h4>
                                <p>${monthNames[i]}</p>
                            </div>
                        </div>
                        ${deleteBtnHtml}
                    </div>
                `;
            });

            section.innerHTML = `
                <h3 class="month-title"><i class="fas fa-calendar-alt"></i> ${monthNames[i]}</h3>
                <div class="bday-list">${cardsHtml}</div>
            `;
            container.appendChild(section);
        }
    }
}

// 3. Adicionar Aniversário
if (formAdd) {
    formAdd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('new-name').value;
        const dia = document.getElementById('new-day').value;
        const mes = document.getElementById('new-month').value;
        const btn = formAdd.querySelector('button');

        btn.disabled = true;
        btn.textContent = "Salvando...";

        try {
            await addBirthday(nome, dia, mes);
            addModal.classList.remove('open');
            formAdd.reset();
            loadBirthdays(); // Recarrega a lista
        } catch (error) {
            alert("Erro ao salvar: " + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "Salvar";
        }
    });
}

// 4. Deletar Aniversário (Exposto globalmente para o onclick do HTML)
window.removeBday = async (id, nome) => {
    if (!confirm(`Tem certeza que deseja remover o aniversário de ${nome}?`)) return;
    
    try {
        await deleteBirthday(id);
        loadBirthdays(); // Recarrega
    } catch (error) {
        alert("Erro ao deletar: " + error.message);
    }
};

// 5. Controles do Modal
if(btnAdd) btnAdd.addEventListener('click', () => addModal.classList.add('open'));
if(closeAddModal) closeAddModal.addEventListener('click', () => addModal.classList.remove('open'));