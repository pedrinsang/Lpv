// Estoque por ciclo de duração.
//
// O laboratório não lança consumo item a item — quem usa o formol não abre o
// app para descontar 200 mL. O que se sabe na prática é outra coisa: "50 L de
// formol duram uns 3 meses". Então o cadastro guarda essa referência e cada
// compra vira uma previsão por regra de três: se 50 L duram 90 dias, 100 L
// duram 180. Perto do fim do prazo o hub avisa, e a professora confere no
// armário se realmente precisa repor.
//
// Este módulo concentra a matemática e a leitura de situação para que a página
// de estoque e o hub nunca divirjam sobre o que é "vencendo".

// Mês aqui é sempre de 30 dias: é previsão de compra, não calendário fiscal.
export const DURATION_UNIT_DAYS = {
    dias: 1,
    semanas: 7,
    meses: 30
};

export const STATUS_META = {
    ok: { label: 'Em dia', icon: 'fa-circle-check' },
    soon: { label: 'Conferir em breve', icon: 'fa-hourglass-half' },
    due: { label: 'Prazo esgotado', icon: 'fa-triangle-exclamation' },
    snoozed: { label: 'Conferido', icon: 'fa-clipboard-check' },
    pending: { label: 'Sem compra registrada', icon: 'fa-cart-plus' }
};

// Situações que pedem ação da professora — as que sobem para o hub.
export const ALERT_STATUSES = ['due', 'soon'];

export const DEFAULT_ALERT_LEAD_DAYS = 30;

export function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function durationToDays(value, unit) {
    return Math.round(toNumber(value) * (DURATION_UNIT_DAYS[unit] || 1));
}

export function todayString() {
    return dateToString(new Date());
}

export function dateToString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(value) {
    if (!value) return null;
    // Meio-dia evita que fuso horário empurre a data para o dia anterior.
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(dateString, days) {
    const date = parseDate(dateString);
    if (!date) return '';
    date.setDate(date.getDate() + Math.round(days));
    return dateToString(date);
}

// Positivo = dias que faltam; 0 = hoje; negativo = dias passados.
export function daysUntil(dateString) {
    const target = parseDate(dateString);
    if (!target) return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target - today) / 86400000);
}

// A regra de três: a quantidade comprada dura proporcionalmente ao que a
// quantidade de referência costuma durar.
export function getCycleInfo(item = {}) {
    const referenceQuantity = toNumber(item.referenceQuantity);
    const referenceDays = toNumber(item.referenceDays);
    const hasReference = referenceQuantity > 0 && referenceDays > 0;

    const quantity = toNumber(item.lastPurchaseQuantity);
    const purchaseDate = item.lastPurchaseDate || '';
    const hasPurchase = hasReference && quantity > 0 && !!parseDate(purchaseDate);

    const alertLeadDays = Number.isFinite(Number(item.alertLeadDays))
        ? Math.max(0, Number(item.alertLeadDays))
        : DEFAULT_ALERT_LEAD_DAYS;

    const snoozedUntil = item.snoozedUntil || '';
    const snoozeDaysLeft = snoozedUntil ? daysUntil(snoozedUntil) : null;

    const info = {
        referenceQuantity,
        referenceDays,
        hasReference,
        hasPurchase,
        quantity,
        purchaseDate,
        alertLeadDays,
        snoozedUntil,
        snoozeDaysLeft,
        expectedDays: 0,
        expectedEndDate: '',
        daysLeft: null,
        progress: 0
    };

    if (!hasPurchase) return info;

    info.expectedDays = Math.max(1, Math.round(referenceDays * (quantity / referenceQuantity)));
    info.expectedEndDate = addDays(purchaseDate, info.expectedDays);
    info.daysLeft = daysUntil(info.expectedEndDate);

    const elapsed = info.expectedDays - info.daysLeft;
    info.progress = Math.min(1, Math.max(0, elapsed / info.expectedDays));

    return info;
}

export function getItemStatus(item = {}, cycle = getCycleInfo(item)) {
    if (!cycle.hasPurchase) return 'pending';
    if (cycle.snoozeDaysLeft !== null && cycle.snoozeDaysLeft >= 0) return 'snoozed';
    if (cycle.daysLeft < 0) return 'due';
    if (cycle.daysLeft <= cycle.alertLeadDays) return 'soon';
    return 'ok';
}

export function isAlertStatus(status) {
    return ALERT_STATUSES.includes(status);
}

export function formatQuantity(value) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(toNumber(value));
}

// "90 dias" fica ilegível para quem pensa em meses: converte para a maior
// unidade que couber redondo.
export function formatDuration(days) {
    const total = Math.max(0, Math.round(toNumber(days)));
    if (total === 0) return '0 dias';

    if (total % 30 === 0) {
        const months = total / 30;
        return `${months} ${months === 1 ? 'mês' : 'meses'}`;
    }
    if (total % 7 === 0) {
        const weeks = total / 7;
        return `${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
    }
    return `${total} ${total === 1 ? 'dia' : 'dias'}`;
}

export function formatDays(days) {
    const total = Math.abs(Math.round(toNumber(days)));
    return `${total} ${total === 1 ? 'dia' : 'dias'}`;
}

export function formatDate(value, fallback = 'Não informada') {
    const date = parseDate(value);
    return date ? date.toLocaleDateString('pt-BR') : fallback;
}

// Texto curto do prazo, usado na tabela do estoque e na trilha do hub.
export function describeDeadline(cycle) {
    if (!cycle.hasPurchase) return 'Sem previsão';
    if (cycle.daysLeft < 0) return `Esgotou há ${formatDays(cycle.daysLeft)}`;
    if (cycle.daysLeft === 0) return 'Prazo termina hoje';
    return `Faltam ${formatDays(cycle.daysLeft)}`;
}
