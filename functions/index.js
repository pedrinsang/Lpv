const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { createClient } = require("@supabase/supabase-js");
const cors = require("cors")({ origin: true });
const cloudinary = require("cloudinary").v2;
const { randomUUID } = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const REGION = process.env.FUNCTION_REGION || "us-central1";
const REPORTS_BUCKET = process.env.SUPABASE_REPORTS_BUCKET || "reports";
const DEFAULT_CLOUDINARY_FOLDER = process.env.CLOUDINARY_INTERNAL_PHOTOS_FOLDER || "lpv/internal-photos";

function isWordToPdfAutoConversionEnabled() {
  const raw = (process.env.WORD_TO_PDF_CONVERTER_ENABLED || "")
    .toString()
    .trim()
    .toLowerCase();

  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false }
  });
}

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });
}

function withCors(handler) {
  return onRequest({ region: REGION }, (req, res) => {
    cors(req, res, async () => {
      try {
        await handler(req, res);
      } catch (error) {
        logger.error("Unhandled function error", error);
        if (!res.headersSent) {
          res.status(500).json({
            ok: false,
            error: "internal-error",
            message: error.message || "Internal server error"
          });
        }
      }
    });
  });
}

function requirePost(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method-not-allowed" });
    return false;
  }

  return true;
}

function normalizeRoleList(roleData) {
  if (!roleData) return [];
  const arr = Array.isArray(roleData) ? roleData : [roleData];
  return arr
    .map((item) => (item || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim())
    .filter(Boolean);
}

function normalizeName(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function sanitizeFilename(filename, fallback = "file") {
  const safe = (filename || fallback)
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

  return safe || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createVersionId() {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function normalizeReportFiles(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  return {
    activeSource: base.activeSource || "online_report",
    activeWordVersionId: base.activeWordVersionId || null,
    activePdfVersionId: base.activePdfVersionId || null,
    wordVersions: Array.isArray(base.wordVersions) ? base.wordVersions : [],
    pdfVersions: Array.isArray(base.pdfVersions) ? base.pdfVersions : [],
    lastConversionError: base.lastConversionError || null,
    lastConversionAt: base.lastConversionAt || null
  };
}

function getTaskFinancialStatus(taskData) {
  return (taskData?.financialStatus || taskData?.situacao || "pendente")
    .toString()
    .toLowerCase()
    .trim();
}

function canPublicDownloadTask(taskData) {
  const status = (taskData?.status || "").toString().toLowerCase().trim();
  const finStatus = getTaskFinancialStatus(taskData);
  return status === "concluido" && finStatus !== "pendente";
}

function findPdfVersion(reportFiles, versionId = null) {
  const list = Array.isArray(reportFiles?.pdfVersions) ? reportFiles.pdfVersions : [];
  if (list.length === 0) return null;

  const targetId = versionId || reportFiles.activePdfVersionId;
  if (!targetId) {
    return list[list.length - 1] || null;
  }

  return list.find((item) => item.versionId === targetId) || null;
}

function findWordVersion(reportFiles, versionId = null) {
  const list = Array.isArray(reportFiles?.wordVersions) ? reportFiles.wordVersions : [];
  if (list.length === 0) return null;

  const targetId = versionId || reportFiles.activeWordVersionId;
  if (!targetId) return null;

  return list.find((item) => item.versionId === targetId) || null;
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

  if (reportFiles.activeSource === "uploaded_word" && !hasActiveWord) {
    reportFiles.activeSource = hasActivePdf ? "uploaded_pdf" : "online_report";
    return;
  }

  if (reportFiles.activeSource === "uploaded_pdf" && !hasActivePdf) {
    reportFiles.activeSource = hasActiveWord ? "uploaded_word" : "online_report";
    return;
  }

  if (!hasActiveWord && !hasActivePdf) {
    reportFiles.activeSource = "online_report";
  }
}

function buildPublicTaskPayload(taskId, taskData) {
  const reportFiles = normalizeReportFiles(taskData.reportFiles);
  const hasStoredPdf = !!findPdfVersion(reportFiles);

  return {
    id: taskId,
    accessCode: taskData.accessCode || null,
    protocolo: taskData.protocolo || null,
    animalNome: taskData.animalNome || null,
    proprietario: taskData.proprietario || null,
    dataEntrada: taskData.dataEntrada || null,
    createdAt: taskData.createdAt || null,
    status: taskData.status || "clivagem",
    financialStatus: getTaskFinancialStatus(taskData),
    hasStoredPdf
  };
}

async function parseAuthContext(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Authorization header.");
  }

  const idToken = authHeader.slice("Bearer ".length);
  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;

  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const roles = normalizeRoleList(userData.role);

  return {
    uid,
    email: decoded.email || userData.email || null,
    name: userData.name || decoded.name || null,
    roles,
    isAdmin: roles.includes("admin"),
    isProfessor: roles.includes("professor"),
    isPostGrad: roles.some((r) => r.includes("graduando"))
  };
}

function hasReportAccess(authCtx, taskData) {
  const taskPosUid = (taskData.posResponsavelUid || "").toString().trim();
  const userName = normalizeName(authCtx.name);
  const taskPosName = normalizeName(taskData.posGraduando);
  const isTaskOwnerByUid = !!taskPosUid && taskPosUid === authCtx.uid;
  const isTaskOwnerByLegacyName = !taskPosUid && userName && userName === taskPosName;
  return authCtx.isAdmin || authCtx.isProfessor || isTaskOwnerByUid || isTaskOwnerByLegacyName;
}

function hasPhotoMutationAccess(authCtx, taskData) {
  // Fotos internas: equipe do lab (admin/professor/pós responsável)
  return hasReportAccess(authCtx, taskData);
}

function decodeBase64Payload(base64Data) {
  if (!base64Data || typeof base64Data !== "string") {
    throw new Error("Invalid base64 payload.");
  }

  const cleaned = base64Data.includes(",") ? base64Data.split(",").pop() : base64Data;
  return Buffer.from(cleaned, "base64");
}

async function appendReportVersion({ taskId, fileType, versionMeta, markAsPrimary = true, authCtx }) {
  const taskRef = db.collection("tasks").doc(taskId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) {
      throw new Error("Task not found.");
    }

    const data = snap.data();
    const reportFiles = normalizeReportFiles(data.reportFiles);

    if (fileType === "word") {
      reportFiles.wordVersions.push(versionMeta);
      reportFiles.activeWordVersionId = versionMeta.versionId;
      if (markAsPrimary) {
        reportFiles.activeSource = "uploaded_word";
      }
    } else {
      reportFiles.pdfVersions.push(versionMeta);
      reportFiles.activePdfVersionId = versionMeta.versionId;
      if (markAsPrimary) {
        reportFiles.activeSource = "uploaded_pdf";
      }
    }

    tx.update(taskRef, {
      reportFiles,
      lastEditor: authCtx.uid,
      lastEditedAt: nowIso()
    });
  });
}

async function setConversionFailure({ taskId, message }) {
  const taskRef = db.collection("tasks").doc(taskId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return;
    const data = snap.data();
    const reportFiles = normalizeReportFiles(data.reportFiles);
    reportFiles.lastConversionError = message;
    reportFiles.lastConversionAt = nowIso();
    tx.update(taskRef, { reportFiles });
  });
}

async function clearConversionFailure({ taskId }) {
  const taskRef = db.collection("tasks").doc(taskId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return;
    const data = snap.data();
    const reportFiles = normalizeReportFiles(data.reportFiles);

    if (!reportFiles.lastConversionError) return;

    reportFiles.lastConversionError = null;
    reportFiles.lastConversionAt = nowIso();
    tx.update(taskRef, { reportFiles });
  });
}

async function convertWordToPdfAndStore({ supabase, taskId, wordVersion, authCtx }) {
  if (!isWordToPdfAutoConversionEnabled()) {
    return null;
  }

  const converterUrl = (process.env.WORD_TO_PDF_CONVERTER_URL || "").toString().trim();
  if (!converterUrl) {
    throw new Error("WORD_TO_PDF_CONVERTER_URL is required when WORD_TO_PDF_CONVERTER_ENABLED=true.");
  }

  const signedWord = await supabase.storage.from(REPORTS_BUCKET).createSignedUrl(wordVersion.storagePath, 60 * 10);
  if (signedWord.error || !signedWord.data?.signedUrl) {
    throw new Error(`Failed to create signed URL for source Word: ${signedWord.error?.message || "unknown"}`);
  }

  const convertResponse = await fetch(converterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Converter-Key": process.env.WORD_TO_PDF_CONVERTER_KEY || ""
    },
    body: JSON.stringify({
      sourceUrl: signedWord.data.signedUrl,
      sourceFileName: wordVersion.fileName,
      taskId
    })
  });

  let pdfBuffer;
  const contentType = convertResponse.headers.get("content-type") || "";

  if (!convertResponse.ok) {
    const txt = await convertResponse.text();
    throw new Error(`Word->PDF converter failed: ${txt || convertResponse.status}`);
  }

  if (contentType.includes("application/json")) {
    const json = await convertResponse.json();

    if (json.pdfBase64) {
      pdfBuffer = decodeBase64Payload(json.pdfBase64);
    } else if (json.pdfUrl) {
      const fileRes = await fetch(json.pdfUrl);
      if (!fileRes.ok) {
        throw new Error("Converter returned pdfUrl but file fetch failed.");
      }
      pdfBuffer = Buffer.from(await fileRes.arrayBuffer());
    } else {
      throw new Error("Converter response missing pdfBase64/pdfUrl.");
    }
  } else {
    pdfBuffer = Buffer.from(await convertResponse.arrayBuffer());
  }

  const pdfVersionId = createVersionId();
  const baseName = wordVersion.fileName.replace(/\.docx?$/i, "") || "laudo";
  const pdfFileName = `${baseName}.pdf`;
  const pdfStoragePath = `tasks/${taskId}/pdf/${pdfVersionId}-${sanitizeFilename(pdfFileName)}`;

  const uploadRes = await supabase.storage.from(REPORTS_BUCKET).upload(pdfStoragePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "3600"
  });

  if (uploadRes.error) {
    throw new Error(`Failed to upload converted PDF: ${uploadRes.error.message}`);
  }

  const convertedMeta = {
    versionId: pdfVersionId,
    fileType: "pdf",
    source: "converted_from_word",
    linkedVersionId: wordVersion.versionId,
    fileName: pdfFileName,
    storagePath: pdfStoragePath,
    mimeType: "application/pdf",
    size: pdfBuffer.length,
    uploadedBy: authCtx.uid,
    uploadedByName: authCtx.name || authCtx.email || "Usuário",
    uploadedAt: nowIso()
  };

  await db.runTransaction(async (tx) => {
    const taskRef = db.collection("tasks").doc(taskId);
    const snap = await tx.get(taskRef);
    if (!snap.exists) return;
    const data = snap.data();
    const reportFiles = normalizeReportFiles(data.reportFiles);

    reportFiles.pdfVersions.push(convertedMeta);
    reportFiles.activePdfVersionId = pdfVersionId;
    reportFiles.lastConversionError = null;
    reportFiles.lastConversionAt = nowIso();

    const updatedWordVersions = reportFiles.wordVersions.map((version) => {
      if (version.versionId === wordVersion.versionId) {
        return { ...version, derivedPdfVersionId: pdfVersionId };
      }
      return version;
    });

    reportFiles.wordVersions = updatedWordVersions;
    tx.update(taskRef, { reportFiles });
  });

  return convertedMeta;
}

exports.uploadReportFile = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const authCtx = await parseAuthContext(req);
  const { taskId, fileType, source, fileName, mimeType, base64Data, markAsPrimary } = req.body || {};

  if (!taskId || !fileType || !fileName || !mimeType || !base64Data) {
    return res.status(400).json({ ok: false, error: "missing-fields" });
  }

  if (!["word", "pdf"].includes(fileType)) {
    return res.status(400).json({ ok: false, error: "invalid-file-type" });
  }

  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) {
    return res.status(404).json({ ok: false, error: "task-not-found" });
  }

  const taskData = taskSnap.data();
  if (!hasReportAccess(authCtx, taskData)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const binary = decodeBase64Payload(base64Data);
  const maxBytes = 25 * 1024 * 1024;
  if (binary.length > maxBytes) {
    return res.status(413).json({ ok: false, error: "file-too-large", maxBytes });
  }

  const supabase = getSupabaseAdminClient();

  const ext = fileType === "word" ? ".docx" : ".pdf";
  const safeName = sanitizeFilename(fileName.endsWith(ext) ? fileName : `${fileName}${ext}`);
  const versionId = createVersionId();
  const storagePath = `tasks/${taskId}/${fileType}/${versionId}-${safeName}`;

  const uploadRes = await supabase.storage.from(REPORTS_BUCKET).upload(storagePath, binary, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "3600"
  });

  if (uploadRes.error) {
    logger.error("Supabase upload failed", uploadRes.error);
    return res.status(500).json({ ok: false, error: "upload-failed", message: uploadRes.error.message });
  }

  const versionMeta = {
    versionId,
    fileType,
    source: source || "manual_upload",
    linkedVersionId: null,
    fileName: safeName,
    storagePath,
    mimeType,
    size: binary.length,
    uploadedBy: authCtx.uid,
    uploadedByName: authCtx.name || authCtx.email || "Usuário",
    uploadedAt: nowIso()
  };

  await appendReportVersion({
    taskId,
    fileType,
    versionMeta,
    markAsPrimary: markAsPrimary !== false,
    authCtx
  });

  let convertedPdf = null;
  if (fileType === "word") {
    if (isWordToPdfAutoConversionEnabled()) {
      try {
        convertedPdf = await convertWordToPdfAndStore({
          supabase,
          taskId,
          wordVersion: versionMeta,
          authCtx
        });
      } catch (error) {
        logger.warn("Automatic Word->PDF conversion failed", { taskId, error: error.message });
        await setConversionFailure({ taskId, message: error.message || "Unknown conversion error" });
      }
    } else {
      await clearConversionFailure({ taskId });
    }
  }

  return res.json({
    ok: true,
    version: versionMeta,
    convertedPdf
  });
});

exports.getReportFileDownloadUrl = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const authCtx = await parseAuthContext(req);
  const { taskId, fileType, versionId, expiresIn } = req.body || {};

  if (!taskId || !fileType) {
    return res.status(400).json({ ok: false, error: "missing-fields" });
  }

  if (!["word", "pdf"].includes(fileType)) {
    return res.status(400).json({ ok: false, error: "invalid-file-type" });
  }

  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) {
    return res.status(404).json({ ok: false, error: "task-not-found" });
  }

  const taskData = taskSnap.data();
  if (!hasReportAccess(authCtx, taskData)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const reportFiles = normalizeReportFiles(taskData.reportFiles);
  let version = null;

  if (fileType === "word") {
    const list = reportFiles.wordVersions;
    const fallbackVersionId = reportFiles.activeWordVersionId;
    const targetVersionId = versionId || fallbackVersionId;
    if (!targetVersionId) {
      return res.status(404).json({ ok: false, error: "no-active-version" });
    }
    version = list.find((item) => item.versionId === targetVersionId) || null;
  } else {
    version = findPdfVersion(reportFiles, versionId || null);
  }

  if (!version) {
    return res.status(404).json({ ok: false, error: "version-not-found" });
  }

  const supabase = getSupabaseAdminClient();
  const ttl = Number.isFinite(Number(expiresIn)) ? Math.max(60, Math.min(3600, Number(expiresIn))) : 900;
  const signed = await supabase.storage.from(REPORTS_BUCKET).createSignedUrl(version.storagePath, ttl);

  if (signed.error || !signed.data?.signedUrl) {
    return res.status(500).json({ ok: false, error: "signed-url-failed", message: signed.error?.message || "Unknown" });
  }

  return res.json({
    ok: true,
    url: signed.data.signedUrl,
    version
  });
});

exports.removeReportFileVersion = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const authCtx = await parseAuthContext(req);
  const { taskId, fileType, versionId = null } = req.body || {};

  if (!taskId || !fileType) {
    return res.status(400).json({ ok: false, error: "missing-fields" });
  }

  if (!["word", "pdf"].includes(fileType)) {
    return res.status(400).json({ ok: false, error: "invalid-file-type" });
  }

  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    return res.status(404).json({ ok: false, error: "task-not-found" });
  }

  const taskData = taskSnap.data() || {};
  if (!hasReportAccess(authCtx, taskData)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const reportFiles = normalizeReportFiles(taskData.reportFiles);
  const targetVersion = fileType === "word"
    ? findWordVersion(reportFiles, versionId || null)
    : findPdfVersion(reportFiles, versionId || null);

  if (!targetVersion) {
    return res.status(404).json({ ok: false, error: "version-not-found" });
  }

  const storagePath = (targetVersion.storagePath || "").toString().trim();
  if (!storagePath) {
    return res.status(400).json({
      ok: false,
      error: "invalid-storage-path",
      message: "Versao sem storagePath; nao foi possivel confirmar exclusao no Supabase."
    });
  }

  const supabase = getSupabaseAdminClient();
  const removeResult = await supabase.storage.from(REPORTS_BUCKET).remove([storagePath]);
  if (removeResult.error) {
    logger.error("Supabase delete failed", {
      taskId,
      fileType,
      versionId: targetVersion.versionId,
      storagePath,
      message: removeResult.error.message
    });

    return res.status(502).json({
      ok: false,
      error: "storage-delete-failed",
      message: removeResult.error.message || "Falha ao remover arquivo no Supabase."
    });
  }

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(taskRef);
    if (!freshSnap.exists) {
      throw new Error("Task not found while persisting deletion.");
    }

    const freshData = freshSnap.data() || {};
    const freshReportFiles = normalizeReportFiles(freshData.reportFiles);
    const freshTarget = fileType === "word"
      ? findWordVersion(freshReportFiles, targetVersion.versionId)
      : findPdfVersion(freshReportFiles, targetVersion.versionId);

    if (!freshTarget) {
      return;
    }

    if (fileType === "word") {
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
      lastEditor: authCtx.uid,
      lastEditedAt: nowIso()
    };

    if (hasAnyStoredVersion) {
      updateData.reportFiles = freshReportFiles;
    } else {
      updateData.reportFiles = admin.firestore.FieldValue.delete();
    }

    tx.update(taskRef, updateData);
  });

  return res.json({
    ok: true,
    removedVersion: targetVersion
  });
});

exports.getPublicTaskByAccessCode = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const { accessCode } = req.body || {};
  const code = (accessCode || "").toString().trim();

  if (!code) {
    return res.status(400).json({ ok: false, error: "missing-access-code" });
  }

  const snap = await db
    .collection("tasks")
    .where("accessCode", "==", code)
    .limit(1)
    .get();

  if (snap.empty) {
    return res.status(404).json({ ok: false, error: "not-found" });
  }

  const taskDoc = snap.docs[0];
  const taskData = taskDoc.data() || {};

  return res.json({
    ok: true,
    task: buildPublicTaskPayload(taskDoc.id, taskData)
  });
});

exports.getPublicReportPdfDownloadUrl = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const { accessCode, expiresIn } = req.body || {};
  const code = (accessCode || "").toString().trim();

  if (!code) {
    return res.status(400).json({ ok: false, error: "missing-access-code" });
  }

  const snap = await db
    .collection("tasks")
    .where("accessCode", "==", code)
    .limit(1)
    .get();

  if (snap.empty) {
    return res.status(404).json({ ok: false, error: "report-not-available" });
  }

  const taskDoc = snap.docs[0];
  const taskData = taskDoc.data() || {};

  if (!canPublicDownloadTask(taskData)) {
    return res.status(404).json({ ok: false, error: "report-not-available" });
  }

  const reportFiles = normalizeReportFiles(taskData.reportFiles);
  const version = findPdfVersion(reportFiles);

  if (!version || !version.storagePath) {
    return res.status(404).json({ ok: false, error: "report-not-available" });
  }

  const supabase = getSupabaseAdminClient();
  const ttl = Number.isFinite(Number(expiresIn)) ? Math.max(60, Math.min(1800, Number(expiresIn))) : 900;
  const signed = await supabase.storage.from(REPORTS_BUCKET).createSignedUrl(version.storagePath, ttl);

  if (signed.error || !signed.data?.signedUrl) {
    return res.status(500).json({ ok: false, error: "signed-url-failed", message: signed.error?.message || "Unknown" });
  }

  return res.json({
    ok: true,
    url: signed.data.signedUrl,
    version,
    task: buildPublicTaskPayload(taskDoc.id, taskData)
  });
});

exports.uploadInternalPhoto = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const authCtx = await parseAuthContext(req);
  const { taskId, fileName, mimeType, base64Data, caption } = req.body || {};

  if (!taskId || !fileName || !mimeType || !base64Data) {
    return res.status(400).json({ ok: false, error: "missing-fields" });
  }

  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) {
    return res.status(404).json({ ok: false, error: "task-not-found" });
  }

  const taskData = taskSnap.data();
  if (!hasPhotoMutationAccess(authCtx, taskData)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  configureCloudinary();

  const maxBytes = 12 * 1024 * 1024;
  const binary = decodeBase64Payload(base64Data);
  if (binary.length > maxBytes) {
    return res.status(413).json({ ok: false, error: "file-too-large", maxBytes });
  }

  const photoId = createVersionId();
  const baseName = sanitizeFilename(fileName).replace(/\.[a-zA-Z0-9]+$/, "");
  const publicId = `${DEFAULT_CLOUDINARY_FOLDER}/${taskId}/${photoId}-${baseName}`;

  const uploadResult = await cloudinary.uploader.upload(`data:${mimeType};base64,${binary.toString("base64")}`, {
    public_id: publicId,
    resource_type: "image",
    overwrite: true,
    format: "webp",
    quality: "auto:good",
    eager: [
      {
        width: 560,
        height: 560,
        crop: "limit",
        format: "webp",
        quality: "auto:eco"
      }
    ],
    eager_async: false,
    folder: `${DEFAULT_CLOUDINARY_FOLDER}/${taskId}`
  });

  const photoMeta = {
    photoId,
    caption: (caption || "").toString().trim(),
    fileName: `${baseName}.webp`,
    publicId: uploadResult.public_id,
    url: uploadResult.secure_url,
    thumbUrl: uploadResult.eager && uploadResult.eager[0] ? uploadResult.eager[0].secure_url : uploadResult.secure_url,
    format: uploadResult.format || "webp",
    bytes: uploadResult.bytes || binary.length,
    width: uploadResult.width || null,
    height: uploadResult.height || null,
    uploadedBy: authCtx.uid,
    uploadedByName: authCtx.name || authCtx.email || "Usuário",
    uploadedAt: nowIso()
  };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new Error("Task not found while persisting photo.");

    const data = snap.data();
    const internalPhotos = Array.isArray(data.internalPhotos) ? data.internalPhotos : [];
    internalPhotos.push(photoMeta);

    tx.update(taskRef, {
      internalPhotos,
      lastEditor: authCtx.uid,
      lastEditedAt: nowIso()
    });
  });

  return res.json({ ok: true, photo: photoMeta });
});

exports.removeInternalPhoto = withCors(async (req, res) => {
  if (!requirePost(req, res)) return;

  const authCtx = await parseAuthContext(req);
  const { taskId, photoId } = req.body || {};

  if (!taskId || !photoId) {
    return res.status(400).json({ ok: false, error: "missing-fields" });
  }

  configureCloudinary();

  const taskRef = db.collection("tasks").doc(taskId);

  const snap = await taskRef.get();
  if (!snap.exists) {
    return res.status(404).json({ ok: false, error: "task-not-found" });
  }

  const data = snap.data();
  if (!hasPhotoMutationAccess(authCtx, data)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const photos = Array.isArray(data.internalPhotos) ? data.internalPhotos : [];
  const target = photos.find((item) => item.photoId === photoId);
  if (!target) {
    return res.status(404).json({ ok: false, error: "photo-not-found" });
  }

  const canDelete = authCtx.isAdmin || authCtx.isProfessor || target.uploadedBy === authCtx.uid;
  if (!canDelete) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const targetPublicId = (target.publicId || "").toString().trim();
  if (!targetPublicId) {
    return res.status(400).json({
      ok: false,
      error: "invalid-public-id",
      message: "Foto sem publicId; nao foi possivel confirmar exclusao no Cloudinary."
    });
  }

  let destroyResult = null;
  try {
    destroyResult = await cloudinary.uploader.destroy(targetPublicId, {
      resource_type: "image",
      invalidate: true
    });
  } catch (error) {
    logger.error("Cloudinary destroy failed", { taskId, photoId, message: error.message });
    return res.status(502).json({
      ok: false,
      error: "storage-delete-failed",
      message: error.message || "Falha ao remover foto no Cloudinary."
    });
  }

  const destroyState = (destroyResult?.result || "").toString().toLowerCase();
  if (destroyState && destroyState !== "ok" && destroyState !== "not found") {
    return res.status(502).json({
      ok: false,
      error: "storage-delete-failed",
      message: `Resposta inesperada do Cloudinary ao excluir foto: ${destroyState}`
    });
  }

  const filtered = photos.filter((item) => item.photoId !== photoId);
  const updateData = {
    lastEditor: authCtx.uid,
    lastEditedAt: nowIso()
  };

  if (filtered.length > 0) {
    updateData.internalPhotos = filtered;
  } else {
    updateData.internalPhotos = admin.firestore.FieldValue.delete();
  }

  await taskRef.update(updateData);

  return res.json({ ok: true });
});
