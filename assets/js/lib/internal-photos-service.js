import { db, auth } from '../core.js';
import { doc, getDoc, runTransaction, deleteField } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getStorageProviderConfig } from './storage-provider-config.js';

function ensureAuthenticatedUser() {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuario nao autenticado.');
    return user;
}

function nowIso() {
    return new Date().toISOString();
}

function createVersionId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${random}`;
}

function normalizeName(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function normalizeRoleList(roleData) {
    if (!roleData) return [];
    const arr = Array.isArray(roleData) ? roleData : [roleData];
    return arr
        .map((item) => normalizeName(item))
        .filter(Boolean);
}

function sanitizeFilename(filename, fallback = 'foto') {
    const safe = (filename || fallback)
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');

    return safe || fallback;
}

function hasReportAccess(userContext, taskData) {
    const taskPosUid = (taskData?.posResponsavelUid || '').toString().trim();
    const taskPosName = normalizeName(taskData?.posGraduando || '');
    const userName = normalizeName(userContext?.name || auth.currentUser?.displayName || '');
    const userRoles = normalizeRoleList(userContext?.role || []);

    const isAdmin = userRoles.includes('admin');
    const isProfessor = userRoles.includes('professor');
    const isPostGrad = userRoles.some((role) => role.includes('graduando'));
    const isOwnerByUid = !!taskPosUid && taskPosUid === userContext.uid;
    const isOwnerByLegacyName = !taskPosUid && !!userName && userName === taskPosName;

    return isAdmin || isProfessor || (isPostGrad && (isOwnerByUid || isOwnerByLegacyName));
}

async function getUserContext(user) {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};

    return {
        uid: user.uid,
        name: userData?.name || user.displayName || user.email || 'Usuario',
        role: userData?.role || []
    };
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Falha ao ler imagem.'));
            image.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Falha ao carregar arquivo.'));
        reader.readAsDataURL(file);
    });
}

function toWebpBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Falha ao converter imagem para WebP.'));
                return;
            }
            resolve(blob);
        }, 'image/webp', quality);
    });
}

export async function compressImageToWebp(file, options = {}) {
    const {
        maxWidth = 1920,
        maxHeight = 1920,
        quality = 0.78
    } = options;

    const image = await loadImage(file);
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const targetWidth = Math.max(1, Math.round(image.width * ratio));
    const targetHeight = Math.max(1, Math.round(image.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
        throw new Error('Falha ao inicializar canvas de compressao.');
    }

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    return toWebpBlob(canvas, quality);
}

function buildThumbUrl(secureUrl) {
    if (!secureUrl) return '';
    if (!secureUrl.includes('/upload/')) return secureUrl;

    return secureUrl.replace(
        '/upload/',
        '/upload/c_limit,w_560,h_560,q_auto:eco,f_webp/'
    );
}

async function uploadToCloudinary({ blob, taskId, fileName }) {
    const config = getStorageProviderConfig();
    const cloudName = (config.cloudinaryCloudName || '').trim();
    const uploadPreset = (config.cloudinaryUploadPreset || '').trim();
    const folderBase = (config.cloudinaryInternalPhotosFolder || 'lpv/internal-photos').replace(/\/$/, '');

    if (!cloudName || !uploadPreset) {
        throw new Error('Configure LPV_CLOUDINARY_CLOUD_NAME e LPV_CLOUDINARY_UPLOAD_PRESET para upload direto no Cloudinary.');
    }

    const safeUploadName = sanitizeFilename(fileName || 'foto');
    const baseName = safeUploadName.replace(/\.[a-zA-Z0-9]+$/, '');
    const photoId = createVersionId();
    const folder = `${folderBase}/${taskId}`;
    const publicId = `${photoId}-${baseName}`;

    const formData = new FormData();
    formData.append('file', blob, safeUploadName);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);
    formData.append('public_id', publicId);
    formData.append('resource_type', 'image');
    formData.append('return_delete_token', 'true');

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
    });

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }

    if (!response.ok || !data?.secure_url) {
        const message = data?.error?.message || `Falha no upload para Cloudinary (${response.status})`;
        throw new Error(message);
    }

    return {
        photoId,
        secureUrl: data.secure_url,
        thumbUrl: buildThumbUrl(data.secure_url),
        publicId: data.public_id || `${folder}/${publicId}`,
        bytes: Number(data.bytes || blob.size || 0),
        width: data.width || null,
        height: data.height || null,
        format: (data.format || '').toString().trim().toLowerCase(),
        deleteToken: data.delete_token || null
    };
}

async function deleteFromCloudinaryByToken(deleteToken) {
    const token = (deleteToken || '').toString().trim();
    if (!token) {
        throw new Error('Foto sem token de exclusao no Cloudinary.');
    }

    const config = getStorageProviderConfig();
    const cloudName = (config.cloudinaryCloudName || '').trim();
    if (!cloudName) {
        throw new Error('Cloudinary nao configurado para exclusao.');
    }

    const formData = new FormData();
    formData.append('token', token);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/delete_by_token`, {
        method: 'POST',
        body: formData
    });

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }

    if (!response.ok) {
        const message = data?.error?.message || `Falha ao excluir foto no Cloudinary (${response.status})`;
        throw new Error(message);
    }

    return { ok: true };
}

export async function uploadInternalPhoto(taskId, file, options = {}) {
    if (!taskId || !file) {
        throw new Error('taskId e arquivo sao obrigatorios para upload de foto.');
    }

    const user = ensureAuthenticatedUser();
    const userContext = await getUserContext(user);

    const taskRef = doc(db, 'tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    if (!taskSnap.exists()) {
        throw new Error('Tarefa nao encontrada.');
    }

    const taskData = taskSnap.data() || {};
    if (!hasReportAccess(userContext, taskData)) {
        throw new Error('Sem permissao para enviar fotos internas nesta tarefa.');
    }

    const originalFileName = sanitizeFilename(file.name || 'foto');
    const originalBaseName = originalFileName.replace(/\.[a-zA-Z0-9]+$/, '') || 'foto';
    const originalExtMatch = originalFileName.toLowerCase().match(/\.([a-z0-9]{2,6})$/);
    const originalExt = originalExtMatch ? originalExtMatch[1] : '';

    const uploadResult = await uploadToCloudinary({
        blob: file,
        taskId,
        fileName: originalFileName
    });

    const finalExt = uploadResult.format || originalExt || 'jpg';
    const photoMeta = {
        photoId: uploadResult.photoId,
        caption: (options.caption || '').toString().trim(),
        originalFileName,
        fileName: `${originalBaseName}.${finalExt}`,
        publicId: uploadResult.publicId,
        deleteToken: uploadResult.deleteToken,
        url: uploadResult.secureUrl,
        thumbUrl: uploadResult.thumbUrl,
        format: finalExt,
        mimeType: (file.type || '').toString(),
        bytes: uploadResult.bytes,
        width: uploadResult.width,
        height: uploadResult.height,
        uploadedBy: userContext.uid,
        uploadedByName: userContext.name,
        uploadedAt: nowIso()
    };

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(taskRef);
        if (!snap.exists()) {
            throw new Error('Tarefa nao encontrada durante gravacao da foto.');
        }

        const freshData = snap.data() || {};
        const internalPhotos = Array.isArray(freshData.internalPhotos) ? freshData.internalPhotos : [];
        internalPhotos.push(photoMeta);

        tx.update(taskRef, {
            internalPhotos,
            lastEditor: userContext.uid,
            lastEditedAt: nowIso()
        });
    });

    return { ok: true, photo: photoMeta };
}

export async function uploadInternalPhotos(taskId, files, options = {}) {
    const list = Array.from(files || []);
    if (list.length === 0) return [];

    const results = [];
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const response = await uploadInternalPhoto(taskId, file, options);
        results.push(response.photo);

        if (onProgress) {
            onProgress({
                done: i + 1,
                total: list.length,
                fileName: file.name
            });
        }
    }

    return results;
}

export async function removeInternalPhoto(taskId, photoId) {
    if (!taskId || !photoId) {
        throw new Error('taskId e photoId sao obrigatorios para remover foto.');
    }

    const user = ensureAuthenticatedUser();
    const userContext = await getUserContext(user);
    const roles = normalizeRoleList(userContext.role || []);

    const taskRef = doc(db, 'tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    if (!taskSnap.exists()) {
        throw new Error('Tarefa nao encontrada.');
    }

    const taskData = taskSnap.data() || {};
    if (!hasReportAccess(userContext, taskData)) {
        throw new Error('Sem permissao para remover fotos internas nesta tarefa.');
    }

    const photos = Array.isArray(taskData.internalPhotos) ? taskData.internalPhotos : [];
    const target = photos.find((item) => item.photoId === photoId);
    if (!target) {
        throw new Error('Foto nao encontrada.');
    }

    const canDeleteAsRole = roles.includes('admin') || roles.includes('professor');
    const canDeleteAsOwner = (target.uploadedBy || '') === userContext.uid;
    if (!canDeleteAsRole && !canDeleteAsOwner) {
        throw new Error('Sem permissao para remover esta foto.');
    }

    await deleteFromCloudinaryByToken(target.deleteToken);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(taskRef);
        if (!snap.exists()) {
            throw new Error('Tarefa nao encontrada.');
        }

        const freshData = snap.data() || {};
        const freshPhotos = Array.isArray(freshData.internalPhotos) ? freshData.internalPhotos : [];
        const stillExists = freshPhotos.some((item) => item.photoId === photoId);
        if (!stillExists) {
            return;
        }

        const filtered = freshPhotos.filter((item) => item.photoId !== photoId);

        const updateData = {
            lastEditor: userContext.uid,
            lastEditedAt: nowIso()
        };

        if (filtered.length > 0) {
            updateData.internalPhotos = filtered;
        } else {
            updateData.internalPhotos = deleteField();
        }

        tx.update(taskRef, updateData);
    });

    return {
        ok: true
    };
}
