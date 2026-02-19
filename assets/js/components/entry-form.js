// assets/js/components/entry-form.js

class LpvEntryForm extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div id="entry-modal" class="modal-overlay hidden">
            <div class="modal-glass">
                <div class="modal-header-tabs">
                    <h2 style="margin-bottom: 1rem;">Nova Entrada</h2>
                    <div class="tabs-container">
                        <button class="tab-btn active" data-tab="tab-v">Novo V</button>
                        <button class="tab-btn" data-tab="tab-vn">Novo Vn</button>
                        <button class="tab-btn" data-tab="tab-special">Coloração Especial</button>
                    </div>
                    <button id="close-modal-btn" class="btn-close-modal"><i class="fas fa-times"></i></button>
                </div>

                <div id="tab-v" class="tab-content active">
                    <form id="form-new-v">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Nº Protocolo Interno</label>
                                <input type="text" name="protocolo" placeholder="Ex: V-123/26" class="input-field" required>
                            </div>
                            <div class="form-group">
                                <label>Data Entrada</label>
                                <input type="date" name="dataEntrada" id="date-v" class="input-field" required>
                            </div>

                            <div class="form-group span-2">
                                <label>Remetente (Clínica/Vet)</label>
                                <input type="text" name="remetente" class="input-field" required>
                            </div>
                            <div class="form-group">
                                <label>Situação Financeira</label>
                                <select name="situacao" class="input-field">
                                    <option value="pendente">Pendente</option>
                                    <option value="pago">Pago</option>
                                    <option value="didatico">Interesse Didático (Isento)</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Valor (R$)</label>
                                <input type="text" name="valor" placeholder="0,00" class="input-field" inputmode="decimal">
                            </div>

                            <div class="form-group">
                                <label>Docente Responsável</label>
                                <select name="docente" id="select-docente" class="input-field" required>
                                    <option value="" disabled selected>Carregando...</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Pós-Graduando</label>
                                <select name="posGraduando" id="select-pos" class="input-field" required>
                                    <option value="" disabled selected>Carregando...</option>
                                </select>
                            </div>

                            <div class="span-3 divider-text">Dados do Animal</div>

                            <div class="form-group span-2">
                                <label>Nome do Animal</label>
                                <input type="text" name="animalNome" class="input-field" required>
                            </div>
                            <div class="form-group">
                                <label>RG do Animal</label>
                                <input type="text" name="animalRg" class="input-field">
                            </div>
                            <div class="form-group">
                                <label>Proprietário</label>
                                <input type="text" name="proprietario" class="input-field" required>
                            </div>

                            <div class="form-group">
                                <label>Espécie</label>
                                <input type="text" name="especie" placeholder="Canina" class="input-field" required>
                            </div>
                            <div class="form-group">
                                <label>Raça</label>
                                <input type="text" name="raca" class="input-field">
                            </div>
                            <div class="form-group">        
                                <label>Sexo</label>
                                <select name="sexo" class="input-field">
                                    <option value="M">M</option>
                                    <option value="F">F</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <label>Idade</label>
                                <input type="text" name="idade" class="input-field">
                            </div>
                            <div class="form-group">        
                                <label>Origem</label>
                                <select name="origem" class="input-field">
                                    <option value="HVU">HVU</option>
                                    <option value="Externo">Externo</option>
                                </select>
                            </div>                            
                        </div>

                        <input type="hidden" name="accessCode" id="generated-access-code">

                        <div class="modal-footer" style="flex-direction: column; align-items: flex-start; gap: 15px;">
                            <div class="code-preview" style="width: 100%;">
                                <span style="font-size: 1rem; color: var(--text-secondary); display: block; margin-bottom: 5px;">Código Público Gerado:</span>
                                <div class="tm-code-row" style="display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.05); padding: 2px 8px; border-radius: 8px; width: fit-content;">
                                    <span id="display-code" style="font-family: monospace; font-weight: 700; color: var(--color-primary); font-size: 1.1rem; white-space: nowrap;">...</span>
                                    <button type="button" id="btn-copy-code" class="btn-copy-code" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 5px;" title="Copiar código">
                                        <i class="far fa-copy"></i>
                                    </button>
                                </div>
                            </div>
                            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
                                <i class="fas fa-save"></i> Salvar Entrada
                            </button>
                        </div>
                    </form>
                </div>

                <div id="tab-vn" class="tab-content">
                    <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                        <i class="fas fa-tools"></i> Funcionalidade em desenvolvimento (Vn).
                    </div>
                </div>

                <div id="tab-special" class="tab-content">
                    <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                        <i class="fas fa-tools"></i> Funcionalidade em desenvolvimento (Coloração).
                    </div>
                </div>
            </div>
        </div>
        `;
    }
}

customElements.define('lpv-entry-form', LpvEntryForm);