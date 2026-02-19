// assets/js/components/form-laudo.js

class formLaudo extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div id="report-editor-modal" class="modal-overlay hidden" style="z-index: 3000;">
            <div class="report-paper-container">
                <div class="report-toolbar">
                    <h3 style="color: var(--text-primary);"><i class="fas fa-file-medical"></i> Editor de Laudo</h3>
                    <div style="display: flex; gap: 10px;">
                        <button id="btn-download-word" class="btn btn-secondary btn-sm hidden" onclick="window.exportToWord()"><i class="fas fa-file-word"></i> Baixar Word</button>
                        <button id="btn-save-report" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> Salvar</button>
                    </div>
                </div>
                <div class="report-paper" id="print-area">
                    <table class="header-table">
                        <tr>
                            <td><img src="../assets/images/Logo-UFSM.png" alt="UFSM" style="width: 75px; height: auto;"></td>
                            <td>
                                <div class="univ-title" style="color: black;">UNIVERSIDADE FEDERAL DE SANTA MARIA</div>
                                <div class="dept-title">DEPARTAMENTO DE PATOLOGIA</div>
                                <div class="lab-title">Laboratório de Patologia Veterinária</div>
                                <div class="address-text">Prédio 97B, 97105-900 Santa Maria, RS, Brasil</div>
                                <div class="address-text">lpv@ufsm.br | 55 3220-8168</div>
                            </td>
                            <td><img src="../assets/images/lpvminilogo2.png" alt="LPV" style="width: 90px; height: auto;"></td>
                        </tr>
                    </table>
                    <div style="text-align: center; margin: 15px 0;">
                        <span style="font-family: Arial, sans-serif; font-weight: bold; font-size: 16px; text-decoration: underline;">LAUDO HISTOPATOLÓGICO (<span id="rep-protocol-header">V-000</span>)</span>
                    </div>
                    <div class="info-block">
                        <table class="info-table" style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px;">
                            <tr><td style="border: 1px solid #000; padding: 4px; background: #f0f0f0;" colspan="4"><strong>DADOS DO ANIMAL</strong></td></tr>
                            <tr>
                                <td style="border: 1px solid #000; padding: 4px;"><strong>Nome:</strong> <span id="rep-animal">...</span></td>
                                <td style="border: 1px solid #000; padding: 4px;"><strong>Espécie:</strong> <span id="rep-especie">...</span></td>
                                <td style="border: 1px solid #000; padding: 4px;"><strong>Raça:</strong> <span id="rep-raca">...</span></td>
                                <td style="border: 1px solid #000; padding: 4px;"><strong>Sexo:</strong> <span id="rep-sexo">...</span></td>
                            </tr>
                            <tr><td style="border: 1px solid #000; padding: 4px;" colspan="4"><strong>Idade:</strong> <span id="rep-idade">...</span></td></tr>
                            <tr><td style="border: 1px solid #000; padding: 4px; background: #f0f0f0;" colspan="4"><strong>DADOS DO REQUISITANTE / PROPRIETÁRIO</strong></td></tr>
                            <tr>
                                <td style="border: 1px solid #000; padding: 4px;" colspan="2"><strong>Requisitante:</strong> <span id="rep-req">...</span></td>
                                <td style="border: 1px solid #000; padding: 4px;" colspan="2"><strong>Proprietário:</strong> <span id="rep-proprietario">...</span></td>
                            </tr>
                            <tr><td style="border: 1px solid #000; padding: 4px;" colspan="4"><strong>Data Recebimento:</strong> <span id="rep-data">...</span></td></tr>
                        </table>
                    </div>
                    <form id="form-report-content" style="margin-top: 15px; font-family: 'Times New Roman', serif;">
                        <div class="report-section"><label>HISTÓRICO CLÍNICO</label><textarea name="historico" class="report-textarea" rows="2"></textarea></div>
                        <div class="report-section"><label>DESCRIÇÃO MACROSCÓPICA</label><textarea name="macroscopia" class="report-textarea" rows="3"></textarea></div>
                        <div class="report-section"><label>DESCRIÇÃO MICROSCÓPICA</label><textarea name="microscopia" class="report-textarea" rows="5"></textarea></div>
                        <div class="report-section"><label>DIAGNÓSTICO(S)</label><textarea name="diagnostico" class="report-textarea" rows="2" style="font-weight: bold;"></textarea></div>
                        <div class="report-section"><label>COMENTÁRIOS / NOTAS</label><textarea name="notas" class="report-textarea" rows="2"></textarea></div>
                    </form>
                    <div class="report-footer-signature" style="margin-top: 40px; font-family: 'Times New Roman', serif; font-size: 12px;">
                        <p>Data de emissão: <span id="rep-date-emission">Em andamento</span></p><br>
                        <div class="signature-line"><strong>Dra. Mariana Martins Flores</strong><br>Patologista / CRMV 14.636</div>
                        <div class="signature-line" style="margin-top: 20px;"><strong>Pós-Graduando(a):</strong> <span id="rep-pos-graduando">...</span></div>
                    </div>
                </div>
            </div>
        </div>

        `;
    }
}

customElements.define('lpv-form-laudo', formLaudo);