/* --- assets/js/components/docx-generator.js --- */

import { db, auth } from '../core.js';
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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

// ─── 1. CARREGA PDFMAKE ──────────────────────────────────────────────────────
async function loadPdfMake() {
    if (window.pdfMake) return window.pdfMake;
    
    const loadScript = (src) => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src     = src;
        script.onload  = resolve;
        script.onerror = () => reject(new Error(`Erro ao carregar ${src}`));
        document.head.appendChild(script);
    });

    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.9/pdfmake.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.9/vfs_fonts.js');
    return window.pdfMake;
}

// ─── 2. IMAGEM → BASE64 ──────────────────────────────────────────────────────
async function getImageAsBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror   = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn(`Imagem não carregada (${url}):`, error);
        return null;
    }
}

// ─── 3. BUSCA ASSINATURA DO USUÁRIO NO FIRESTORE ─────────────────────────────
/**
 * Retorna o Base64 da assinatura do usuário que está liberando o laudo.
 * Tenta primeiro pelo uid do releasedBy (quem liberou), depois pelo usuário atual.
 * Retorna null se nenhuma assinatura for encontrada — o PDF cai no fallback textual.
 */
async function fetchSignature(releasedByUid) {
    // Tenta uid de quem liberou o laudo
    const uidToTry = releasedByUid || (auth.currentUser ? auth.currentUser.uid : null);
    if (!uidToTry) return null;

    try {
        const userSnap = await getDoc(doc(db, 'users', uidToTry));
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.signatureBase64) return { 
                base64: data.signatureBase64, 
                name: data.name || null,
                role: data.role || null,
                crmv: data.crmv || null
            };
        }
    } catch (err) {
        console.warn('Não foi possível buscar assinatura:', err);
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
    } catch (err) {
        console.warn('Nao foi possivel buscar perfil do usuario:', err);
    }
    return null;
}

function formatCrmv(crmv, fallback = '') {
    const value = (crmv || fallback || '').toString().trim();
    if (!value) return '';
    return /^crmv/i.test(value) ? value.toUpperCase() : `CRMV ${value}`;
}

function normalizeSignerData(profile, fallbackName, fallbackCrmv = '') {
    return {
        uid: profile?.uid || null,
        name: profile?.name || fallbackName || 'Responsável',
        role: profile?.role || null,
        base64: profile?.signatureBase64 || null,
        crmv: formatCrmv(profile?.crmv, fallbackCrmv),
        signatureRatio: null
    };
}

async function getBase64ImageRatio(base64) {
    if (!base64) return null;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            if (!img.width) return resolve(null);
            resolve(img.height / img.width);
        };
        img.onerror = () => resolve(null);
        img.src = base64;
    });
}

async function enrichSignerWithMetrics(signer) {
    if (!signer?.base64) return signer;
    const ratio = await getBase64ImageRatio(signer.base64);
    return { ...signer, signatureRatio: ratio };
}

async function resolveSignatureForPdf(task) {
    const nomeDocente = task.docente || 'Dra. Mariana Martins Flores';
    const nomePosGrad = task.posGraduando || null;
    const posResponsavelUid = (task.posResponsavelUid || '').toString().trim();

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
        const enrichedPost = await enrichSignerWithMetrics(posData);
        return {
            mode: 'postgrad-self-sign',
            primary: enrichedPost,
            teacher: docenteData
        };
    }

    // Fallback de assinatura da docente responsável:
    // tenta perfil da docente e, se não houver imagem, tenta quem liberou.
    let signatureData = docenteData;
    if (!signatureData.base64) {
        const releasedSig = await fetchSignature(task.releasedBy || null);
        if (releasedSig?.base64 && hasTeacherRole(releasedSig.role)) {
            signatureData = {
                ...signatureData,
                base64: releasedSig.base64,
                name: releasedSig.name || signatureData.name,
                crmv: formatCrmv(releasedSig.crmv, signatureData.crmv)
            };
        }
    }

    const enrichedTeacherSignature = await enrichSignerWithMetrics(signatureData);

    return {
        mode: 'teacher-default-sign',
        primary: enrichedTeacherSignature,
        teacher: docenteData
    };
}

// ─── 4. MONTA BLOCO DE ASSINATURA ────────────────────────────────────────────
/**
 * Retorna o bloco pdfMake da área de assinatura.
 * Se houver imagem, exibe a imagem + linha + nome.
 * Se não houver, exibe apenas linha + nome em texto (fallback).
 */
function buildSeparatorLine(marginTop = 0) {
    const lineWidth = 220;
    return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: lineWidth, y2: 0, lineWidth: 0.5, lineColor: '#334155' }],
        alignment: 'center',
        margin: [0, marginTop, 0, 4]
    };
}

function buildSignatureCard(signer, subtitle) {
    const signatureWidth = 220;
    const baselineRatio = 0.72; // Mesmo ratio da linha guia no canvas de assinatura.

    const derivedRatio = signer?.signatureRatio || (200 / 600);
    const renderedHeight = Math.max(55, Math.min(130, Math.round(signatureWidth * derivedRatio)));
    const lineOverlayOffset = -Math.round(renderedHeight * (1 - baselineRatio));

    const separatorLine = buildSeparatorLine(signer?.base64 ? lineOverlayOffset : 0);
    const signerName = signer?.name || 'Responsável';
    const signerCrmv = signer?.crmv ? ` / ${signer.crmv}` : '';
    const caption = `${signerName}\n${subtitle}${signerCrmv}`;

    if (signer?.base64) {
        return {
            stack: [
                {
                    image: signer.base64,
                    width: signatureWidth,
                    alignment: 'center',
                    margin: [0, 0, 0, 2]
                },
                separatorLine,
                {
                    text: caption,
                    alignment: 'center',
                    fontSize: 11,
                    bold: false,
                    lineHeight: 1.4,
                    margin: [0, 2, 0, 0]
                }
            ],
            alignment: 'center',
            margin: [0, 30, 0, 0],
            unbreakable: true
        };
    }

    return {
        stack: [
            { text: '\n\n' },
            separatorLine,
            {
                text: caption,
                alignment: 'center',
                fontSize: 11,
                lineHeight: 1.4
            }
        ],
        alignment: 'center',
        margin: [0, 30, 0, 0],
        unbreakable: true
    };
}

function buildTeacherTextOnlyCard(teacher) {
    const teacherName = teacher?.name || 'Docente responsável';
    const teacherCrmv = teacher?.crmv || '';
    const text = teacherCrmv ? `${teacherName}\n${teacherCrmv}` : teacherName;

    return {
        text,
        alignment: 'center',
        fontSize: 11,
        lineHeight: 1.4,
        margin: [0, 12, 0, 0],
        unbreakable: true
    };
}

function buildSignatureBlock(signatureContext) {
    if (!signatureContext) {
        return buildSignatureCard({ name: 'Responsável', crmv: '' }, 'Patologista');
    }

    const { mode, primary, teacher } = signatureContext;

    if (mode === 'postgrad-self-sign') {
        return {
            stack: [
                buildSignatureCard(primary, 'Pós-Graduando(a)'),
                buildTeacherTextOnlyCard(teacher)
            ],
            alignment: 'center',
            unbreakable: true
        };
    }

    return buildSignatureCard(primary, 'Patologista');
}

// ─── 5. FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────
export async function generateLaudoPDF(task, reportData) {
    await loadPdfMake();

    const signatureContext = await resolveSignatureForPdf(task);

    // Carrega imagens e assinatura em paralelo
    const [base64UFSM, base64LPV] = await Promise.all([
        getImageAsBase64('../assets/images/Logo-UFSM.png'),
        getImageAsBase64('../assets/images/LPV.png')
    ]);

    // ── PREPARAÇÃO DOS DADOS ──────────────────────────────────────
    const protocolo      = task.protocolo || task.accessCode || '---';
    const dataReceb      = task.dataEntrada
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR')
        : new Date(task.createdAt).toLocaleDateString('pt-BR');

    const dataEmissao    = task.releasedAt
        ? new Date(task.releasedAt).toLocaleDateString('pt-BR')
        : new Date().toLocaleDateString('pt-BR');

    const contatoReq     = task.remetenteContato      || reportData.telefone_requisitante || '-';
    const clinicaReq     = task.remetenteClinicaEmpresa|| reportData.clinica_requisitante  || '-';
    const enderecoReq    = task.remetenteEndereco      || reportData.endereco_requisitante  || '-';
    const contatoProp    = task.proprietarioContato    || reportData.telefone_proprietario  || '-';
    const enderecoProp   = task.proprietarioEndereco   || reportData.endereco_proprietario  || '-';

    const chk    = (val) => val ? '[ X ]' : '[   ]';
    const isBio  = reportData.tipo_material_radio
        ? reportData.tipo_material_radio === 'biopsia'
        : task.type === 'biopsia';
    const isNecro= reportData.tipo_material_radio
        ? reportData.tipo_material_radio === 'necropsia'
        : task.type === 'necropsia';

    // Bloco de assinatura condicional (docente default ou autoassinatura do pós)
    const assinaturaBlock = buildSignatureBlock(signatureContext);

    // Seções de texto do laudo
    const createSection = (title, content, boldBody = false) => [
        { text: title + ':', style: 'sectionHeader', margin: [0, 10, 0, 2] },
        { text: content || '-', style: boldBody ? 'bodyBold' : 'body', margin: [0, 0, 0, 5] }
    ];

    // ── DEFINIÇÃO DO DOCUMENTO ────────────────────────────────────
    const docDefinition = {
        pageSize:    'A4',
        pageMargins: [30, 30, 30, 30],

        content: [
            // CABEÇALHO
            {
                table: {
                    widths: ['20%', '60%', '20%'],
                    body: [[
                        { image: base64UFSM || '', width: 90, alignment: 'center' },
                        {
                            stack: [
                                { text: 'UNIVERSIDADE FEDERAL DE SANTA MARIA', bold: true, fontSize: 12 },
                                { text: 'DEPARTAMENTO DE PATOLOGIA',            bold: true, fontSize: 10 },
                                { text: 'Laboratório de Patologia Veterinária',           fontSize: 10 },
                                { text: 'Prédio 97B, 97105-900 Santa Maria, RS, Brasil',  fontSize: 9  },
                                { text: 'lpv@ufsm.br | 55 3220-8168',                     fontSize: 9  }
                            ],
                            alignment: 'center',
                            margin: [0, 10, 0, 0]
                        },
                        { image: base64LPV || '', width: 90, alignment: 'center', margin: [0, 15, 0, 0] }
                    ]]
                },
                layout: 'noBorders'
            },

            // TÍTULO
            { text: `LAUDO HISTOPATOLÓGICO (${protocolo})`, style: 'mainTitle', margin: [0, 20, 0, 5] },
            { text: [{ text: 'Data de recebimento: ', bold: true }, dataReceb], fontSize: 11, margin: [0, 0, 0, 15] },

            // TABELA DE DADOS
            {
                style: 'tableExample',
                table: {
                    widths: ['15%', '35%', '15%', '35%'],
                    body: [
                        [{ text: 'DADOS DO ANIMAL',     style: 'tableHeaderGray', colSpan: 4, border: [false,false,false,false] }, {}, {}, {}],
                        [
                            { text: 'Nome / RG:', style: 'label' },
                            { text: `${task.animalNome || '-'} / ${task.animalRg || '-'}`, style: 'value' },
                            { text: 'Espécie:', style: 'label' },
                            { text: task.especie || '-', style: 'value' }
                        ],
                        [
                            { text: 'Raça:', style: 'label' },
                            { text: task.raca || 'SRD', style: 'value' },
                            { text: 'Sexo/Idade:', style: 'label' },
                            { text: `${task.sexo || '-'} / ${task.idade || '-'}`, style: 'value' }
                        ],

                        [{ text: 'REQUISITANTE', style: 'tableHeaderGray', colSpan: 4, border: [false,false,false,false] }, {}, {}, {}],
                        [
                            { text: 'Requisitante:', style: 'label' },
                            { text: task.remetente || '-', style: 'value' },
                            { text: 'Contato:', style: 'label' },
                            { text: contatoReq, style: 'value' }
                        ],
                        [
                            { text: 'Email:', style: 'label' },
                            { text: reportData.email_requisitante || '-', style: 'value' },
                            { text: 'Clínica/Empresa:', style: 'label' },
                            { text: clinicaReq, style: 'value' }
                        ],
                        [
                            { text: 'Endereço:', style: 'label' },
                            { text: enderecoReq, style: 'value', colSpan: 3 }, {}, {}
                        ],

                        [{ text: 'PROPRIETÁRIO', style: 'tableHeaderGray', colSpan: 4, border: [false,false,false,false] }, {}, {}, {}],
                        [
                            { text: 'Proprietário:', style: 'label' },
                            { text: task.proprietario || '-', style: 'value' },
                            { text: 'Contato:', style: 'label' },
                            { text: contatoProp, style: 'value' }
                        ],
                        [
                            { text: 'Endereço:', style: 'label' },
                            { text: enderecoProp, style: 'value', colSpan: 3 }, {}, {}
                        ]
                    ]
                },
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: () => 0,
                    paddingLeft:   () => 4,
                    paddingRight:  () => 4,
                    paddingTop:    () => 2,
                    paddingBottom: () => 2
                }
            },

            // MATERIAL
            {
                margin: [0, 15, 0, 15],
                stack: [
                    { text: [{ text: 'Material Remetido: ', bold: true }, `Biópsia ${chk(isBio)}    Necropsia ${chk(isNecro)}`] },
                    { text: [{ text: 'Tipo de Material: ',  bold: true }, reportData.tipo_material_desc || '-'] },
                    { text: [{ text: 'Data e hora da morte: ', bold: true }, (reportData.tempo_morte || '-') + ' horas'] },
                    { text: [{ text: 'Morte: ', bold: true }, `Morte Espontânea ${chk(reportData.morte_tipo === 'espontanea')}    Eutanásia ${chk(reportData.morte_tipo === 'eutanasia')}`] },
                    { text: [{ text: 'Conservação: ', bold: true }, `Formol ${chk(!reportData.conservacao || reportData.conservacao === 'formol')}   Refrig. ${chk(reportData.conservacao === 'refrigerado')}   Cong. ${chk(reportData.conservacao === 'congelado')}`] }
                ],
                fontSize: 11
            },

            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }] },

            // CONTEÚDO DO LAUDO
            ...createSection('HISTÓRICO CLÍNICO',                 reportData.historico),
            ...createSection('DIAGNÓSTICO PRESUNTIVO/SUSPEITA',   reportData.suspeita),
            ...createSection('DESCRIÇÃO MACROSCÓPICA',            reportData.macroscopia),
            ...createSection('DESCRIÇÃO MICROSCÓPICA',            reportData.microscopia),
            ...createSection('DIAGNÓSTICO(S)',                    reportData.diagnostico, true),
            ...createSection('COMENTÁRIOS',                       reportData.comentarios),

            // DATA + ASSINATURA
            { text: [{ text: 'Data de emissão de laudo: ', bold: true }, dataEmissao], margin: [0, 20, 0, 10], fontSize: 11 },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }] },
            assinaturaBlock
        ],

        styles: {
            mainTitle:       { fontSize: 14, bold: true, decoration: 'underline', alignment: 'center' },
            sectionHeader:   { fontSize: 11, bold: true, decoration: 'underline' },
            body:            { fontSize: 11, alignment: 'justify', lineHeight: 1.3 },
            bodyBold:        { fontSize: 11, alignment: 'justify', bold: true, lineHeight: 1.3 },
            label:           { fontSize: 11, bold: true },
            value:           { fontSize: 11 },
            tableHeaderGray: { fillColor: '#E6E6E6', bold: true, alignment: 'center', fontSize: 10, margin: [0, 2, 0, 2] }
        },
        defaultStyle: { font: 'Roboto' }
    };

    const nomeLimpo = (task.animalNome || 'animal').replace(/[^a-z0-9]/gi, '_');
    pdfMake.createPdf(docDefinition).download(`Laudo_${protocolo}_${nomeLimpo}.pdf`);
}