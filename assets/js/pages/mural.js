/**
 * LPV - MURAL SCRIPT
 * Consulta de Resultados usando Firestore
 */

import { db } from '../core.js'; 
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Referências DOM
const searchForm = document.getElementById('search-form');
const protocolInput = document.getElementById('protocol-input');
const resultArea = document.getElementById('result-area');
const loadingIndicator = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');

// ================================================================
// BUSCA
// ================================================================

if (searchForm) {
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = protocolInput.value.trim();

        if (!code) {
            showError("Por favor, digite um código.");
            return;
        }

        // UI States
        showLoading(true);
        hideError();
        resultArea.innerHTML = ''; // Limpa anterior
        resultArea.classList.add('hidden');

        try {
            await searchProtocol(code);
        } catch (error) {
            console.error("Erro na busca:", error);
            showError("Erro ao consultar o sistema. Tente novamente.");
        } finally {
            showLoading(false);
        }
    });
}

/**
 * Busca o protocolo no Firestore
 */
async function searchProtocol(code) {
    // Exemplo de consulta: coleção "laudos" onde campo "codigo" == code
    // Ajuste "laudos" e "codigo" conforme o nome real no seu banco de dados
    const q = query(collection(db, "laudos"), where("codigo", "==", code));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        showError("Nenhum laudo encontrado com este código.");
        return;
    }

    // Se achou, mostra o primeiro resultado
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        displayResult(data);
    });
}

/**
 * Renderiza o Card de Resultado
 */
function displayResult(data) {
    // Define cor e ícone baseados no status
    let statusColor = '#f57c00'; // Pendente (Laranja)
    let statusIcon = 'fa-clock';
    let statusText = 'Em Análise';

    if (data.status === 'concluido') {
        statusColor = '#00b894'; // Sucesso (Verde)
        statusIcon = 'fa-check-circle';
        statusText = 'Concluído';
    }

    const html = `
        <div class="result-card fade-in">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <h2 style="font-size: 1.2rem; font-weight: bold;">${data.animal || 'Paciente'}</h2>
                <span style="background: ${statusColor}; padding: 5px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: bold; display: flex; align-items: center; gap: 5px;">
                    <i class="fas ${statusIcon}"></i> ${data.status || statusText}
                </span>
            </div>
            
            <div style="display: grid; gap: 0.5rem; font-size: 0.9rem; opacity: 0.9;">
                <p><strong>Proprietário:</strong> ${data.proprietario || '-'}</p>
                <p><strong>Solicitante:</strong> ${data.solicitante || '-'}</p>
                <p><strong>Data:</strong> ${data.data || new Date().toLocaleDateString()}</p>
            </div>

            ${data.linkPdf ? `
                <a href="${data.linkPdf}" target="_blank" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem; text-align: center;">
                    <i class="fas fa-file-pdf"></i> Baixar Laudo Completo
                </a>
            ` : ''}
        </div>
    `;

    resultArea.innerHTML = html;
    resultArea.classList.remove('hidden');
}

// ================================================================
// UTILITÁRIOS
// ================================================================

function showLoading(show) {
    if (show) loadingIndicator.classList.remove('hidden');
    else loadingIndicator.classList.add('hidden');
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}