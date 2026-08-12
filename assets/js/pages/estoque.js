import { auth, db, logout, hasFullControl } from '../core.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import {
    DEFAULT_ALERT_LEAD_DAYS,
    STATUS_META,
    addDays,
    describeDeadline,
    durationToDays,
    formatDate,
    formatDays,
    formatDuration,
    formatQuantity,
    getCycleInfo,
    getItemStatus,
    toNumber,
    todayString
} from '../lib/estoque-ciclo.js';

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
    cyclePreview: document.getElementById('cycle-preview'),
    purchaseModal: document.getElementById('purchase-modal'),
    purchaseForm: document.getElementById('purchase-form'),
    purchaseItemLabel: document.getElementById('purchase-item-label'),
    purchaseQuantityLabel: document.getElementById('purchase-quantity-label'),
    purchasePreview: document.getElementById('purchase-preview'),
    checkModal: document.getElementById('check-modal'),
    checkForm: document.getElementById('check-form'),
    checkItemLabel: document.getElementById('check-item-label'),
    checkCustomGroup: document.getElementById('check-custom-group'),
    detailModal: document.getElementById('detail-modal'),
    detailContent: document.getElementById('detail-content'),
    toast: document.getElementById('inventory-toast')
};

const summaries = {
    due: document.getElementById('summary-due'),
    soon: document.getElementById('summary-soon'),
    pending: document.getElementById('summary-pending'),
    total: document.getElementById('summary-total')
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
    subscribeInventory();
});

document.getElementById('btn-logout')?.addEventListener('click', logout);
document.getElementById('logout-btn-header')?.addEventListener('click', logout);
els.newItem?.addEventListener('click', () => openItemModal());
els.search?.addEventListener('input', renderInventory);
els.categoryFilter?.addEventListener('change', renderInventory);
els.statusFilter?.addEventListener('change', renderInventory);
els.itemForm?.addEventListener('submit', saveItem);
els.itemForm?.addEventListener('input', updateCyclePreview);
els.itemForm?.addEventListener('change', updateCyclePreview);
els.purchaseForm?.addEventListener('submit', savePurchase);
els.purchaseForm?.addEventListener('input', updatePurchasePreview);
els.purchaseForm?.addEventListener('change', updatePurchasePreview);
els.checkForm?.addEventListener('submit', saveCheck);
els.checkForm?.addEventListener('change', syncCheckFields);
els.checkForm?.querySelector('[data-open-purchase-from-check]')?.addEventListener('click', () => {
    const itemId = els.checkForm.elements.itemId.value;
    closeModal('check-modal');
    openPurchaseModal(itemId);
});

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

els.tableBody?.addEventListener('click', handleInventoryClick);
els.cardList?.addEventListener('click', handleInventoryClick);
els.detailContent?.addEventListener('click', handleDetailClick);

function subscribeInventory() {
    unsubscribeItems?.();
    unsubscribeItems = onSnapshot(collection(db, 'inventory_items'), (snapshot) => {
        allItems = snapshot.docs
            .map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
            .sort(compareByUrgency);

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

// O que está para acabar vem primeiro; itens sem previsão no fim.
function compareByUrgency(a, b) {
    const rank = { due: 0, soon: 1, ok: 2, snoozed: 3, pending: 4 };
    const statusA = getItemStatus(a);
    const statusB = getItemStatus(b);
    if (rank[statusA] !== rank[statusB]) return rank[statusA] - rank[statusB];

    const leftA = getCycleInfo(a).daysLeft;
    const leftB = getCycleInfo(b).daysLeft;
    if (leftA !== null && leftB !== null && leftA !== leftB) return leftA - leftB;

    return normalizeText(a.name).localeCompare(normalizeText(b.name));
}

function updateSummary() {
    const counts = { due: 0, soon: 0, pending: 0 };

    allItems.forEach((item) => {
        const status = getItemStatus(item);
        if (Object.hasOwn(counts, status)) counts[status]++;
    });

    summaries.due.textContent = counts.due;
    summaries.soon.textContent = counts.soon;
    summaries.pending.textContent = counts.pending;
    summaries.total.textContent = allItems.length;
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
        const blob = normalizeText([item.name, item.category, item.location, item.notes, item.unit].join(' '));
        return (!term || blob.includes(term))
            && (!category || item.category === category)
            && (status === 'all' || getItemStatus(item) === status);
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

function renderReference(item, cycle) {
    if (!cycle.hasReference) return '<span class="item-meta">Referência não definida</span>';
    return `
        <span class="cycle-reference">${formatQuantity(cycle.referenceQuantity)} ${escapeHtml(item.unit)}</span>
        <span class="item-meta">duram ~${formatDuration(cycle.referenceDays)}</span>`;
}

function renderLastPurchase(item, cycle) {
    if (!cycle.hasPurchase) return '<span class="item-meta">Nenhuma compra registrada</span>';
    return `
        <div>${formatQuantity(cycle.quantity)} ${escapeHtml(item.unit)}</div>
        <div class="item-meta">em ${formatDate(cycle.purchaseDate)}</div>`;
}

function renderForecast(cycle) {
    if (!cycle.hasPurchase) return '<span class="item-meta">—</span>';

    const tone = cycle.daysLeft < 0 ? 'is-late' : (cycle.daysLeft <= cycle.alertLeadDays ? 'is-near' : 'is-ok');
    return `
        <div class="forecast-date">${formatDate(cycle.expectedEndDate)}</div>
        <div class="forecast-left ${tone}">${describeDeadline(cycle)}</div>
        <div class="cycle-bar"><span class="cycle-bar-fill ${tone}" style="width:${Math.round(cycle.progress * 100)}%"></span></div>`;
}

function renderRowActions(item, { compact = false } = {}) {
    if (!canManage) {
        return compact
            ? `<button data-open-item="${escapeAttr(item.id)}"><i class="fas fa-eye"></i> Detalhes</button>`
            : `<button class="row-action" data-open-item="${escapeAttr(item.id)}" title="Ver detalhes"><i class="fas fa-eye"></i></button>`;
    }

    if (compact) {
        return `
            <button data-purchase-item="${escapeAttr(item.id)}"><i class="fas fa-cart-shopping"></i> Comprei</button>
            <button data-check-item="${escapeAttr(item.id)}"><i class="fas fa-clipboard-check"></i> Conferi</button>
            <button data-open-item="${escapeAttr(item.id)}"><i class="fas fa-eye"></i> Detalhes</button>`;
    }

    return `
        <button class="row-action" data-purchase-item="${escapeAttr(item.id)}" title="Registrar compra"><i class="fas fa-cart-shopping"></i></button>
        <button class="row-action" data-check-item="${escapeAttr(item.id)}" title="Conferi no laboratório"><i class="fas fa-clipboard-check"></i></button>
        <button class="row-action" data-open-item="${escapeAttr(item.id)}" title="Ver detalhes"><i class="fas fa-eye"></i></button>`;
}

function renderTableRow(item) {
    const cycle = getCycleInfo(item);
    const status = getItemStatus(item, cycle);

    return `
        <tr data-open-item="${escapeAttr(item.id)}">
            <td>
                <div class="item-name">${escapeHtml(item.name)}</div>
                <div class="item-meta">${escapeHtml(item.category || 'Sem categoria')}</div>
            </td>
            <td>${renderReference(item, cycle)}</td>
            <td>${renderLastPurchase(item, cycle)}</td>
            <td>${renderForecast(cycle)}</td>
            <td>${renderStatusBadge(status, cycle)}</td>
            <td><div class="row-actions">${renderRowActions(item)}</div></td>
        </tr>`;
}

function renderItemCard(item) {
    const cycle = getCycleInfo(item);
    const status = getItemStatus(item, cycle);

    return `
        <article class="inventory-item-card" data-open-item="${escapeAttr(item.id)}">
            <div class="inventory-card-top">
                <div>
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    <div class="item-meta">${escapeHtml(item.category || 'Sem categoria')}</div>
                </div>
                ${renderStatusBadge(status, cycle)}
            </div>
            <div class="inventory-card-forecast">${renderForecast(cycle)}</div>
            <div class="inventory-card-meta">
                <div>${renderReference(item, cycle)}</div>
                <div class="inventory-card-location">${renderLastPurchase(item, cycle)}</div>
            </div>
            <div class="inventory-card-actions">${renderRowActions(item, { compact: true })}</div>
        </article>`;
}

function renderStatusBadge(status, cycle) {
    const meta = STATUS_META[status];
    const title = status === 'snoozed' && cycle?.snoozedUntil
        ? ` title="Volta a avisar em ${formatDate(cycle.snoozedUntil)}"`
        : '';
    return `<span class="status-badge status-${status}"${title}><i class="fas ${meta.icon}"></i> ${meta.label}</span>`;
}

function handleInventoryClick(event) {
    const purchaseButton = event.target.closest('[data-purchase-item]');
    if (purchaseButton) {
        event.stopPropagation();
        openPurchaseModal(purchaseButton.dataset.purchaseItem);
        return;
    }

    const checkButton = event.target.closest('[data-check-item]');
    if (checkButton) {
        event.stopPropagation();
        openCheckModal(checkButton.dataset.checkItem);
        return;
    }

    const itemTarget = event.target.closest('[data-open-item]');
    if (itemTarget) openDetail(itemTarget.dataset.openItem);
}

function handleDetailClick(event) {
    if (event.target.closest('[data-detail-purchase]')) {
        closeModal('detail-modal');
        openPurchaseModal(selectedItemId);
        return;
    }

    if (event.target.closest('[data-detail-check]')) {
        closeModal('detail-modal');
        openCheckModal(selectedItemId);
        return;
    }

    if (event.target.closest('[data-edit-item]')) {
        const item = allItems.find((candidate) => candidate.id === selectedItemId);
        closeModal('detail-modal');
        openItemModal(item);
        return;
    }

    if (event.target.closest('[data-delete-item]')) deleteItem(selectedItemId);
}

// ---------------------------------------------------------------- cadastro

function openItemModal(item = null) {
    if (!canManage) return showToast('Você não tem permissão para cadastrar ou editar itens.', true);

    els.itemForm.reset();
    els.itemForm.elements.itemId.value = item?.id || '';
    els.itemModalTitle.textContent = item ? 'Editar item' : 'Novo item';

    if (item) {
        ['name', 'category', 'unit', 'location', 'notes'].forEach((field) => {
            els.itemForm.elements[field].value = item[field] ?? '';
        });
        els.itemForm.elements.referenceQuantity.value = item.referenceQuantity ?? '';
        els.itemForm.elements.durationValue.value = item.referenceDurationValue ?? '';
        els.itemForm.elements.durationUnit.value = item.referenceDurationUnit || 'meses';
        els.itemForm.elements.alertLeadDays.value = item.alertLeadDays ?? DEFAULT_ALERT_LEAD_DAYS;
    } else {
        els.itemForm.elements.durationUnit.value = 'meses';
        els.itemForm.elements.alertLeadDays.value = DEFAULT_ALERT_LEAD_DAYS;
    }

    updateCyclePreview();
    openModal('item-modal');
    setTimeout(() => els.itemForm.elements.name.focus(), 50);
}

function updateCyclePreview() {
    if (!els.cyclePreview) return;

    const quantity = toNumber(els.itemForm.elements.referenceQuantity.value);
    const days = durationToDays(els.itemForm.elements.durationValue.value, els.itemForm.elements.durationUnit.value);
    const unit = cleanText(els.itemForm.elements.unit.value) || 'un.';

    if (quantity <= 0 || days <= 0) {
        els.cyclePreview.textContent = 'Exemplo: 50 L de formol duram 3 meses. Se um dia a compra for de 100 L, o sistema já prevê 6 meses sozinho.';
        els.cyclePreview.classList.remove('is-active');
        return;
    }

    const double = formatDuration(days * 2);
    els.cyclePreview.innerHTML = `Com essa referência, uma compra de <strong>${formatQuantity(quantity * 2)} ${escapeHtml(unit)}</strong> passa a durar <strong>${double}</strong>.`;
    els.cyclePreview.classList.add('is-active');
}

async function saveItem(event) {
    event.preventDefault();
    if (!canManage) return;

    const submit = els.itemForm.querySelector('button[type="submit"]');
    const original = submit.innerHTML;
    setLoading(submit, true);

    const formData = new FormData(els.itemForm);
    const itemId = formData.get('itemId');
    const durationValue = toNumber(formData.get('durationValue'));
    const durationUnit = formData.get('durationUnit') || 'meses';

    const payload = {
        name: cleanText(formData.get('name')),
        category: cleanText(formData.get('category')),
        unit: cleanText(formData.get('unit')),
        location: cleanText(formData.get('location')),
        notes: cleanText(formData.get('notes')),
        referenceQuantity: toNumber(formData.get('referenceQuantity')),
        referenceDurationValue: durationValue,
        referenceDurationUnit: durationUnit,
        referenceDays: durationToDays(durationValue, durationUnit),
        alertLeadDays: Math.round(toNumber(formData.get('alertLeadDays'))),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
        updatedByName: currentUserData.name || currentUser.email || ''
    };

    try {
        if (!payload.name || !payload.category || !payload.unit) throw new Error('Preencha nome, categoria e unidade.');
        if (payload.referenceQuantity <= 0) throw new Error('A quantidade de referência deve ser maior que zero.');
        if (payload.referenceDays <= 0) throw new Error('Informe quanto tempo essa quantidade costuma durar.');
        if (payload.alertLeadDays < 0) throw new Error('A antecedência do aviso não pode ser negativa.');

        if (itemId) {
            await updateDoc(doc(db, 'inventory_items', itemId), payload);
            showToast('Item atualizado com sucesso.');
        } else {
            await addDoc(collection(db, 'inventory_items'), {
                ...payload,
                lastPurchaseQuantity: 0,
                lastPurchaseDate: '',
                expectedEndDate: '',
                expectedDurationDays: 0,
                lastCheckDate: '',
                snoozedUntil: '',
                createdAt: serverTimestamp(),
                createdBy: currentUser.uid,
                createdByName: currentUserData.name || currentUser.email || ''
            });
            showToast('Item cadastrado. Registre a compra atual para começar a contagem.');
        }

        closeModal('item-modal');
    } catch (error) {
        console.error('Erro ao salvar item:', error);
        showToast(describeError(error, 'Não foi possível salvar o item.'), true);
    } finally {
        setLoading(submit, false, original);
    }
}

// Item sem referência de duração não pode receber compra nem conferência: o
// banco rejeita a gravação (a regra exige a referência) e a previsão não teria
// como ser calculada. Acontece com item vindo do modelo antigo de saldo —
// aqui a professora é levada direto ao cadastro para completar.
function requireReference(item) {
    if (getCycleInfo(item).hasReference) return true;

    showToast('Este item ainda não tem referência de duração. Preencha quanto se compra e quanto tempo dura.', true);
    openItemModal(item);
    return false;
}

// ----------------------------------------------------------------- compras

function openPurchaseModal(itemId) {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (!canManage) return showToast('Você não tem permissão para registrar compras.', true);
    if (!requireReference(item)) return;

    els.purchaseForm.reset();
    els.purchaseForm.elements.itemId.value = itemId;
    els.purchaseForm.elements.purchaseDate.value = todayString();
    els.purchaseForm.elements.quantity.value = item.referenceQuantity ?? '';
    els.purchaseItemLabel.textContent = item.name;
    els.purchaseQuantityLabel.textContent = `Quantidade comprada (${item.unit}) *`;

    updatePurchasePreview();
    openModal('purchase-modal');
    setTimeout(() => els.purchaseForm.elements.quantity.select(), 50);
}

function updatePurchasePreview() {
    const item = allItems.find((candidate) => candidate.id === els.purchaseForm.elements.itemId.value);
    if (!item || !els.purchasePreview) return;

    const quantity = toNumber(els.purchaseForm.elements.quantity.value);
    const purchaseDate = els.purchaseForm.elements.purchaseDate.value;
    const preview = getCycleInfo({ ...item, lastPurchaseQuantity: quantity, lastPurchaseDate: purchaseDate });

    if (!preview.hasPurchase) {
        els.purchasePreview.textContent = 'Informe a quantidade e a data para ver a previsão.';
        els.purchasePreview.classList.remove('is-active');
        return;
    }

    els.purchasePreview.innerHTML = `Pela referência de ${formatQuantity(preview.referenceQuantity)} ${escapeHtml(item.unit)} a cada ${formatDuration(preview.referenceDays)}, essa compra deve durar <strong>${formatDuration(preview.expectedDays)}</strong> — até <strong>${formatDate(preview.expectedEndDate)}</strong>. O aviso aparece no hub ${formatDays(preview.alertLeadDays)} antes.`;
    els.purchasePreview.classList.add('is-active');
}

async function savePurchase(event) {
    event.preventDefault();
    if (!canManage) return;

    const submit = els.purchaseForm.querySelector('button[type="submit"]');
    const original = submit.innerHTML;
    setLoading(submit, true);

    const formData = new FormData(els.purchaseForm);
    const itemId = formData.get('itemId');
    const quantity = toNumber(formData.get('quantity'));
    const purchaseDate = formData.get('purchaseDate') || '';
    const notes = cleanText(formData.get('notes'));

    try {
        const item = allItems.find((candidate) => candidate.id === itemId);
        if (!item) throw new Error('Item não encontrado.');
        if (quantity <= 0) throw new Error('A quantidade comprada deve ser maior que zero.');
        if (!purchaseDate) throw new Error('Informe a data da compra.');

        const cycle = getCycleInfo({ ...item, lastPurchaseQuantity: quantity, lastPurchaseDate: purchaseDate });
        if (!cycle.hasPurchase) throw new Error('Defina a referência de duração do item antes de registrar a compra.');

        await updateDoc(doc(db, 'inventory_items', itemId), {
            lastPurchaseQuantity: quantity,
            lastPurchaseDate: purchaseDate,
            expectedDurationDays: cycle.expectedDays,
            expectedEndDate: cycle.expectedEndDate,
            // Compra nova reinicia a contagem: qualquer adiamento antigo perde o sentido.
            snoozedUntil: '',
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
            updatedByName: currentUserData.name || currentUser.email || ''
        });

        await logEvent(item, {
            type: 'compra',
            quantity,
            purchaseDate,
            expectedDurationDays: cycle.expectedDays,
            expectedEndDate: cycle.expectedEndDate,
            notes
        });

        closeModal('purchase-modal');
        showToast(`Compra registrada. Previsão até ${formatDate(cycle.expectedEndDate)}.`);
    } catch (error) {
        console.error('Erro ao registrar compra:', error);
        showToast(describeError(error, 'Não foi possível registrar a compra.'), true);
    } finally {
        setLoading(submit, false, original);
    }
}

// ------------------------------------------------------------ conferências

function openCheckModal(itemId) {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (!canManage) return showToast('Você não tem permissão para registrar conferências.', true);
    if (!requireReference(item)) return;

    els.checkForm.reset();
    els.checkForm.elements.itemId.value = itemId;
    els.checkItemLabel.textContent = item.name;
    syncCheckFields();
    openModal('check-modal');
}

function syncCheckFields() {
    const isCustom = els.checkForm.elements.remindInDays.value === 'custom';
    els.checkCustomGroup.classList.toggle('hidden', !isCustom);
    els.checkForm.elements.customDays.required = isCustom;
}

async function saveCheck(event) {
    event.preventDefault();
    if (!canManage) return;

    const submit = els.checkForm.querySelector('button[type="submit"]');
    const original = submit.innerHTML;
    setLoading(submit, true);

    const formData = new FormData(els.checkForm);
    const itemId = formData.get('itemId');
    const choice = formData.get('remindInDays');
    const days = Math.round(choice === 'custom' ? toNumber(formData.get('customDays')) : toNumber(choice));
    const notes = cleanText(formData.get('notes'));

    try {
        const item = allItems.find((candidate) => candidate.id === itemId);
        if (!item) throw new Error('Item não encontrado.');
        if (days <= 0) throw new Error('Informe em quantos dias o aviso deve voltar.');

        const today = todayString();
        const snoozedUntil = addDays(today, days);

        await updateDoc(doc(db, 'inventory_items', itemId), {
            lastCheckDate: today,
            snoozedUntil,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
            updatedByName: currentUserData.name || currentUser.email || ''
        });

        await logEvent(item, {
            type: 'conferencia',
            checkDate: today,
            remindInDays: days,
            snoozedUntil,
            notes
        });

        closeModal('check-modal');
        showToast(`Conferência registrada. O aviso volta em ${formatDate(snoozedUntil)}.`);
    } catch (error) {
        console.error('Erro ao registrar conferência:', error);
        showToast(describeError(error, 'Não foi possível registrar a conferência.'), true);
    } finally {
        setLoading(submit, false, original);
    }
}

function logEvent(item, data) {
    return addDoc(collection(db, 'inventory_events'), {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit || '',
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUserData.name || currentUser.email || '',
        ...data
    });
}

// ---------------------------------------------------------------- detalhes

async function openDetail(itemId) {
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    selectedItemId = itemId;
    const cycle = getCycleInfo(item);
    const status = getItemStatus(item, cycle);

    els.detailContent.innerHTML = `
        <div class="inventory-modal-header">
            <span class="modal-icon"><i class="fas fa-box"></i></span>
            <div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.category || 'Sem categoria')}</p></div>
        </div>
        <div class="detail-hero">
            <div class="detail-hero-top">
                ${renderStatusBadge(status, cycle)}
                <span class="item-meta">${escapeHtml(item.location || 'Sem localização')}</span>
            </div>
            <div class="detail-balance-row">
                <div>
                    <div class="item-meta">Previsão de término</div>
                    <div class="detail-balance">${cycle.hasPurchase ? formatDate(cycle.expectedEndDate) : '—'}</div>
                    <div class="item-meta">${describeDeadline(cycle)}${cycle.hasPurchase ? ` · ciclo de ${formatDuration(cycle.expectedDays)}` : ''}</div>
                </div>
                <div class="detail-actions">
                    ${canManage ? `<button class="btn btn-primary" data-detail-purchase><i class="fas fa-cart-shopping"></i> Registrar compra</button>` : ''}
                    ${canManage ? `<button class="btn btn-secondary" data-detail-check><i class="fas fa-clipboard-check"></i> Conferi</button>` : ''}
                </div>
            </div>
            ${cycle.hasPurchase ? `<div class="cycle-bar detail-cycle-bar"><span class="cycle-bar-fill ${cycle.daysLeft < 0 ? 'is-late' : (cycle.daysLeft <= cycle.alertLeadDays ? 'is-near' : 'is-ok')}" style="width:${Math.round(cycle.progress * 100)}%"></span></div>` : ''}
        </div>
        <div class="detail-grid">
            ${detailInfo('Referência', cycle.hasReference ? `${formatQuantity(cycle.referenceQuantity)} ${item.unit} ≈ ${formatDuration(cycle.referenceDays)}` : 'Não definida')}
            ${detailInfo('Última compra', cycle.hasPurchase ? `${formatQuantity(cycle.quantity)} ${item.unit} em ${formatDate(cycle.purchaseDate)}` : 'Nenhuma')}
            ${detailInfo('Aviso no hub', `${formatDays(cycle.alertLeadDays)} antes do fim`)}
            ${detailInfo('Última conferência', item.lastCheckDate ? formatDate(item.lastCheckDate) : 'Nenhuma')}
            ${detailInfo('Localização', item.location || 'Não informada')}
            ${detailInfo('Observações', item.notes || 'Nenhuma')}
        </div>
        ${canManage ? `
            <div class="detail-actions" style="margin-bottom:18px;">
                <button class="btn btn-secondary" data-edit-item><i class="fas fa-pen"></i> Editar cadastro</button>
                <button class="btn btn-secondary" data-delete-item style="color:var(--color-error);">
                    <i class="fas fa-trash"></i> Excluir item
                </button>
            </div>` : ''}
        <h3 class="history-title">Histórico</h3>
        <div id="event-history" class="history-list">
            <div class="inventory-empty" style="min-height:120px;padding:1rem;"><i class="fas fa-spinner fa-spin" style="font-size:1.2rem;"></i></div>
        </div>`;

    openModal('detail-modal');
    await loadEventHistory(itemId);
}

async function loadEventHistory(itemId) {
    const container = document.getElementById('event-history');
    if (!container) return;

    try {
        const snapshot = await getDocs(query(collection(db, 'inventory_events'), where('itemId', '==', itemId)));
        const events = snapshot.docs
            .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }))
            .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

        if (!events.length) {
            container.innerHTML = '<div class="item-meta" style="padding:12px 0;">Nenhuma compra ou conferência registrada.</div>';
            return;
        }

        container.innerHTML = events.map(renderEventRow).join('');
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        container.innerHTML = '<div class="item-meta" style="padding:12px 0;">Não foi possível carregar o histórico.</div>';
    }
}

function renderEventRow(event) {
    const isPurchase = event.type === 'compra';
    const title = isPurchase
        ? `${formatQuantity(event.quantity)} ${escapeHtml(event.unit || '')} comprados`
        : 'Conferido no laboratório';
    const result = isPurchase
        ? `<div>${formatDuration(event.expectedDurationDays)}<small>até ${formatDate(event.expectedEndDate)}</small></div>`
        : `<div>+${formatDays(event.remindInDays)}<small>avisar em ${formatDate(event.snoozedUntil)}</small></div>`;

    return `
        <div class="history-row">
            <div class="history-kind ${isPurchase ? 'compra' : 'conferencia'}">${isPurchase ? 'Compra' : 'Conferência'}</div>
            <div class="history-description">
                <strong>${title}</strong>
                <small>${escapeHtml(event.createdByName || 'Usuário')} · ${formatTimestamp(event.createdAt)}${event.notes ? ` · ${escapeHtml(event.notes)}` : ''}</small>
            </div>
            <div class="history-result">${result}</div>
        </div>`;
}

// O item sai de vez, junto com as compras e conferências dele: sem controle de
// saldo, o histórico de um produto que não está mais no laboratório não serve
// de nada — só sobraria como lixo no banco.
async function deleteItem(itemId) {
    if (!canManage) return;
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    const question = `Excluir “${item.name}”?\n\nO item e todo o histórico de compras e conferências serão apagados. Não há como desfazer.`;
    if (!confirm(question)) return;

    try {
        const snapshot = await getDocs(query(collection(db, 'inventory_events'), where('itemId', '==', itemId)));
        const batch = writeBatch(db);
        snapshot.forEach((eventDoc) => batch.delete(eventDoc.ref));
        batch.delete(doc(db, 'inventory_items', itemId));
        await batch.commit();

        selectedItemId = null;
        closeModal('detail-modal');
        showToast('Item excluído.');
    } catch (error) {
        console.error('Erro ao excluir item:', error);
        showToast(describeError(error, 'Não foi possível excluir o item.'), true);
    }
}

function detailInfo(label, value) {
    return `<div class="detail-info"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

// -------------------------------------------------------------- auxiliares

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
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4000);
}

// "Missing or insufficient permissions" não diz nada para quem usa o app — e
// no estoque a recusa quase sempre tem duas causas concretas.
function describeError(error, fallback) {
    if (error?.code === 'permission-denied') {
        return 'O banco recusou a gravação. Verifique se as regras do Firestore foram publicadas e se o item tem a referência de duração preenchida.';
    }
    return error?.message || fallback;
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
