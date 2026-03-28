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
async function fetchSignature(releasedByUid) {
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
                crmv: data.crmv || null,
                // guideRatio: posição da linha guia no canvas (0–1, fração da altura)
                signatureGuideRatio: data.signatureGuideRatio ?? null
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

function normalizeSignerData(profile, fallbackName, fallbackCrmv = '') {
    return {
        uid: profile?.uid || null,
        name: profile?.name || fallbackName || 'Responsável',
        role: profile?.role || null,
        base64: profile?.signatureBase64 || null,
        crmv: formatCrmv(profile?.crmv, fallbackCrmv),
        // Posição (0–1) da linha guia no canvas original — salva em perfil.html
        signatureGuideRatio: profile?.signatureGuideRatio ?? null,
        // Campos calculados após análise de pixels (enriquecimento abaixo)
        signatureRatio: null,
        signatureInkBottomRatio: null
    };
}

// ─── 4. ANÁLISE DE MÉTRICAS DA IMAGEM ────────────────────────────────────────
/**
 * Retorna:
 *  - ratio             : altura / largura da imagem (proporção)
 *  - inkBottomRatio    : posição relativa (0–1) da última linha com traço de tinta
 *
 * O inkBottomRatio é a chave para o alinhamento preciso:
 * ele indica onde, na imagem exportada, termina o traço da assinatura —
 * portanto onde a linha guia do PDF deve ser posicionada para coincidir
 * com a linha guia que estava no canvas quando a pessoa assinou.
 */
async function getBase64ImageMetrics(base64) {
    if (!base64) return null;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            if (!img.width || !img.height) return resolve(null);

            const ratio = img.height / img.width;

            let inkBottomRatio = null;
            try {
                const offscreen = document.createElement('canvas');
                offscreen.width  = img.width;
                offscreen.height = img.height;
                const ctx = offscreen.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    const { data, width, height } = ctx.getImageData(0, 0, offscreen.width, offscreen.height);

                    // Linha guia tracejada cinza: #94a3b8 ≈ RGB(148, 163, 184)
                    // Excluímos esses pixels para detectar apenas o traço da caneta (escuro).
                    const WHITE_MIN   = 240; // pixels brancos do fundo
                    const ALPHA_MIN   = 20;  // ignora pixels quase transparentes
                    const INK_MAX_L   = 180; // luminância máxima para ser considerado "tinta"

                    let bottomInkRow = -1;

                    for (let y = height - 1; y >= 0; y--) {
                        let hasInk = false;
                        for (let x = 0; x < width; x++) {
                            const idx = (y * width + x) * 4;
                            const r = data[idx];
                            const g = data[idx + 1];
                            const b = data[idx + 2];
                            const a = data[idx + 3];

                            if (a < ALPHA_MIN) continue; // transparente

                            // Exclui pixels brancos (fundo)
                            if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) continue;

                            // Luminância aproximada
                            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                            // Exclui a linha guia cinza (luminância alta, não é tinta escura)
                            if (lum > INK_MAX_L) continue;

                            hasInk = true;
                            break;
                        }
                        if (hasInk) {
                            bottomInkRow = y;
                            break;
                        }
                    }

                    if (bottomInkRow >= 0) {
                        inkBottomRatio = (bottomInkRow + 1) / height;
                    }
                }
            } catch (_) {
                inkBottomRatio = null;
            }

            resolve({ ratio, inkBottomRatio });
        };
        img.onerror = () => resolve(null);
        img.src = base64;
    });
}

async function enrichSignerWithMetrics(signer) {
    if (!signer?.base64) return signer;
    const metrics = await getBase64ImageMetrics(signer.base64);
    return {
        ...signer,
        signatureRatio:         metrics?.ratio         || null,
        signatureInkBottomRatio: metrics?.inkBottomRatio || null
    };
}

// ─── 5. RESOLUÇÃO DE QUEM ASSINA O LAUDO ─────────────────────────────────────
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
    const posData     = normalizeSignerData(posProfile, nomePosGrad);

    const canSelfSign         = hasPostGradRole(posData.role) && !!posProfile?.canSelfSignReports;
    const hasPostGradSignature = !!posData.base64;

    if (canSelfSign && hasPostGradSignature) {
        const enrichedPost = await enrichSignerWithMetrics(posData);
        return {
            mode: 'postgrad-self-sign',
            primary: enrichedPost,
            teacher: docenteData
        };
    }

    // Fallback: assinatura da docente responsável
    let signatureData = docenteData;
    if (!signatureData.base64) {
        const releasedSig = await fetchSignature(task.releasedBy || null);
        if (releasedSig?.base64 && hasTeacherRole(releasedSig.role)) {
            signatureData = {
                ...signatureData,
                base64: releasedSig.base64,
                name:   releasedSig.name || signatureData.name,
                crmv:   formatCrmv(releasedSig.crmv, signatureData.crmv),
                signatureGuideRatio: releasedSig.signatureGuideRatio ?? signatureData.signatureGuideRatio
            };
        }
    }

    const enrichedTeacher = await enrichSignerWithMetrics(signatureData);

    return {
        mode: 'teacher-default-sign',
        primary: enrichedTeacher,
        teacher: docenteData
    };
}

// ─── 6. BLOCO DE ASSINATURA NO PDF ───────────────────────────────────────────

/**
 * Calcula o offset vertical (em pontos PDF) da linha horizontal do laudo
 * em relação à borda inferior da imagem renderizada.
 *
 * Lógica:
 *   A imagem é renderizada com largura `signatureWidth` no PDF.
 *   A altura renderizada = signatureWidth * ratio.
 *
 *   A linha guia estava em `guideRatio` da altura do canvas (ex: 0.72 = 72%).
 *   Isso significa que ela estava a `(1 - guideRatio)` da borda inferior (28%).
 *
 *   No PDF, posicionamos a linha logo abaixo da imagem usando margin negativo.
 *   Queremos que a linha fique exatamente onde a linha guia do canvas estava.
 *
 *   Para isso, deslocamos a linha `(1 - guideRatio) * renderedHeight` px
 *   para cima a partir da borda inferior da imagem → margem negativa.
 *
 *   Exemplo com guideRatio=0.72, renderedHeight=110px:
 *     distância da base = (1 - 0.72) * 110 = 30.8px → margem negativa de ~31pt
 */
function computeLineMarginTop(signer, signatureWidth) {
    const guideRatio    = signer?.signatureGuideRatio ?? 0.72;   // padrão conservador
    const ratio         = signer?.signatureRatio       ?? 0.333;  // H/W padrão
    const renderedHeight = signatureWidth * ratio;

    // Distância da linha guia até a borda inferior da imagem
    const distFromBottom = (1 - guideRatio) * renderedHeight;

    // Margem negativa para subir a linha até esse ponto
    // +2 ajuste visual fino para centralizar sobre o traço
    return -(distFromBottom - 2);
}

function buildSeparatorLine(marginTop = 0, visible = true) {
    const lineWidth = 220;
    if (!visible) {
        // Mantém a mesma geometria vertical sem desenhar a linha no PDF.
        return {
            text: '',
            alignment: 'center',
            margin: [0, marginTop, 0, 4]
        };
    }

    return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: lineWidth, y2: 0, lineWidth: 1, lineColor: '#000000' }],
        alignment: 'center',
        margin: [0, marginTop, 0, 4]
    };
}

/**
 * Constrói o card de assinatura para o PDF.
 *
 * Se há imagem:
 *   1. Renderiza a imagem com a largura padrão.
 *   2. Calcula margem negativa para que a linha do PDF coincida com
 *      a linha guia original do canvas.
 *   3. Renderiza a linha com essa margem.
 *   4. Exibe nome e cargo abaixo da linha.
 *
 * Se não há imagem: fallback com espaço em branco + linha + nome.
 */
function buildSignatureCard(signer, subtitle) {
    const signatureWidth = 220;

    const signerName = signer?.name || 'Responsável';
    const signerCrmv = signer?.crmv ? ` / ${signer.crmv}` : '';
    const caption    = `${signerName}\n${subtitle}${signerCrmv}`;

    if (signer?.base64) {
        const lineMarginTop = computeLineMarginTop(signer, signatureWidth);

        return {
            stack: [
                {
                    image: signer.base64,
                    width: signatureWidth,
                    alignment: 'center',
                    margin: [0, 0, 0, 0]
                },
                // Renderiza a linha no mesmo ponto da guia do canvas.
                buildSeparatorLine(lineMarginTop, true),
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
            margin: [0, 15, 0, 0],
            unbreakable: true
        };
    }

    // Fallback sem imagem
    return {
        stack: [
            { text: '\n\n' },
            buildSeparatorLine(0),
            {
                text: caption,
                alignment: 'center',
                fontSize: 11,
                lineHeight: 1.4
            }
        ],
        alignment: 'center',
        margin: [0, 15, 0, 0],
        unbreakable: true
    };
}

function buildTeacherTextOnlyCard(teacher) {
    const teacherName = teacher?.name || 'Docente responsável';
    const teacherCrmv = teacher?.crmv || '';
    const roleLine    = teacherCrmv ? `Docente Responsável / ${teacherCrmv}` : 'Docente Responsável';
    const text        = `${teacherName}\n${roleLine}`;

    return {
        text,
        alignment: 'center',
        fontSize: 11,
        lineHeight: 1.4,
        margin: [0, 6, 0, 0],
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

// ─── 7. FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────
export async function generateLaudoPDF(task, reportData) {
    await loadPdfMake();

    const signatureContext = await resolveSignatureForPdf(task);

    const [base64UFSM, base64LPV] = await Promise.all([
        getImageAsBase64('../assets/images/Logo-UFSM.png'),
        getImageAsBase64('../assets/images/LPV.png')
    ]);

    // ── PREPARAÇÃO DOS DADOS ──────────────────────────────────────
    const protocolo   = task.protocolo || task.accessCode || '---';
    const dataReceb   = task.dataEntrada
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR')
        : new Date(task.createdAt).toLocaleDateString('pt-BR');

    const dataEmissao = task.releasedAt
        ? new Date(task.releasedAt).toLocaleDateString('pt-BR')
        : new Date().toLocaleDateString('pt-BR');

    const contatoReq  = task.remetenteContato       || reportData.telefone_requisitante || '-';
    const clinicaReq  = task.remetenteClinicaEmpresa || reportData.clinica_requisitante  || '-';
    const enderecoReq = task.remetenteEndereco       || reportData.endereco_requisitante  || '-';
    const contatoProp = task.proprietarioContato     || reportData.telefone_proprietario  || '-';
    const enderecoProp= task.proprietarioEndereco    || reportData.endereco_proprietario  || '-';
    const sexoAnimal  = formatAnimalSexLabel(task.sexo || reportData.sexo);
    const racaAnimal  = formatAnimalBreedLabel(task.raca || reportData.raca);

    const chk    = (val) => val ? '[ X ]' : '[   ]';
    const isBio  = reportData.tipo_material_radio
        ? reportData.tipo_material_radio === 'biopsia'
        : task.type === 'biopsia';
    const isNecro= reportData.tipo_material_radio
        ? reportData.tipo_material_radio === 'necropsia'
        : task.type === 'necropsia';

    const materialDetails = [
        { text: [{ text: 'Material Remetido: ', bold: true }, `Biópsia ${chk(isBio)}    Necropsia ${chk(isNecro)}`] },
        { text: [{ text: 'Tipo de Material: ',  bold: true }, reportData.tipo_material_desc || '-'] },
        ...(isNecro
            ? [
                { text: [{ text: 'Data e hora da morte: ', bold: true }, (reportData.tempo_morte || '-') + ' horas'] },
                { text: [{ text: 'Morte: ', bold: true }, `Morte Espontânea ${chk(reportData.morte_tipo === 'espontanea')}    Eutanásia ${chk(reportData.morte_tipo === 'eutanasia')}`] }
            ]
            : []),
        { text: [{ text: 'Conservação: ', bold: true }, `Formol ${chk(!reportData.conservacao || reportData.conservacao === 'formol')}   Refrig. ${chk(reportData.conservacao === 'refrigerado')}   Cong. ${chk(reportData.conservacao === 'congelado')}`] }
    ];

    const assinaturaBlock = buildSignatureBlock(signatureContext);

    const createSection = (title, content, boldBody = false) => [
        { text: title + ':', style: 'sectionHeader', margin: [0, 10, 0, 2] },
        { text: content || '-', style: boldBody ? 'bodyBold' : 'body', margin: [0, 0, 0, 5] }
    ];

    const createDiagnosisSection = (content) => {
        const rawContent = (content || '').toString().trim();
        const margin = [0, 0, 0, 5];

        if (!rawContent) {
            return [
                { text: 'DIAGNÓSTICO(S):', style: 'sectionHeader', margin: [0, 10, 0, 2] },
                { text: '-', style: 'bodyDiagnosis', margin }
            ];
        }

        const firstCommaIndex = rawContent.indexOf(',');
        if (firstCommaIndex === -1) {
            return [
                { text: 'DIAGNÓSTICO(S):', style: 'sectionHeader', margin: [0, 10, 0, 2] },
                {
                    text: [{ text: rawContent, decoration: 'underline' }],
                    style: 'bodyDiagnosis',
                    margin
                }
            ];
        }

        const beforeComma = rawContent.slice(0, firstCommaIndex).trimEnd();
        const afterComma  = rawContent.slice(firstCommaIndex);

        return [
            { text: 'DIAGNÓSTICO(S):', style: 'sectionHeader', margin: [0, 10, 0, 2] },
            {
                text: [
                    { text: beforeComma, decoration: 'underline' },
                    { text: afterComma }
                ],
                style: 'bodyDiagnosis',
                margin
            }
        ];
    };

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
            { text: [{ text: 'Data de recebimento: ', bold: true }, dataReceb], fontSize: 11, margin: [0, 15, 0, 15] },

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
                            { text: racaAnimal, style: 'value', colSpan: 3 },
                            {}, {}
                        ],
                        [
                            { text: 'Sexo/Idade:', style: 'label' },
                            { text: `${sexoAnimal} / ${task.idade || '-'}`, style: 'value', colSpan: 3 },
                            {}, {}
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

            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }], margin: [0, 15, 0, 0] },
            { text: 'MATERIAL REMETIDO:', style: 'sectionHeader', margin: [0, 10, 0, 2] },
            {
                margin: [0, 0, 0, 15],
                stack: materialDetails,
                fontSize: 11
            },

            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }] },

            // CONTEÚDO DO LAUDO
            ...createSection('HISTÓRICO CLÍNICO',               reportData.historico),
            ...createSection('DIAGNÓSTICO PRESUNTIVO/SUSPEITA', reportData.suspeita),
            ...createSection('DESCRIÇÃO MACROSCÓPICA',          reportData.macroscopia),
            ...createSection('DESCRIÇÃO MICROSCÓPICA',          reportData.microscopia),
            ...createDiagnosisSection(reportData.diagnostico),
            ...createSection('COMENTÁRIOS',                     reportData.comentarios),

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
            bodyDiagnosis:   { fontSize: 11, alignment: 'justify', bold: true, italics: true, lineHeight: 1.3 },
            label:           { fontSize: 11, bold: true },
            value:           { fontSize: 11 },
            tableHeaderGray: { fillColor: '#E6E6E6', bold: true, alignment: 'center', fontSize: 10, margin: [0, 2, 0, 2] }
        },
        defaultStyle: { font: 'Roboto' }
    };

    const nomeLimpo = (task.animalNome || 'animal').replace(/[^a-z0-9]/gi, '_');
    pdfMake.createPdf(docDefinition).download(`Laudo_${protocolo}_${nomeLimpo}.pdf`);
}