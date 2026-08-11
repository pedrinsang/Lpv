const STORAGE_KEY = 'lpv-storage-provider-config';

/**
 * Versão dos valores padrão abaixo. **Incremente sempre que mudar o projeto
 * Supabase.**
 *
 * O que fica salvo em `localStorage` tem precedência sobre o padrão do código —
 * é o que permite apontar um navegador para outro projeto sem editar o
 * repositório. O efeito colateral é que uma configuração salva e esquecida
 * continua valendo para sempre, e o navegador segue indo ao projeto antigo
 * mesmo depois de o código ser corrigido (foi exatamente o que aconteceu na
 * troca de projeto de agosto/2026: `ERR_NAME_NOT_RESOLVED` num endereço que já
 * não existia).
 *
 * Com a versão gravada junto, mudar o padrão invalida sozinho as configurações
 * salvas em todas as máquinas, sem ninguém precisar limpar nada na mão.
 */
const CONFIG_VERSION = 2;

const DEFAULT_CONFIG = {
    supabaseUrl: 'https://lfhqqnefiwtcaniirpeg.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmaHFxbmVmaXd0Y2FuaWlycGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDAwNjUsImV4cCI6MjA5MTQxNjA2NX0.ZNeZVbKI8DcNM7dsKNUmQsk9i1GnSsI5MI_v0Z1NOnM',
    supabaseReportsBucket: 'reports'
};

function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    const text = value.toString().trim();
    if (!text) return '';
    if (text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') return '';
    return text;
}

function withFallback(value, fallback) {
    const normalized = normalizeValue(value);
    return normalized || normalizeValue(fallback);
}

function readSavedConfig() {
    if (typeof window === 'undefined') return {};

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};

        // Configuração salva antes da versão atual dos padrões é descartada:
        // apontava para um projeto que pode não existir mais.
        if (parsed.version !== CONFIG_VERSION) {
            window.localStorage.removeItem(STORAGE_KEY);
            return {};
        }

        return parsed;
    } catch (_) {
        return {};
    }
}

function readWindowConfig() {
    if (typeof window === 'undefined') return {};

    const objectConfig = window.LPV_STORAGE_PROVIDER_CONFIG;
    const fromObject = objectConfig && typeof objectConfig === 'object' ? objectConfig : {};

    return {
        ...fromObject,
        supabaseUrl: normalizeValue(window.LPV_SUPABASE_URL || fromObject.supabaseUrl || ''),
        supabaseAnonKey: normalizeValue(window.LPV_SUPABASE_ANON_KEY || fromObject.supabaseAnonKey || ''),
        supabaseReportsBucket: normalizeValue(window.LPV_SUPABASE_REPORTS_BUCKET || fromObject.supabaseReportsBucket || '')
    };
}

function sanitizeConfig(raw = {}) {
    return {
        supabaseUrl: withFallback(raw.supabaseUrl, DEFAULT_CONFIG.supabaseUrl),
        supabaseAnonKey: withFallback(raw.supabaseAnonKey, DEFAULT_CONFIG.supabaseAnonKey),
        supabaseReportsBucket: withFallback(raw.supabaseReportsBucket, DEFAULT_CONFIG.supabaseReportsBucket)
    };
}

export function getStorageProviderConfig() {
    const saved = readSavedConfig();
    const win = readWindowConfig();

    return sanitizeConfig({
        ...DEFAULT_CONFIG,
        ...saved,
        ...win
    });
}

export function setStorageProviderConfig(partial = {}) {
    const merged = sanitizeConfig({
        ...getStorageProviderConfig(),
        ...(partial || {})
    });

    if (typeof window !== 'undefined') {
        window.LPV_STORAGE_PROVIDER_CONFIG = merged;
        window.LPV_SUPABASE_URL = merged.supabaseUrl;
        window.LPV_SUPABASE_ANON_KEY = merged.supabaseAnonKey;
        window.LPV_SUPABASE_REPORTS_BUCKET = merged.supabaseReportsBucket;

        try {
            // A versão vai junto: é ela que faz esta configuração ser descartada
            // sozinha quando o projeto padrão mudar.
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...merged,
                version: CONFIG_VERSION
            }));
        } catch (_) {
            // Ignora falha de armazenamento local.
        }
    }

    return merged;
}

if (typeof window !== 'undefined') {
    window.getStorageProviderConfig = getStorageProviderConfig;
    window.setStorageProviderConfig = setStorageProviderConfig;
}