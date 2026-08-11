import { db, auth } from '../core.js';
import { doc, getDoc, runTransaction, deleteField } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getStorageProviderConfig } from './storage-provider-config.js';

let supabaseModulePromise = null;
let supabaseClient = null;
let supabaseClientCacheKey = '';

function ensureAuthenticatedUser() {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Usuario nao autenticado.');
    }
    return user;
}

function createVersionId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${random}`;
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeFileName(name, fallback = 'laudo') {
    const safe = (name || fallback)
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');

    return safe || fallback;
}

function normalizeReportFiles(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};

    return {
        activeSource: base.activeSource || 'online_report',
        activeWordVersionId: base.activeWordVersionId || null,
        activePdfVersionId: base.activePdfVersionId || null,
        wordVersions: Array.isArray(base.wordVersions) ? base.wordVersions : [],
        pdfVersions: Array.isArray(base.pdfVersions) ? base.pdfVersions : []
    };
}

function ensureFileExtension(fileName, fileType) {
    const lower = (fileName || '').toLowerCase();

    if (fileType === 'word') {
        if (lower.endsWith('.docx') || lower.endsWith('.doc')) return fileName;
        return `${fileName}.docx`;
    }

    if (lower.endsWith('.pdf')) return fileName;
    return `${fileName}.pdf`;
}

async function loadSupabaseModule() {
    if (!supabaseModulePromise) {
        supabaseModulePromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    }
    return supabaseModulePromise;
}

/**
 * Token do usuário logado no Firebase, entregue ao Supabase a cada requisição.
 *
 * O bucket guarda laudo com dado clínico identificado, então o acesso não pode
 * depender só da chave anônima — ela viaja no código do navegador e vale para
 * qualquer pessoa. Com o Firebase cadastrado como Third-Party Auth no Supabase,
 * este token faz a requisição chegar como `authenticated`, e as políticas em
 * supabase/reports-storage-setup.sql exigem exatamente isso.
 *
 * `getIdToken()` renova sozinho quando o token está perto de expirar.
 */
let tokenRenovadoNesteCarregamento = false;

async function getFirebaseAccessToken() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        // A claim `role: authenticated` é gravada fora do navegador (ver
        // scripts/set-supabase-claims.mjs) e só entra no token na renovação
        // seguinte. Forçar uma renovação por carregamento faz com que recarregar
        // a página baste para o acesso passar a valer — sem isso, quem estava
        // logado ficaria até uma hora sem conseguir baixar laudo.
        const forcarRenovacao = !tokenRenovadoNesteCarregamento;
        const token = await user.getIdToken(forcarRenovacao);
        tokenRenovadoNesteCarregamento = true;
        return token;
    } catch (error) {
        console.warn('Não foi possível obter o token do Firebase para o storage.', error);
        return null;
    }
}

async function getSupabaseStorageContext() {
    const config = getStorageProviderConfig();
    const { supabaseUrl, supabaseAnonKey, supabaseReportsBucket } = config;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Configure LPV_SUPABASE_URL e LPV_SUPABASE_ANON_KEY para upload direto no Supabase.');
    }

    const bucket = supabaseReportsBucket || 'reports';
    const cacheKey = `${supabaseUrl}|${supabaseAnonKey}`;

    if (!supabaseClient || supabaseClientCacheKey !== cacheKey) {
        const { createClient } = await loadSupabaseModule();
        // `accessToken` é resolvido a cada chamada, então o cliente pode ser
        // reaproveitado entre usuários sem carregar o token de quem saiu.
        supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
            accessToken: getFirebaseAccessToken
        });
        supabaseClientCacheKey = cacheKey;
    }

    return { supabase: supabaseClient, bucket };
}

async function appendReportVersion({ taskId, fileType, versionMeta, markAsPrimary, user }) {
    const taskRef = doc(db, 'tasks', taskId);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(taskRef);
        if (!snap.exists()) {
            throw new Error('Tarefa nao encontrada.');
        }

        const taskData = snap.data() || {};
        const reportFiles = normalizeReportFiles(taskData.reportFiles);

        if (fileType === 'word') {
            reportFiles.wordVersions = [...reportFiles.wordVersions, versionMeta];
            reportFiles.activeWordVersionId = versionMeta.versionId;
            if (markAsPrimary) {
                reportFiles.activeSource = 'uploaded_word';
            }
        } else {
            reportFiles.pdfVersions = [...reportFiles.pdfVersions, versionMeta];
            reportFiles.activePdfVersionId = versionMeta.versionId;
            if (markAsPrimary) {
                reportFiles.activeSource = 'uploaded_pdf';
            }
        }

        tx.update(taskRef, {
            reportFiles,
            lastEditor: user.uid,
            lastEditedAt: nowIso()
        });
    });
}

function findWordVersion(reportFiles, versionId = null) {
    const list = Array.isArray(reportFiles.wordVersions) ? reportFiles.wordVersions : [];
    if (list.length === 0) return null;

    const targetVersionId = versionId || reportFiles.activeWordVersionId;
    if (!targetVersionId) return null;

    return list.find((item) => item.versionId === targetVersionId) || null;
}

function findPdfVersion(reportFiles, versionId = null) {
    const list = Array.isArray(reportFiles.pdfVersions) ? reportFiles.pdfVersions : [];
    if (list.length === 0) return null;

    const targetVersionId = versionId || reportFiles.activePdfVersionId;
    if (!targetVersionId) {
        return list[list.length - 1] || null;
    }

    return list.find((item) => item.versionId === targetVersionId) || null;
}

function getLastVersionId(list = []) {
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[list.length - 1]?.versionId || null;
}

function normalizeActiveSource(reportFiles) {
    const hasActiveWord = !!reportFiles.activeWordVersionId
        && reportFiles.wordVersions.some((item) => item.versionId === reportFiles.activeWordVersionId);
    const hasActivePdf = !!reportFiles.activePdfVersionId
        && reportFiles.pdfVersions.some((item) => item.versionId === reportFiles.activePdfVersionId);

    if (!hasActiveWord) {
        reportFiles.activeWordVersionId = null;
    }

    if (!hasActivePdf) {
        reportFiles.activePdfVersionId = null;
    }

    if (reportFiles.activeSource === 'uploaded_word' && !hasActiveWord) {
        reportFiles.activeSource = hasActivePdf ? 'uploaded_pdf' : 'online_report';
        return;
    }

    if (reportFiles.activeSource === 'uploaded_pdf' && !hasActivePdf) {
        reportFiles.activeSource = hasActiveWord ? 'uploaded_word' : 'online_report';
        return;
    }

    if (!hasActiveWord && !hasActivePdf) {
        reportFiles.activeSource = 'online_report';
    }
}

export function getReportFilesState(task) {
    return normalizeReportFiles(task?.reportFiles);
}

export function hasActiveUploadedWord(task) {
    const state = getReportFilesState(task);
    return state.activeSource === 'uploaded_word' && !!state.activeWordVersionId;
}

function detectWordMime(fileName, fallbackMime = '') {
    if ((fallbackMime || '').includes('wordprocessingml')) return fallbackMime;
    const lower = (fileName || '').toLowerCase();
    if (lower.endsWith('.doc')) return 'application/msword';
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export async function uploadReportFileFromBlob({ taskId, blob, fileType, fileName, source = 'manual_upload', markAsPrimary = true }) {
    if (!taskId || !blob || !fileType || !fileName) {
        throw new Error('Parametros obrigatorios ausentes para upload de arquivo.');
    }

    if (!['word', 'pdf'].includes(fileType)) {
        throw new Error('Tipo de arquivo invalido para upload.');
    }

    const user = ensureAuthenticatedUser();
    const { supabase, bucket } = await getSupabaseStorageContext();

    const versionId = createVersionId();
    const withExt = ensureFileExtension(fileName, fileType);
    const safeName = normalizeFileName(withExt);
    const storagePath = `tasks/${taskId}/${fileType}/${versionId}-${safeName}`;

    const mimeType = fileType === 'word'
        ? detectWordMime(safeName, blob.type)
        : (blob.type || 'application/pdf');

    const { error } = await supabase.storage.from(bucket).upload(storagePath, blob, {
        contentType: mimeType,
        upsert: false,
        cacheControl: '3600'
    });

    if (error) {
        throw new Error(`Falha no upload para Supabase: ${error.message || 'erro desconhecido'}`);
    }

    const versionMeta = {
        versionId,
        fileType,
        source: source || 'manual_upload',
        linkedVersionId: null,
        fileName: safeName,
        storagePath,
        mimeType,
        size: Number(blob.size || 0),
        uploadedBy: user.uid,
        uploadedByName: user.displayName || user.email || 'Usuario',
        uploadedAt: nowIso()
    };

    await appendReportVersion({
        taskId,
        fileType,
        versionMeta,
        markAsPrimary: markAsPrimary !== false,
        user
    });

    return {
        ok: true,
        version: versionMeta
    };
}

export async function uploadWordReportFile(taskId, file, options = {}) {
    const fileName = normalizeFileName(file?.name || `${taskId || 'laudo'}.docx`);

    return uploadReportFileFromBlob({
        taskId,
        blob: file,
        fileType: 'word',
        fileName,
        source: options.source || 'manual_upload',
        markAsPrimary: options.markAsPrimary !== false
    });
}

export async function uploadPdfReportFile(taskId, file, options = {}) {
    const fileName = normalizeFileName(file?.name || `${taskId || 'laudo'}.pdf`);

    return uploadReportFileFromBlob({
        taskId,
        blob: file,
        fileType: 'pdf',
        fileName,
        source: options.source || 'manual_upload',
        markAsPrimary: options.markAsPrimary !== false
    });
}

export async function removeReportFileVersion({ taskId, fileType, versionId = null }) {
    if (!taskId || !fileType) {
        throw new Error('taskId e fileType sao obrigatorios para remover arquivo.');
    }

    if (!['word', 'pdf'].includes(fileType)) {
        throw new Error('Tipo de arquivo invalido para remocao.');
    }

    const user = ensureAuthenticatedUser();
    const { supabase, bucket } = await getSupabaseStorageContext();
    const taskRef = doc(db, 'tasks', taskId);

    const taskSnap = await getDoc(taskRef);
    if (!taskSnap.exists()) {
        throw new Error('Tarefa nao encontrada.');
    }

    const taskData = taskSnap.data() || {};
    const reportFiles = normalizeReportFiles(taskData.reportFiles);
    const targetVersion = fileType === 'word'
        ? findWordVersion(reportFiles, versionId)
        : findPdfVersion(reportFiles, versionId);

    if (!targetVersion) {
        throw new Error('Versao de arquivo nao encontrada para remocao.');
    }

    const storagePath = (targetVersion.storagePath || '').toString().trim();
    if (!storagePath) {
        throw new Error('Versao sem storagePath; nao foi possivel confirmar exclusao no Supabase.');
    }

    const removeResult = await supabase.storage.from(bucket).remove([storagePath]);
    if (removeResult.error) {
        throw new Error(`Falha ao apagar no Supabase: ${removeResult.error.message || 'erro desconhecido'}`);
    }

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(taskRef);
        if (!snap.exists()) {
            throw new Error('Tarefa nao encontrada.');
        }

        const freshData = snap.data() || {};
        const freshReportFiles = normalizeReportFiles(freshData.reportFiles);
        const freshTarget = fileType === 'word'
            ? findWordVersion(freshReportFiles, targetVersion.versionId)
            : findPdfVersion(freshReportFiles, targetVersion.versionId);

        if (!freshTarget) {
            return;
        }

        if (fileType === 'word') {
            freshReportFiles.wordVersions = freshReportFiles.wordVersions.filter((item) => item.versionId !== targetVersion.versionId);
            if (freshReportFiles.activeWordVersionId === targetVersion.versionId) {
                freshReportFiles.activeWordVersionId = getLastVersionId(freshReportFiles.wordVersions);
            }
        } else {
            freshReportFiles.pdfVersions = freshReportFiles.pdfVersions.filter((item) => item.versionId !== targetVersion.versionId);
            if (freshReportFiles.activePdfVersionId === targetVersion.versionId) {
                freshReportFiles.activePdfVersionId = getLastVersionId(freshReportFiles.pdfVersions);
            }
        }

        normalizeActiveSource(freshReportFiles);

        const hasAnyStoredVersion = freshReportFiles.wordVersions.length > 0 || freshReportFiles.pdfVersions.length > 0;
        const updateData = {
            lastEditor: user.uid,
            lastEditedAt: nowIso()
        };

        if (hasAnyStoredVersion) {
            updateData.reportFiles = freshReportFiles;
        } else {
            updateData.reportFiles = deleteField();
        }

        tx.update(taskRef, updateData);
    });

    return {
        ok: true,
        removedVersion: targetVersion,
        warning: null
    };
}

export async function getReportFileDownloadUrl({ taskId, fileType, versionId = null, expiresIn = 900 }) {
    if (!taskId || !fileType) {
        throw new Error('taskId e fileType sao obrigatorios para download.');
    }

    const user = ensureAuthenticatedUser();
    void user;

    if (!['word', 'pdf'].includes(fileType)) {
        throw new Error('Tipo de arquivo invalido para download.');
    }

    const { supabase, bucket } = await getSupabaseStorageContext();
    const taskSnap = await getDoc(doc(db, 'tasks', taskId));

    if (!taskSnap.exists()) {
        throw new Error('Tarefa nao encontrada.');
    }

    const taskData = taskSnap.data() || {};
    const reportFiles = normalizeReportFiles(taskData.reportFiles);
    const version = fileType === 'word'
        ? findWordVersion(reportFiles, versionId)
        : findPdfVersion(reportFiles, versionId);

    if (!version || !version.storagePath) {
        throw new Error('Versao de arquivo nao encontrada.');
    }

    const ttl = Number.isFinite(Number(expiresIn))
        ? Math.max(60, Math.min(3600, Number(expiresIn)))
        : 900;

    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(version.storagePath, ttl);

    if (!error && data?.signedUrl) {
        return {
            ok: true,
            url: data.signedUrl,
            version
        };
    }

    const publicResult = supabase.storage.from(bucket).getPublicUrl(version.storagePath);
    if (publicResult?.data?.publicUrl) {
        return {
            ok: true,
            url: publicResult.data.publicUrl,
            version
        };
    }

    throw new Error(`Falha ao gerar URL de download no Supabase: ${error?.message || 'erro desconhecido'}`);
}

export async function downloadStoredReportVersion({ taskId, fileType, versionId = null }) {
    const payload = await getReportFileDownloadUrl({ taskId, fileType, versionId });

    if (!payload?.url) {
        throw new Error('Nao foi possivel obter URL de download.');
    }

    const anchor = document.createElement('a');
    anchor.href = payload.url;
    anchor.rel = 'noopener noreferrer';
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    return payload;
}
