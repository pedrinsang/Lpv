// entry-form.js
// Formulário único de entrada: o prefixo do protocolo define o tipo do caso
// (V = biópsia, VN = necropsia), então não há mais abas por tipo.

class LpvEntryForm extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div id="entry-modal" class="modal-overlay hidden">
            <div class="modal-glass">
                <div class="modal-header">
                    <h2 id="entry-modal-title" style="margin: 0;">Nova Entrada</h2>
                    <button id="close-modal-btn" class="btn-close-modal"><i class="fas fa-times"></i></button>
                </div>

                <form id="form-new-entry">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Nº Protocolo Interno</label>
                            <input type="text" name="protocolo" id="entry-protocolo" placeholder="Ex: V-123/26 ou VN-123/26" class="input-field" required autocomplete="off">
                            <small class="field-hint"><strong>V</strong> = biópsia &nbsp;·&nbsp; <strong>VN</strong> = necropsia</small>
                        </div>
                        <div class="form-group">
                            <label>Data Entrada</label>
                            <input type="date" name="dataEntrada" id="date-entrada" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>Tipo detectado</label>
                            <span id="entry-type-pill" class="entry-type-pill is-empty">
                                <i class="fas fa-circle-question"></i><span id="entry-type-text">Informe o protocolo</span>
                            </span>
                        </div>

                        <label class="urgent-toggle span-3" for="entry-urgent">
                            <input type="checkbox" name="isUrgent" id="entry-urgent">
                            <span class="urgent-toggle-mark"><i class="fas fa-triangle-exclamation"></i></span>
                            <span class="urgent-toggle-text">
                                <strong>Marcar como amostra urgente</strong>
                                <small>Somente amostras urgentes aparecem no painel "Urgências" do Hub.</small>
                            </span>
                        </label>

                        <div class="form-group span-2">
                            <label>Remetente</label>
                            <input type="text" name="remetente" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>CRMV do Remetente</label>
                            <input type="text" name="remetenteCrmv" class="input-field" placeholder="Ex: CRMV-RS 12345">
                        </div>
                        <div class="form-group">
                            <label>Contato do Remetente</label>
                            <input type="text" name="remetenteContato" class="input-field" placeholder="Telefone ou WhatsApp">
                        </div>
                        <div class="form-group">
                            <label>Clínica / Empresa</label>
                            <input type="text" name="remetenteClinicaEmpresa" class="input-field" placeholder="Nome da clínica ou empresa">
                        </div>
                        <div class="form-group">
                            <label>Origem</label>
                            <select name="origem" class="input-field">
                                <option value="Externo">Externo</option>
                                <option value="HVU">HVU</option>
                            </select>
                        </div>
                        <div class="form-group span-3">
                            <label>Endereço do Remetente</label>
                            <input type="text" name="remetenteEndereco" class="input-field" placeholder="Rua, número, bairro, cidade">
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
                            <select name="docente" id="select-docente" class="input-field">
                                <option value="" disabled selected>Carregando...</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Pós-Graduando</label>
                            <select name="posGraduando" id="select-pos" class="input-field">
                                <option value="" disabled selected>Carregando...</option>
                            </select>
                        </div>
                        <input type="hidden" name="posResponsavelUid" id="select-pos-uid">

                        <div class="span-3 divider-text">Dados do Animal</div>

                        <div class="form-group span-2">
                            <label>Nome do Animal</label>
                            <input type="text" name="animalNome" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>RG do Animal</label>
                            <input type="text" name="animalRg" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>Proprietário</label>
                            <input type="text" name="proprietario" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>Contato do Proprietário</label>
                            <input type="text" name="proprietarioContato" class="input-field" placeholder="Telefone ou WhatsApp">
                        </div>
                        <div class="form-group">
                            <label>Espécie</label>
                            <input type="text" name="especie" placeholder="Canina" class="input-field">
                        </div>
                        <div class="form-group span-3">
                            <label>Endereço do Proprietário</label>
                            <input type="text" name="proprietarioEndereco" class="input-field" placeholder="Rua, número, bairro, cidade">
                        </div>

                        <div class="form-group">
                            <label>Raça</label>
                            <input type="text" name="raca" class="input-field">
                        </div>
                        <div class="form-group">
                            <label>Sexo</label>
                            <select name="sexo" class="input-field">
                                <option value="M">Macho</option>
                                <option value="F">Fêmea</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Idade</label>
                            <input type="text" name="idade" class="input-field">
                        </div>

                        <div class="form-group span-3">
                            <label>Fotos Internas (uso exclusivo do laboratório)</label>
                            <input type="file" name="internalPhotos" class="input-field" accept="image/*" multiple>
                            <small class="field-hint">As imagens selecionadas sao enviadas para o Cloudinary.</small>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
                            <i class="fas fa-save"></i> Salvar Entrada
                        </button>
                    </div>
                </form>
            </div>
        </div>
        `;
    }
}

customElements.define('lpv-entry-form', LpvEntryForm);
