/* --- assets/js/components/docx-generator.js --- */

import { db, auth } from '../core.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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
                role: data.role || null
            };
        }
    } catch (err) {
        console.warn('Não foi possível buscar assinatura:', err);
    }

    return null;
}

// ─── 4. MONTA BLOCO DE ASSINATURA ────────────────────────────────────────────
/**
 * Retorna o bloco pdfMake da área de assinatura.
 * Se houver imagem, exibe a imagem + linha + nome.
 * Se não houver, exibe apenas linha + nome em texto (fallback).
 */
function buildSignatureBlock(sigData, nomeDocente, isPos) {
    const nomeExibir  = sigData?.name  || nomeDocente || 'Responsável';
    const roleData    = sigData?.role;
    const roles       = Array.isArray(roleData)
        ? roleData.map(r => r.toLowerCase())
        : [(roleData || '').toLowerCase()];

    const isPosGrad   = roles.some(r => r.includes('graduando'));
    const isProfessor = roles.some(r => r === 'professor');

    // Linha que aparece abaixo da assinatura
    const cargoTexto  = isProfessor
        ? `${nomeExibir}\nPatologista / CRMV 14.636`
        : isPosGrad
            ? `${nomeExibir}\nPós-Graduando(a) / LPV`
            : `${nomeExibir}`;

    const separatorLine = {
        canvas: [{ type: 'line', x1: 100, y1: 0, x2: 300, y2: 0, lineWidth: 0.5, lineColor: '#334155' }],
        margin: [0, 0, 0, 4]
    };

    if (sigData?.base64) {
        // ── COM IMAGEM ──────────────────────────────────────────
        return {
            stack: [
                {
                    image: sigData.base64,
                    width: 160,
                    alignment: 'center',
                    margin: [0, 0, 0, 4]
                },
                separatorLine,
                {
                    text: cargoTexto,
                    alignment: 'center',
                    fontSize: 11,
                    bold: false,
                    lineHeight: 1.4
                }
            ],
            alignment: 'center',
            margin: [0, 30, 0, 0],
            unbreakable: true
        };
    }

    // ── SEM IMAGEM (fallback) ────────────────────────────────────
    return {
        stack: [
            { text: '\n\n' }, // espaço para assinar à mão
            separatorLine,
            {
                text: cargoTexto,
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

// ─── 5. FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────
export async function generateLaudoPDF(task, reportData) {
    await loadPdfMake();

    // Carrega imagens e assinatura em paralelo
    const [base64UFSM, base64LPV, sigData] = await Promise.all([
        getImageAsBase64('../assets/images/Logo-UFSM.png'),
        getImageAsBase64('../assets/images/LPV.png'),
        fetchSignature(task.releasedBy || null)
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

    const nomeDocente = task.docente || 'Dra. Mariana Martins Flores';

    // Bloco de assinatura (usa imagem se disponível)
    const assinaturaBlock = buildSignatureBlock(sigData, nomeDocente, false);

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