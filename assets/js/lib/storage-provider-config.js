const STORAGE_KEY = 'lpv-storage-provider-config';

const DEFAULT_CONFIG = {
    supabaseUrl: 'https://uvtitfojliuklsrapujc.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dGl0Zm9qbGl1a2xzcmFwdWpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTM2MTQsImV4cCI6MjA5MTQyOTYxNH0.PjvKYNjDVKcV25wILU9brbbdP8ekB4YFfAqHkROtS-U',
    supabaseReportsBucket: 'reports',
    cloudinaryCloudName: 'dkpdl9oxy',
    cloudinaryUploadPreset: 'LPV Gallery',
    cloudinaryInternalPhotosFolder: 'lpv/internal-photos'
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
        return parsed && typeof parsed === 'object' ? parsed : {};
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
        supabaseReportsBucket: normalizeValue(window.LPV_SUPABASE_REPORTS_BUCKET || fromObject.supabaseReportsBucket || ''),
        cloudinaryCloudName: normalizeValue(window.LPV_CLOUDINARY_CLOUD_NAME || fromObject.cloudinaryCloudName || ''),
        cloudinaryUploadPreset: normalizeValue(window.LPV_CLOUDINARY_UPLOAD_PRESET || fromObject.cloudinaryUploadPreset || ''),
        cloudinaryInternalPhotosFolder: normalizeValue(window.LPV_CLOUDINARY_INTERNAL_PHOTOS_FOLDER || fromObject.cloudinaryInternalPhotosFolder || '')
    };
}

function sanitizeConfig(raw = {}) {
    return {
        supabaseUrl: withFallback(raw.supabaseUrl, DEFAULT_CONFIG.supabaseUrl),
        supabaseAnonKey: withFallback(raw.supabaseAnonKey, DEFAULT_CONFIG.supabaseAnonKey),
        supabaseReportsBucket: withFallback(raw.supabaseReportsBucket, DEFAULT_CONFIG.supabaseReportsBucket),
        cloudinaryCloudName: withFallback(raw.cloudinaryCloudName, DEFAULT_CONFIG.cloudinaryCloudName),
        cloudinaryUploadPreset: withFallback(raw.cloudinaryUploadPreset, DEFAULT_CONFIG.cloudinaryUploadPreset),
        cloudinaryInternalPhotosFolder: withFallback(raw.cloudinaryInternalPhotosFolder, DEFAULT_CONFIG.cloudinaryInternalPhotosFolder)
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
        window.LPV_CLOUDINARY_CLOUD_NAME = merged.cloudinaryCloudName;
        window.LPV_CLOUDINARY_UPLOAD_PRESET = merged.cloudinaryUploadPreset;
        window.LPV_CLOUDINARY_INTERNAL_PHOTOS_FOLDER = merged.cloudinaryInternalPhotosFolder;

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
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