import { db, auth } from '../core.js';
import { collection, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

let docxModulePromise = null;

function normalizeRoles(role) {
    if (!role) return [];
    const arr = Array.isArray(role) ? role : [role];
    return arr.map(r => (r || '').toString().toLowerCase().trim()).filter(Boolean);
}

function hasPostGradRole(role) {
    return normalizeRoles(role).some(r => r.includes('graduando'));
}

function hasTeacherRole(role) {
    return normalizeRoles(role).some(r => r === 'professor' || r === 'admin');
}

function pickFilledValue(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        return value;
    }
    return '';
}

function normalizeText(value) {
    return (value || '-').toString();
}

function sanitizeFilePart(value, fallback) {
    const safe = (value || fallback)
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');
    return safe || fallback;
}

function formatDateValue(value) {
    if (!value) return '';
    const raw = value.toString().trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return new Date(`${raw}T12:00:00`).toLocaleDateString('pt-BR');
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('pt-BR');
    }

    return raw;
}

function formatCrmv(crmv, fallback = '') {
    const value = (crmv || fallback || '').toString().trim();
    if (!value) return '';
    return /^crmv/i.test(value) ? value.toUpperCase() : `CRMV ${value}`;
}

function formatAnimalSexLabel(sexo) {
    const raw = (sexo || '').toString().trim();
    const normalized = raw.toLowerCase();
    if (normalized === 'f' || normalized === 'femea' || normalized === 'fêmea') return 'Fêmea';
    if (normalized === 'm' || normalized === 'macho') return 'Macho';
    return raw || '-';
}

function formatAnimalBreedLabel(raca) {
    const value = (raca || '').toString().trim().replace(/\s+/g, ' ');
    return value || 'SRD';
}

function toMultilineRuns(TextRun, text, runOptions = {}) {
    const lines = normalizeText(text).split(/\r?\n/);
    return lines.flatMap((line, index) => {
        if (index === 0) {
            return [new TextRun({ ...runOptions, text: line })];
        }
        return [new TextRun({ ...runOptions, break: 1, text: line })];
    });
}

function buildDiagnosisRuns(TextRun, diagnosisText) {
    const raw = (diagnosisText || '').toString().trim();
    if (!raw) {
        return [new TextRun({ text: '-', bold: true, italics: true })];
    }

    const firstComma = raw.indexOf(',');
    if (firstComma === -1) {
        return [new TextRun({ text: raw, bold: true, italics: true, underline: {} })];
    }

    const beforeComma = raw.slice(0, firstComma).trimEnd();
    const afterComma = raw.slice(firstComma);

    return [
        new TextRun({ text: beforeComma, bold: true, italics: true, underline: {} }),
        new TextRun({ text: afterComma, bold: true, italics: true })
    ];
}

async function getImageAsUint8Array(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    } catch (error) {
        console.warn(`Imagem não carregada (${url}):`, error);
        return null;
    }
}

async function getImageDimensionsFromUrl(url) {
    if (!url) return null;

    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            if (!image.width || !image.height) {
                resolve(null);
                return;
            }

            resolve({ width: image.width, height: image.height });
        };
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function fitImageTransform(dimensions, targetWidth, maxHeight = 90) {
    if (!dimensions?.width || !dimensions?.height) {
        return { width: targetWidth, height: Math.round(targetWidth * 0.6) };
    }

    const proportionalHeight = Math.round((dimensions.height / dimensions.width) * targetWidth);
    const height = Math.max(28, Math.min(proportionalHeight, maxHeight));
    return { width: targetWidth, height };
}

function base64ToUint8Array(dataUrl) {
    if (!dataUrl) return null;

    try {
        const [, base64Part] = dataUrl.split(',');
        const encoded = base64Part || dataUrl;
        const binaryString = atob(encoded);
        const length = binaryString.length;
        const bytes = new Uint8Array(length);

        for (let index = 0; index < length; index += 1) {
            bytes[index] = binaryString.charCodeAt(index);
        }

        return bytes;
    } catch (error) {
        console.warn('Não foi possível converter assinatura para imagem no Word:', error);
        return null;
    }
}

async function getDataUrlImageDimensions(dataUrl) {
    if (!dataUrl) return null;

    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            if (!image.width || !image.height) {
                resolve(null);
                return;
            }

            resolve({ width: image.width, height: image.height });
        };
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

function normalizeGuideRatio(value, fallback = 0.72) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(0.95, Math.max(0.05, numeric));
}

async function composeSignatureImageWithGuideLine(dataUrl, guideRatio) {
    if (!dataUrl) return null;

    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const width = image.width;
            const height = image.height;
            if (!width || !height) {
                resolve(null);
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) {
                resolve(null);
                return;
            }

            context.drawImage(image, 0, 0);

            const ratio = normalizeGuideRatio(guideRatio);
            const guideY = Math.round((height - 1) * ratio);
            const lineWidth = Math.max(1.6, width * 0.005);

            context.save();
            context.strokeStyle = '#000000';
            context.lineWidth = lineWidth;
            context.beginPath();
            context.moveTo(0, guideY + 0.5);
            context.lineTo(width, guideY + 0.5);
            context.stroke();
            context.restore();

            resolve({
                dataUrl: canvas.toDataURL('image/png'),
                width,
                height
            });
        };

        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

async function fetchSignature(releasedByUid) {
    const uidToTry = releasedByUid || (auth.currentUser ? auth.currentUser.uid : null);
    if (!uidToTry) return null;

    try {
        const userSnap = await getDoc(doc(db, 'users', uidToTry));
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.signatureBase64) {
                return {
                    base64: data.signatureBase64,
                    name: data.name || null,
                    role: data.role || null,
                    crmv: data.crmv || null,
                    signatureGuideRatio: data.signatureGuideRatio ?? null
                };
            }
        }
    } catch (error) {
        console.warn('Não foi possível buscar assinatura:', error);
    }

    return null;
}

async function fetchUserProfile(uidOrName, options = {}) {
    if (!uidOrName) return null;
    const { byName = false, roleFilter = null } = options;

    try {
        if (byName) {
            const usersQuery = query(collection(db, 'users'), where('name', '==', uidOrName));
            const usersSnap = await getDocs(usersQuery);
            const candidates = [];

            usersSnap.forEach((userDoc) => {
                candidates.push({ uid: userDoc.id, ...userDoc.data() });
            });

            if (typeof roleFilter === 'function') {
                const match = candidates.find(profile => roleFilter(profile.role));
                if (match) return match;
            }

            return candidates[0] || null;
        }

        const userSnap = await getDoc(doc(db, 'users', uidOrName));
        if (userSnap.exists()) {
            return { uid: uidOrName, ...userSnap.data() };
        }
    } catch (error) {
        console.warn('Não foi possível buscar perfil do usuário:', error);
    }

    return null;
}

function normalizeSignerData(profile, fallbackName, fallbackCrmv = '') {
    return {
        uid: profile?.uid || null,
        name: profile?.name || fallbackName || 'Responsável',
        role: profile?.role || null,
        base64: profile?.signatureBase64 || null,
        crmv: formatCrmv(profile?.crmv, fallbackCrmv),
        signatureGuideRatio: profile?.signatureGuideRatio ?? null
    };
}

async function resolveSignatureForWord(task) {
    const nomeDocente = task?.docente || 'Dra. Mariana Martins Flores';
    const nomePosGrad = task?.posGraduando || null;
    const posResponsavelUid = (task?.posResponsavelUid || '').toString().trim();

    const docentePromise = fetchUserProfile(nomeDocente, { byName: true, roleFilter: hasTeacherRole });
    const posPromise = posResponsavelUid
        ? fetchUserProfile(posResponsavelUid)
        : fetchUserProfile(nomePosGrad, { byName: true, roleFilter: hasPostGradRole });

    const [docenteProfile, posProfileRaw] = await Promise.all([docentePromise, posPromise]);
    const posProfile = posProfileRaw && hasPostGradRole(posProfileRaw.role) ? posProfileRaw : null;

    const docenteData = normalizeSignerData(docenteProfile, nomeDocente, '14.636');
    const posData = normalizeSignerData(posProfile, nomePosGrad);

    const canSelfSign = hasPostGradRole(posData.role) && !!posProfile?.canSelfSignReports;
    const hasPostGradSignature = !!posData.base64;

    if (canSelfSign && hasPostGradSignature) {
        return {
            mode: 'postgrad-self-sign',
            primary: posData,
            teacher: docenteData
        };
    }

    let signatureData = docenteData;
    if (!signatureData.base64) {
        const releasedSig = await fetchSignature(task?.releasedBy || null);
        if (releasedSig?.base64 && hasTeacherRole(releasedSig.role)) {
            signatureData = {
                ...signatureData,
                base64: releasedSig.base64,
                name: releasedSig.name || signatureData.name,
                crmv: formatCrmv(releasedSig.crmv, signatureData.crmv),
                signatureGuideRatio: releasedSig.signatureGuideRatio ?? signatureData.signatureGuideRatio
            };
        }
    }

    return {
        mode: 'teacher-default-sign',
        primary: signatureData,
        teacher: docenteData
    };
}

function resolveWordValues(task, reportData = {}) {
    const report = reportData || {};

    const protocolo = pickFilledValue(report.protocolo, task?.protocolo, task?.accessCode) || '---';
    const dataRecebimento = pickFilledValue(
        report.data_recebimento,
        task?.dataEntrada ? formatDateValue(task.dataEntrada) : '',
        task?.createdAt ? formatDateValue(task.createdAt) : ''
    ) || '-';

    const dataEmissao = '';

    const chk = (value) => (value ? '[ X ]' : '[   ]');
    const isBiopsia = report.tipo_material_radio
        ? report.tipo_material_radio === 'biopsia'
        : task?.type === 'biopsia';
    const isNecropsia = report.tipo_material_radio
        ? report.tipo_material_radio === 'necropsia'
        : task?.type === 'necropsia';

    const materialDetails = [
        { label: 'Material Remetido', value: `Biópsia ${chk(isBiopsia)}    Necropsia ${chk(isNecropsia)}` },
        { label: 'Tipo de Material', value: report.tipo_material_desc || '-' },
        ...(isNecropsia
            ? [
                { label: 'Data e hora da morte', value: `${report.tempo_morte || '-'} horas` },
                { label: 'Morte', value: `Morte Espontânea ${chk(report.morte_tipo === 'espontanea')}    Eutanásia ${chk(report.morte_tipo === 'eutanasia')}` }
            ]
            : []),
        {
            label: 'Conservação',
            value: `Formol ${chk(!report.conservacao || report.conservacao === 'formol')}   Refrigerado ${chk(report.conservacao === 'refrigerado')}   Congelado ${chk(report.conservacao === 'congelado')}`
        }
    ];

    return {
        protocolo,
        dataRecebimento,
        dataEmissao,
        animalNome: pickFilledValue(report.animalNome, task?.animalNome) || '-',
        animalRg: pickFilledValue(report.animalRg, task?.animalRg) || '-',
        especie: pickFilledValue(report.especie, task?.especie) || '-',
        raca: formatAnimalBreedLabel(pickFilledValue(report.raca, task?.raca)),
        sexo: formatAnimalSexLabel(pickFilledValue(report.sexo, task?.sexo)),
        idade: pickFilledValue(report.idade, task?.idade) || '-',
        requisitante: pickFilledValue(report.remetente, task?.remetente) || '-',
        contatoReq: pickFilledValue(report.telefone_requisitante, task?.remetenteContato) || '-',
        emailReq: pickFilledValue(report.email_requisitante, task?.email_requisitante) || '-',
        clinicaReq: pickFilledValue(report.clinica_requisitante, task?.remetenteClinicaEmpresa) || '-',
        enderecoReq: pickFilledValue(report.endereco_requisitante, task?.remetenteEndereco) || '-',
        proprietario: pickFilledValue(report.proprietario, task?.proprietario) || '-',
        contatoProp: pickFilledValue(report.telefone_proprietario, task?.proprietarioContato) || '-',
        enderecoProp: pickFilledValue(report.endereco_proprietario, task?.proprietarioEndereco) || '-',
        materialDetails,
        historico: report.historico || '-',
        suspeita: report.suspeita || '-',
        macroscopia: report.macroscopia || '-',
        microscopia: report.microscopia || '-',
        diagnostico: report.diagnostico || '-',
        comentarios: report.comentarios || '-'
    };
}

async function loadDocxModule() {
    if (!docxModulePromise) {
        docxModulePromise = import('https://cdn.jsdelivr.net/npm/docx@9.2.0/+esm');
    }
    return docxModulePromise;
}

function sectionTitle(Paragraph, TextRun, title) {
    return new Paragraph({
        spacing: { before: 180, after: 60 },
        children: [new TextRun({ text: `${title}:`, bold: true, underline: {} })]
    });
}

function bodyParagraph(Paragraph, TextRun, text, options = {}) {
    return new Paragraph({
        alignment: options.alignment,
        spacing: { after: options.after ?? 90 },
        children: toMultilineRuns(TextRun, text, {
            bold: !!options.bold,
            italics: !!options.italics
        })
    });
}

function labelValueParagraph(Paragraph, TextRun, label, value, options = {}) {
    return new Paragraph({
        alignment: options.alignment,
        spacing: { after: options.after ?? 90 },
        children: [
            new TextRun({ text: `${label}: `, bold: true }),
            ...toMultilineRuns(TextRun, value)
        ]
    });
}

function separatorParagraph(Paragraph, BorderStyle) {
    return new Paragraph({
        border: {
            bottom: {
                color: '000000',
                space: 1,
                size: 6,
                style: BorderStyle.SINGLE
            }
        },
        spacing: { before: 140, after: 120 }
    });
}

async function buildSignatureBlock(docx, signatureContext) {
    const {
        Paragraph,
        TextRun,
        AlignmentType,
        ImageRun
    } = docx;

    const buildSignatureCaption = (signer, subtitle) => {
        const signerName = signer?.name || 'Responsável';
        const signerCrmv = signer?.crmv ? ` / ${signer.crmv}` : '';
        return `${signerName}\n${subtitle}${signerCrmv}`;
    };

    const buildSignatureCard = async (signer, subtitle) => {
        const paragraphs = [];
        const caption = buildSignatureCaption(signer, subtitle);
        let renderedSignatureImage = false;
        const signatureWidth = 220;

        if (signer?.base64) {
            let signatureDataUrl = signer.base64;
            const composedSignature = await composeSignatureImageWithGuideLine(
                signatureDataUrl,
                signer?.signatureGuideRatio
            );
            let dimensions = await getDataUrlImageDimensions(signatureDataUrl);

            if (composedSignature?.dataUrl) {
                signatureDataUrl = composedSignature.dataUrl;
                dimensions = {
                    width: composedSignature.width,
                    height: composedSignature.height
                };
            }

            const imageBytes = base64ToUint8Array(signatureDataUrl);
            if (imageBytes) {
                const ratio = dimensions ? (dimensions.height / dimensions.width) : 0.333;
                const estimatedHeight = Math.round(signatureWidth * ratio);
                const height = Math.max(70, Math.min(estimatedHeight, 135));

                paragraphs.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 120, after: 12 },
                    children: [
                        new ImageRun({
                            data: imageBytes,
                            transformation: { width: signatureWidth, height }
                        })
                    ]
                }));

                renderedSignatureImage = true;
            }
        }

        if (!renderedSignatureImage) {
            paragraphs.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 240, after: 20 },
                children: [new TextRun({ text: ' ' })]
            }));

            paragraphs.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 12 },
                children: [new TextRun({ text: '__________________________________' })]
            }));
        }

        paragraphs.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: toMultilineRuns(TextRun, caption)
        }));

        return paragraphs;
    };

    if (!signatureContext) {
        return buildSignatureCard({ name: 'Responsável', crmv: '' }, 'Patologista');
    }

    const { mode, primary, teacher } = signatureContext;

    if (mode === 'postgrad-self-sign') {
        const teacherName = teacher?.name || 'Docente Supervisor';
        const teacherRole = teacher?.crmv ? `Docente Supervisor / ${teacher.crmv}` : 'Docente Supervisor';

        return [
            ...(await buildSignatureCard(primary, 'Pós-Graduando(a)')),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: teacherName })]
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: teacherRole })]
            })
        ];
    }

    return buildSignatureCard(primary, 'Patologista');
}

export function buildWordFileName(task, reportData = {}) {
    const protocol = sanitizeFilePart(pickFilledValue(reportData?.protocolo, task?.protocolo, task?.accessCode), 'laudo');
    const animal = sanitizeFilePart(pickFilledValue(reportData?.animalNome, task?.animalNome), 'animal');
    return `Laudo_${protocol}_${animal}.docx`;
}

export async function generateWordBlob(task, reportData = {}) {
    const docx = await loadDocxModule();
    const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        AlignmentType,
        BorderStyle,
        ImageRun,
        Table,
        TableRow,
        TableCell,
        WidthType,
        VerticalAlign
    } = docx;

    const values = resolveWordValues(task, reportData);
    const signatureContext = await resolveSignatureForWord(task);

    const ufsmLogoPath = '../assets/images/Logo-UFSM.png';
    const lpvLogoPath = '../assets/images/LPV.png';

    const [ufsmLogo, lpvLogo, ufsmLogoDimensions, lpvLogoDimensions, signatureParagraphs] = await Promise.all([
        getImageAsUint8Array(ufsmLogoPath),
        getImageAsUint8Array(lpvLogoPath),
        getImageDimensionsFromUrl(ufsmLogoPath),
        getImageDimensionsFromUrl(lpvLogoPath),
        buildSignatureBlock(docx, signatureContext)
    ]);

    const headerNoBorders = {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    };

    const buildCellParagraph = (text, options = {}) => {
        const runOptions = { text };
        if (options.bold) runOptions.bold = true;
        if (Number.isFinite(options.size)) runOptions.size = options.size;

        return new Paragraph({
            alignment: options.alignment || AlignmentType.LEFT,
            spacing: { after: options.after ?? 20 },
            children: [new TextRun(runOptions)]
        });
    };

    const buildTableCell = (config = {}) => {
        const children = config.children || [buildCellParagraph(config.text || '', {
            alignment: config.alignment,
            bold: config.bold,
            size: config.size,
            after: config.after
        })];

        const baseCell = {
            children,
            verticalAlign: VerticalAlign.CENTER,
            borders: headerNoBorders,
            margins: config.margins || { top: 80, bottom: 80, left: 90, right: 90 }
        };

        if (config.width) {
            baseCell.width = { size: config.width, type: WidthType.PERCENTAGE };
        }

        if (config.shadingFill) {
            baseCell.shading = { fill: config.shadingFill, color: 'auto' };
        }

        return new TableCell(baseCell);
    };

    const ufsmTransform = fitImageTransform(ufsmLogoDimensions, 92, 120);
    const lpvTransform = fitImageTransform(lpvLogoDimensions, 120, 120);

    const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [2000, 6000, 2000],
        rows: [
            new TableRow({
                children: [
                    buildTableCell({
                        alignment: AlignmentType.CENTER,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: ufsmLogo
                                    ? [new ImageRun({ data: ufsmLogo, transformation: ufsmTransform })]
                                    : [new TextRun({ text: ' ' })]
                            })
                        ]
                    }),
                    buildTableCell({
                        alignment: AlignmentType.CENTER,
                        children: [
                            buildCellParagraph('UNIVERSIDADE FEDERAL DE SANTA MARIA', { alignment: AlignmentType.CENTER, bold: true, size: 28, after: 10 }),
                            buildCellParagraph('DEPARTAMENTO DE PATOLOGIA', { alignment: AlignmentType.CENTER, bold: true, size: 24, after: 10 }),
                            buildCellParagraph('Laboratório de Patologia Veterinária', { alignment: AlignmentType.CENTER, size: 22, after: 10 }),
                            buildCellParagraph('Prédio 97B, 97105-900 Santa Maria, RS, Brasil', { alignment: AlignmentType.CENTER, size: 20, after: 10 }),
                            buildCellParagraph('lpv@ufsm.br | 55 3220-8168', { alignment: AlignmentType.CENTER, size: 20, after: 0 })
                        ]
                    }),
                    buildTableCell({
                        alignment: AlignmentType.CENTER,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: lpvLogo
                                    ? [new ImageRun({ data: lpvLogo, transformation: lpvTransform })]
                                    : [new TextRun({ text: ' ' })]
                            })
                        ]
                    })
                ]
            })
        ]
    });

    const dataSectionFill = 'D9D9D9';
    const buildSectionHeaderRow = (title) => new TableRow({
        children: [
            buildTableCell({
                text: title,
                alignment: AlignmentType.CENTER,
                bold: true,
                size: 22,
                shadingFill: dataSectionFill,
                margins: { top: 60, bottom: 60, left: 80, right: 80 }
            }),
            buildTableCell({
                text: '',
                shadingFill: dataSectionFill,
                margins: { top: 60, bottom: 60, left: 80, right: 80 }
            }),
            buildTableCell({
                text: '',
                shadingFill: dataSectionFill,
                margins: { top: 60, bottom: 60, left: 80, right: 80 }
            }),
            buildTableCell({
                text: '',
                shadingFill: dataSectionFill,
                margins: { top: 60, bottom: 60, left: 80, right: 80 }
            })
        ]
    });

    const buildFourColumnRow = (label1, value1, label2, value2) => new TableRow({
        children: [
            buildTableCell({ text: label1, bold: true, size: 22 }),
            buildTableCell({ text: value1, size: 22 }),
            buildTableCell({ text: label2, bold: true, size: 22 }),
            buildTableCell({ text: value2, size: 22 })
        ]
    });

    const buildWideValueRow = (label, value) => new TableRow({
        children: [
            buildTableCell({ text: label, bold: true, size: 22 }),
            buildTableCell({ text: value, size: 22 }),
            buildTableCell({ text: '', size: 22 }),
            buildTableCell({ text: '', size: 22 })
        ]
    });

    const entityDataTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1500, 3500, 1500, 3500],
        rows: [
            buildSectionHeaderRow('DADOS DO ANIMAL'),
            buildFourColumnRow('Nome / RG:', `${values.animalNome} / ${values.animalRg}`, 'Espécie:', values.especie),
            buildWideValueRow('Raça:', values.raca),
            buildWideValueRow('Sexo/Idade:', `${values.sexo} / ${values.idade}`),

            buildSectionHeaderRow('REQUISITANTE'),
            buildFourColumnRow('Requisitante:', values.requisitante, 'Contato:', values.contatoReq),
            buildFourColumnRow('Email:', values.emailReq, 'Clínica/Empresa:', values.clinicaReq),
            buildWideValueRow('Endereço:', values.enderecoReq),

            buildSectionHeaderRow('PROPRIETÁRIO'),
            buildFourColumnRow('Proprietário:', values.proprietario, 'Contato:', values.contatoProp),
            buildWideValueRow('Endereço:', values.enderecoProp)
        ]
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                headerTable,
                new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: '' })] }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 120 },
                    children: [new TextRun({ text: `LAUDO HISTOPATOLÓGICO (${values.protocolo})`, bold: true, underline: {} })]
                }),
                labelValueParagraph(Paragraph, TextRun, 'Data de recebimento', values.dataRecebimento, { after: 160 }),

                entityDataTable,

                separatorParagraph(Paragraph, BorderStyle),
                sectionTitle(Paragraph, TextRun, 'MATERIAL REMETIDO'),
                ...values.materialDetails.map((item, index) => labelValueParagraph(Paragraph, TextRun, item.label, item.value, {
                    after: index === values.materialDetails.length - 1 ? 140 : 90
                })),

                separatorParagraph(Paragraph, BorderStyle),
                sectionTitle(Paragraph, TextRun, 'HISTÓRICO CLÍNICO'),
                bodyParagraph(Paragraph, TextRun, values.historico, { alignment: AlignmentType.JUSTIFIED }),
                sectionTitle(Paragraph, TextRun, 'DIAGNÓSTICO PRESUNTIVO/SUSPEITA'),
                bodyParagraph(Paragraph, TextRun, values.suspeita, { alignment: AlignmentType.JUSTIFIED }),
                sectionTitle(Paragraph, TextRun, 'DESCRIÇÃO MACROSCÓPICA'),
                bodyParagraph(Paragraph, TextRun, values.macroscopia, { alignment: AlignmentType.JUSTIFIED }),
                sectionTitle(Paragraph, TextRun, 'DESCRIÇÃO MICROSCÓPICA'),
                bodyParagraph(Paragraph, TextRun, values.microscopia, { alignment: AlignmentType.JUSTIFIED }),
                sectionTitle(Paragraph, TextRun, 'DIAGNÓSTICO(S)'),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { after: 90 },
                    children: buildDiagnosisRuns(TextRun, values.diagnostico)
                }),
                sectionTitle(Paragraph, TextRun, 'COMENTÁRIOS'),
                bodyParagraph(Paragraph, TextRun, values.comentarios, { alignment: AlignmentType.JUSTIFIED, after: 120 }),

                new Paragraph({
                    spacing: { before: 180, after: 90 },
                    children: [
                        new TextRun({ text: 'Data de emissão de laudo: ', bold: true }),
                        new TextRun({ text: values.dataEmissao || '____/____/______' })
                    ]
                }),
                separatorParagraph(Paragraph, BorderStyle),
                ...signatureParagraphs
            ]
        }]
    });

    return Packer.toBlob(doc);
}

export async function generateWordBlobAndDownload(task, reportData = {}) {
    const blob = await generateWordBlob(task, reportData);
    const fileName = buildWordFileName(task, reportData);

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    return { blob, fileName };
}
