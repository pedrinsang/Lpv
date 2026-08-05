import { auth, db, logout, hasFullControl } from '../core.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const els = {
    newItem: document.getElementById('btn-new-item'),
    search: document.getElementById('inventory-search'),
    categoryFilter: document.getElementById('category-filter'),
    statusFilter: document.getElementById('status-filter'),
    loading: document.getElementById('inventory-loading'),
    empty: document.getElementById('inventory-empty'),
    emptyTitle: document.getElementById('empty-title'),
    emptyDescription: document.getElementById('empty-description'),
    tableWrap: document.getElementById('inventory-table-wrap'),
    tableBody: document.getElementById('inventory-table-body'),
    cardList: document.getElementById('inventory-card-list'),
    itemModal: document.getElementById('item-modal'),
    itemModalTitle: document.getElementById('item-modal-title'),
    itemForm: document.getElementById('item-form'),
    initialQuantityGroup: document.getElementById('initial-quantity-group'),
    movementModal: document.getElementById('movement-modal'),
    movementForm: document.getElementById('movement-form'),
    movementItemLabel: document.getElementById('movement-item-label'),
    movementQuantityLabel: document.getElementById('movement-quantity-label'),
    movementBalance: document.getElementById('movement-current-balance'),
    detailModal: document.getElementById('detail-modal'),
    detailContent: document.getElementById('detail-content'),
    toast: document.getElementById('inventory-toast')
};

const summaries = {
    low: document.getElementById('summary-low'),
    zero: document.getElementById('summary-zero'),
    expiring: document.getElementById('summary-expiring'),
    expired: document.getElementById('summary-expired'),
    total: document.getElementById('summary-total')
};

const STATUS_META = {
    normal: { label: 'Normal', icon: 'fa-circle-check' },
    low: { label: 'Estoque baixo', icon: 'fa-arrow-trend-down' },
    zero: { label: 'Zerado', icon: 'fa-ban' },
    expiring: { label: 'Vencendo', icon: 'fa-hourglass-half' },
    expired: { label: 'Vencido', icon: 'fa-calendar-xmark' },
    inactive: { label: 'Inativo', icon: 'fa-box-archive' }
};

let allItems = [];
let currentUser = null;
let currentUserData = null;
let canManage = false;
let selectedItemId = null;
let unsubscribeItems = null;
let toastTimer = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'auth.html';
        return;
    }

    currentUser = user;
    const profile = await getDoc(doc(db, 'users', user.uid));
    currentUserData = profile.exists() ? profile.data() : {};
    canManage = hasFullControl(currentUserData.role);

    els.newItem?.classList.toggle('hidden', !canManage);
    configureMovementPermissions();
    subscribeInventory();
});

document.getElementById('btn-logout')?.addEventListener('click', logout);
document.getElementById('logout-btn-header')?.addEventListener('click', logout);
els.newItem?.addEventListener('click', () => openItemModal());
els.search?.addEventListener('input', renderInventory);
els.categoryFilter?.addEventListener('change', renderInventory);
els.statusFilter?.addEventListener('change', renderInventory);
els.itemForm?.addEventListener('submit', saveItem);
els.movementForm?.addEventListener('submit', saveMovement);

document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
});

document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal(modal.id);
    });
});

document.querySelectorAll('.summary-card').forEach((card) => {
    card.addEventListener('click', () => {
        els.statusFilter.value = card.dataset.summaryFilter;
        renderInventory();
    });
});

document.querySelectorAll('input[name="type"]').forEach((input) => {
    input.addEventListener('change', syncMovementFields);
});

els.tableBody?.addEventListener('click', handleInventoryClick);
els.cardList?.addEventListener('click', handleInventoryClick);
els.detailContent?.addEventListener('click', handleDetailClick);

function subscribeInventory() {
    unsubscribeItems?.();
    unsubscribeItems = onSnapshot(collection(db, 'inventory_items'), (snapshot) => {
        allItems = snapshot.docs
            .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
            .sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name)));

        els.loading?.classList.add('hidden');
        updateCategoryFilter();
        updateSummary();
        renderInventory();

        if (selectedItemId && !els.detailModal.classList.contains('hidden')) {
            openDetail(selectedItemId);
        }
    }, (error) => {
        console.error('Erro ao carregar estoque:', error);
        els.loading.innerHTML = '<i class="fas fa-triangle-exclamation"></i><p>Não foi possível carregar o estoque.</p>';
    });
}

function getItemStatus(item) {
    if (item.active === false) return 'inactive';

    const quantity = toNumber(item.currentQuantity);
    const minimum = toNumber(item.minQuantity);
    const days = daysUntil(item.expiryDate);

    if (days !== null && days < 0) return 'expired';
    if (quantity <= 0) return 'zero';
    if (minimum > 0 && quantity <= minimum) return 'low';
    if (days !== null && days <= 30) return 'expiring';
    return 'normal';
}

function daysUntil(dateString) {
    if (!dateString) return null;
    const target = new Date(`${dateString}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((target - today) / 86400000);
}

function updateSummary() {
    const activeItems = allItems.filter((item) => item.active !== false);
    const counts = { low: 0, zero: 0, expiring: 0, expired: 0 };

    activeItems.forEach((item) => {
        const status = getItemStatus(item);
        if (Object.hasOwn(counts, status)) counts[status]++;
    });

    summaries.low.textContent = counts.low;
    summaries.zero.textContent = counts.zero;
    summaries.expiring.textContent = counts.expiring;
    summaries.expired.textContent = counts.expired;
    summaries.total.textContent = activeItems.length;
}

function updateCategoryFilter() {
    const current = els.categoryFilter.value;
    const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))]
        .sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)));

    els.categoryFilter.innerHTML = '<option value="">Todas as categorias</option>';
    categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        els.categoryFilter.appendChild(option);
    });

    if (categories.includes(current)) els.categoryFilter.value = current;
}

function getFilteredItems() {
    const term = normalizeText(els.search.value);
    const category = els.categoryFilter.value;
    const status = els.statusFilter.value;

    return allItems.filter((item) => {
        const blob = normalizeText([item.name, item.category, item.location, item.lot, item.notes, item.unit].join(' '));
        return (!term || blob.includes(term))
            && (!category || item.category === category)
            && (
                (status === 'all' && item.active !== false)
                || (status !== 'all' && getItemStatus(item) === status)
            );
    });
}

function renderInventory() {
    const items = getFilteredItems();
    const hasAnyItems = allItems.length > 0;

    document.querySelectorAll('.summary-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.summaryFilter === els.statusFilter.value);
    });

    els.empty.classList.toggle('hidden', items.length > 0);
    els.tableWrap.classList.toggle('hidden', items.length === 0);
    els.cardList.classList.toggle('hidden', items.length === 0);

    if (items.length === 0) {
        els.emptyTitle.textContent = hasAnyItems ? 'Nenhum item encontrado' : 'Nenhum item cadastrado';
        els.emptyDescription.textContent = hasAnyItems
            ? 'Tente alterar os filtros ou a busca.'
            : (canManage ? 'Use “Novo item” para começar seu estoque.' : 'Um responsável ainda não cadastrou itens no estoque.');
        els.tableBody.innerHTML = '';
        els.cardList.innerHTML = '';
        return;
    }

    els.tableBody.innerHTML = items.map(renderTableRow).join('');
    els.cardList.innerHTML = items.map(renderItemCard).join('');
}

function renderTableRow(item) {
    const status = getItemStatus(item);
    const meta = STATUS_META[status];
    const canMove = item.active !== false;

    return `
        <tr data-open-item="${escapeAttr(item.id)}">
            <td>
                <div class="item-name">${escapeHtml(item.name)}</div>
                <div class="item-meta">${escapeHtml(item.category || 'Sem categoria')}</div>
            </td>
            <td>
                <span class="quantity-value">${formatQuantity(item.currentQuantity)} ${escapeHtml(item.unit)}</span>
                <span class="quantity-minimum">mínimo: ${formatQuantity(item.minQuantity)} ${escapeHtml(item.unit)}</span>
            </td>
            <td>
                <div>${escapeHtml(item.location || 'Não informado')}</div>
                <div class="item-meta">${item.lot ? `Lote ${escapeHtml(item.lot)}` : 'Sem lote'}</div>
            </td>
            <td>${formatDate(item.expiryDate)}</td>
            <td>${renderStatusBadge(status, meta)}</td>
            <td>
                <div class="row-actions">
                    ${canMove ? `<button class="row-action" data-move-item="${escapeAttr(item.id)}" data-move-type="saida" title="Registrar saída"><i class="fas fa-arrow-up"></i></button>` : ''}
                    ${canMove && canManage ? `<button class="row-action" data-move-item="${escapeAttr(item.id)}" data-move-type="entrada" title="Registrar entrada"><i class="fas fa-arrow-down"></i></button>` : ''}
                    <button class="row-action" data-open-item="${escapeAttr(item.id)}" title="Ver detalhes"><i class="fas fa-eye"></i></button>
                </div>
            </td>
        </tr>`;
}

function renderItemCard(item) {
    const status = getItemStatus(item);
    const meta = STATUS_META[status];
    const canMove = item.active !== false;

    return `
        <article class="inventory-item-card" data-open-item="${escapeAttr(item.id)}">
            <div class="inventory-card-top">
                <div>
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    <div class="item-meta">${escapeHtml(item.category || 'Sem categoria')}</div>
                </div>
                ${renderStatusBadge(status, meta)}
            </div>
            <div class="inventory-card-balance">
                <div>
                    <span class="quantity-value">${formatQuantity(item.currentQuantity)} ${escapeHtml(item.unit)}</span>
                    <span class="quantity-minimum">mínimo: ${formatQuantity(item.minQuantity)} ${escapeHtml(item.unit)}</span>
                </div>
                <div class="inventory-card-location">
                    <div>${escapeHtml(item.location || 'Sem localização')}</div>
                    <div>${item.lot ? `Lote ${escapeHtml(item.lot)}` : formatDate(item.expiryDate)}</div>
                </div>
            </div>
            <div class="inventory-card-actions">
                ${canMove ? `<button data-move-item="${escapeAttr(item.id)}" data-move-type="saida"><i class="fas fa-arrow-up"></i> Saída</button>` : ''}
                ${canMove && canManage ? `<button data-move-item="${escapeAttr(item.id)}" data-move-type="entrada"><i class="fas fa-arrow-down"></i> Entrada</button>` : ''}
                <button data-open-item="${escapeAttr(item.id)}"><i class="fas fa-eye"></i> Detalhes</button>
            </div>
        </article>`;
}

function renderStatusBadge(status, meta = STATUS_META[status]) {
    return `<span class="status-badge status-${status}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>`;
}

function handleInventoryClick(event) {
    const movementButton = event.target.closest('[data-move-item]');
    if (movementButton) {
        event.stopPropagation();
        openMovementModal(movementButton.dataset.moveItem, movementButton.dataset.moveType);
        return;
    }

    const itemTarget = event.target.closest('[data-open-item]');
    if (itemTarget) openDetail(itemTarget.dataset.openItem);
}

function handleDetailClick(event) {
    const movementButton = event.target.closest('[data-detail-move]');
    if (movementButton) {
        closeModal('detail-modal');
        openMovementModal(selectedItemId, movementButton.dataset.detailMove);
        return;
    }

    if (event.target.closest('[data-edit-item]')) {
        const item = allItems.find((candidate) => candidate.id === selectedItemId);
        closeModal('detail-modal');
        openItemModal(item);
        return;
    }

    if (event.target.closest('[data-toggle-item]')) toggleItemActive(selectedItemId);
}

function openItemModal(item = null) {
    if (!canManage) return showToast('Você não tem permissão para cadastrar ou editar itens.', true);

    els.itemForm.reset();
    els.itemForm.elements.itemId.value = item?.id || '';
    els.itemModalTitle.textContent = item ? 'Editar item' : 'Novo item';
    els.initialQuantityGroup.classList.toggle('hidden', !!item);
    els.itemForm.elements.initialQuantity.required = !item;

    if (item) {
        ['name', 'category', 'unit', 'location', 'minQuantity', 'lot', 'expiryDate', 'notes'].forEach((field) => {
            els.itemForm.elements[field].value = item[field] ?? '';
        });
    } else {
        els.itemForm.elements.minQuantity.value = '0';
        els.itemForm.elements.initialQuantity.value = '0';
    }

    openModal('item-modal');
    setTimeout(() => els.itemForm.elements.name.focus(), 50);
}

async function saveItem(event) {
    event.preventDefault();
    if (!canManage) return;

    const submit = els.itemForm.querySelector('button[type="submit"]');
    const original = submit.innerHTML;
    setLoading(submit, true);

    const formData = new FormData(els.itemForm);
    const itemId = formData.get('itemId');
    const payload = {
        name: cleanText(formData.get('name')),
        category: cleanText(formData.get('category')),
        unit: cleanText(formData.get('unit')),
        location: cleanText(formData.get('location')),
        minQuantity: toNumber(formData.get('minQuantity')),
        lot: cleanText(formData.get('lot')),
        expiryDate: formData.get('expiryDate') || '',
        notes: cleanText(formData.get('notes')),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
        updatedByName: currentUserData.name || currentUser.email || ''
    };

    try {
        if (!payload.name || !payload.category || !payload.unit) throw new Error('Preencha nome, categoria e unidade.');
        if (payload.minQuantity < 0) throw new Error('O estoque mínimo não pode ser negativo.');

        if (itemId) {
            await updateDoc(doc(db, 'inventory_items', itemId), payload);
            showToast('Item atualizado com sucesso.');
        } else {
            const initialQuantity = toNumber(formData.get('initialQuantity'));
            if (initialQuantity < 0) throw new Error('A quantidade inicial não pode ser negativa.');
            const itemRef = doc(collection(db, 'inventory_items'));
            const batch = writeBatch(db);

            batch.set(itemRef, {
                ...payload,
                currentQuantity: initialQuantity,
                active: true,
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                createdByName: currentUserData.name || currentUser.email || ''
            });

            if (initialQuantity > 0) {
                const movementRef = doc(collection(db, 'inventory_movements'));
                batch.set(movementRef, {
                    itemId: itemRef.id,
                    itemName: payload.name,
                    unit: payload.unit,
                    type: 'entrada',
                    quantity: initialQuantity,
                    delta: initialQuantity,
                    previousQuantity: 0,
                    resultingQuantity: initialQuantity,
                    reason: 'Saldo inicial',
                    lot: payload.lot,
                    expiryDate: payload.expiryDate,
                    createdAt: serverTimestamp(),
                    createdBy: currentUser.uid,
                    createdByName: currentUserData.name || currentUser.email || ''
                });
            }

            await batch.commit();
            showToast('Item cadastrado com sucesso.');
        }

        closeModal('item-modal');
    } catch (error) {
        console.error('Erro ao salvar item:', error);
        showToast(error.message || 'Não foi possível salvar o item.', true);
    } finally {
        setLoading(submit, false, original);
    }
}

function configureMovementPermissions() {
    document.querySelectorAll('[data-movement-option]').forEach((option) => {
        const type = option.dataset.movementOption;
        option.classList.toggle('hidden', !canManage && type !== 'saida');
    });

    if (!canManage) {
        const output = els.movementForm.querySelector('input[value="saida"]');
        if (output) output.checked = true;
    }
}

function openMovementModal(itemId, preferredType = 'saida') {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item || item.active === false) return showToast('Este item não está disponível para movimentação.', true);

    const type = canManage ? preferredType : 'saida';
    els.movementForm.reset();
    els.movementForm.elements.itemId.value = itemId;
    const typeInput = els.movementForm.querySelector(`input[name="type"][value="${type}"]`);
    if (typeInput) typeInput.checked = true;

    els.movementItemLabel.textContent = item.name;
    els.movementBalance.textContent = `${formatQuantity(item.currentQuantity)} ${item.unit}`;
    syncMovementFields();
    openModal('movement-modal');
    setTimeout(() => els.movementForm.elements.quantity.focus(), 50);
}

function syncMovementFields() {
    const type = els.movementForm.elements.type.value || 'saida';
    els.movementQuantityLabel.textContent = type === 'ajuste' ? 'Nova quantidade *' : 'Quantidade *';
    els.movementForm.elements.quantity.min = type === 'ajuste' ? '0' : '0.000001';
    document.querySelectorAll('.entry-extra').forEach((field) => field.classList.toggle('hidden', type !== 'entrada'));
}

async function saveMovement(event) {
    event.preventDefault();

    const submit = els.movementForm.querySelector('button[type="submit"]');
    const original = submit.innerHTML;
    const formData = new FormData(els.movementForm);
    const itemId = formData.get('itemId');
    const requestedType = formData.get('type');
    const type = canManage ? requestedType : 'saida';
    const quantityInput = toNumber(formData.get('quantity'));
    const reason = cleanText(formData.get('reason'));
    const lot = cleanText(formData.get('lot'));
    const expiryDate = formData.get('expiryDate') || '';

    setLoading(submit, true);

    try {
        if (!reason) throw new Error('Informe o motivo da movimentação.');
        if (type !== 'ajuste' && quantityInput <= 0) throw new Error('A quantidade deve ser maior que zero.');
        if (type === 'ajuste' && quantityInput < 0) throw new Error('A nova quantidade não pode ser negativa.');

        const itemRef = doc(db, 'inventory_items', itemId);
        const movementRef = doc(collection(db, 'inventory_movements'));

        await runTransaction(db, async (transaction) => {
            const itemSnapshot = await transaction.get(itemRef);
            if (!itemSnapshot.exists()) throw new Error('Item não encontrado.');

            const item = itemSnapshot.data();
            if (item.active === false) throw new Error('Este item está inativo.');

            const previousQuantity = toNumber(item.currentQuantity);
            let resultingQuantity = previousQuantity;

            if (type === 'entrada') resultingQuantity += quantityInput;
            if (type === 'saida') resultingQuantity -= quantityInput;
            if (type === 'ajuste') resultingQuantity = quantityInput;

            if (resultingQuantity < 0) throw new Error('A saída é maior que o saldo disponível.');
            if (resultingQuantity === previousQuantity) throw new Error('A movimentação não altera o saldo.');

            const delta = resultingQuantity - previousQuantity;
            const updatePayload = {
                currentQuantity: resultingQuantity,
                lastMovementId: movementRef.id,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid,
                updatedByName: currentUserData.name || currentUser.email || ''
            };

            if (type === 'entrada' && lot) updatePayload.lot = lot;
            if (type === 'entrada' && expiryDate) updatePayload.expiryDate = expiryDate;

            transaction.update(itemRef, updatePayload);
            transaction.set(movementRef, {
                itemId,
                itemName: item.name,
                unit: item.unit,
                type,
                quantity: type === 'ajuste' ? Math.abs(delta) : quantityInput,
                delta,
                previousQuantity,
                resultingQuantity,
                reason,
                lot: type === 'entrada' ? lot : '',
                expiryDate: type === 'entrada' ? expiryDate : '',
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                createdByName: currentUserData.name || currentUser.email || ''
            });
        });

        closeModal('movement-modal');
        showToast('Movimentação registrada com sucesso.');
    } catch (error) {
        console.error('Erro ao movimentar estoque:', error);
        showToast(error.message || 'Não foi possível registrar a movimentação.', true);
    } finally {
        setLoading(submit, false, original);
    }
}

async function openDetail(itemId) {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    selectedItemId = itemId;
    const status = getItemStatus(item);

    els.detailContent.innerHTML = `
        <div class="inventory-modal-header">
            <span class="modal-icon"><i class="fas fa-box"></i></span>
            <div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.category || 'Sem categoria')}</p></div>
        </div>
        <div class="detail-hero">
            <div class="detail-hero-top">
                ${renderStatusBadge(status)}
                <span class="item-meta">${item.active === false ? 'Item arquivado' : 'Item ativo'}</span>
            </div>
            <div class="detail-balance-row">
                <div>
                    <div class="item-meta">Saldo disponível</div>
                    <div class="detail-balance">${formatQuantity(item.currentQuantity)} ${escapeHtml(item.unit)}</div>
                    <div class="item-meta">Mínimo: ${formatQuantity(item.minQuantity)} ${escapeHtml(item.unit)}</div>
                </div>
                <div class="detail-actions">
                    ${item.active !== false ? `<button class="btn btn-secondary" data-detail-move="saida"><i class="fas fa-arrow-up"></i> Saída</button>` : ''}
                    ${item.active !== false && canManage ? `<button class="btn btn-secondary" data-detail-move="entrada"><i class="fas fa-arrow-down"></i> Entrada</button>` : ''}
                    ${item.active !== false && canManage ? `<button class="btn btn-secondary" data-detail-move="ajuste"><i class="fas fa-sliders"></i> Ajuste</button>` : ''}
                </div>
            </div>
        </div>
        <div class="detail-grid">
            ${detailInfo('Localização', item.location || 'Não informada')}
            ${detailInfo('Lote atual', item.lot || 'Não informado')}
            ${detailInfo('Validade atual', formatDate(item.expiryDate))}
            ${detailInfo('Categoria', item.category || 'Não informada')}
            ${detailInfo('Unidade', item.unit || 'Não informada')}
            ${detailInfo('Observações', item.notes || 'Nenhuma')}
        </div>
        ${canManage ? `
            <div class="detail-actions" style="margin-bottom:18px;">
                <button class="btn btn-secondary" data-edit-item><i class="fas fa-pen"></i> Editar cadastro</button>
                <button class="btn btn-secondary" data-toggle-item style="color:${item.active === false ? 'var(--color-success)' : 'var(--color-error)'};">
                    <i class="fas ${item.active === false ? 'fa-box-open' : 'fa-box-archive'}"></i>
                    ${item.active === false ? 'Reativar item' : 'Arquivar item'}
                </button>
            </div>` : ''}
        <h3 class="history-title">Histórico de movimentações</h3>
        <div id="movement-history" class="movement-history">
            <div class="inventory-empty" style="min-height:120px;padding:1rem;"><i class="fas fa-spinner fa-spin" style="font-size:1.2rem;"></i></div>
        </div>`;

    openModal('detail-modal');
    await loadMovementHistory(itemId);
}

async function loadMovementHistory(itemId) {
    const container = document.getElementById('movement-history');
    if (!container) return;

    try {
        const snapshot = await getDocs(query(collection(db, 'inventory_movements'), where('itemId', '==', itemId)));
        const movements = snapshot.docs
            .map((movementDoc) => ({ id: movementDoc.id, ...movementDoc.data() }))
            .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

        if (!movements.length) {
            container.innerHTML = '<div class="item-meta" style="padding:12px 0;">Nenhuma movimentação registrada.</div>';
            return;
        }

        container.innerHTML = movements.map((movement) => `
            <div class="movement-row">
                <div class="movement-kind ${escapeAttr(movement.type)}">${escapeHtml(movement.type)}</div>
                <div class="movement-description">
                    <strong>${escapeHtml(movement.reason || 'Sem motivo informado')}</strong>
                    <small>${escapeHtml(movement.createdByName || 'Usuário')} · ${formatTimestamp(movement.createdAt)}</small>
                </div>
                <div class="movement-result">
                    ${movement.delta > 0 ? '+' : ''}${formatQuantity(movement.delta)} ${escapeHtml(movement.unit || '')}
                    <small>saldo ${formatQuantity(movement.resultingQuantity)}</small>
                </div>
            </div>`).join('');
    } catch (error) {
        console.error('Erro ao carregar movimentações:', error);
        container.innerHTML = '<div class="item-meta" style="padding:12px 0;">Não foi possível carregar o histórico.</div>';
    }
}

async function toggleItemActive(itemId) {
    if (!canManage) return;
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    const willActivate = item.active === false;
    const question = willActivate
        ? `Reativar “${item.name}”?`
        : `Arquivar “${item.name}”? O histórico será preservado.`;
    if (!confirm(question)) return;

    try {
        await updateDoc(doc(db, 'inventory_items', itemId), {
            active: willActivate,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
            updatedByName: currentUserData.name || currentUser.email || ''
        });
        showToast(willActivate ? 'Item reativado.' : 'Item arquivado.');
    } catch (error) {
        console.error(error);
        showToast('Não foi possível alterar o item.', true);
    }
}

function detailInfo(label, value) {
    return `<div class="detail-info"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function setLoading(button, loading, original = '') {
    button.disabled = loading;
    button.innerHTML = loading ? '<i class="fas fa-spinner fa-spin"></i> Salvando...' : original;
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle('error', isError);
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3500);
}

function cleanText(value) {
    return (value || '').toString().trim();
}

function normalizeText(value) {
    return cleanText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatQuantity(value) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(toNumber(value));
}

function formatDate(value) {
    if (!value) return 'Não informada';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? 'Não informada' : date.toLocaleDateString('pt-BR');
}

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatTimestamp(value) {
    const millis = timestampMillis(value);
    return millis ? new Date(millis).toLocaleString('pt-BR') : 'agora';
}

function escapeHtml(value) {
    return cleanText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}
