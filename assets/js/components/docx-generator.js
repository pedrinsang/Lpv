/* --- assets/js/components/docx-generator.js --- */

// 1. Carrega as bibliotecas do PDFMake
async function loadPdfMake() {
    if (window.pdfMake) return window.pdfMake;
    
    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Erro ao carregar ${src}`));
            document.head.appendChild(script);
        });
    };

    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.9/pdfmake.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.9/vfs_fonts.js');
    return window.pdfMake;
}

// 2. Converte Imagem para Base64
async function getImageAsBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn(`Imagem não carregada (${url}):`, error);
        return null; 
    }
}

// 3. FUNÇÃO PRINCIPAL: Gera o PDF
export async function generateLaudoPDF(task, reportData) {
    await loadPdfMake();

    // --- CARREGAMENTO DE IMAGENS ---
    const urlUFSM = "../assets/images/Logo-UFSM.png";
    const urlLPV = "../assets/images/LPV.png";
    
    const [base64UFSM, base64LPV] = await Promise.all([
        getImageAsBase64(urlUFSM),
        getImageAsBase64(urlLPV)
    ]);

    // --- PREPARAÇÃO DOS DADOS ---
    const protocolo = task.protocolo || task.accessCode || "---";
    const dataReceb = task.dataEntrada 
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR') 
        : new Date(task.createdAt).toLocaleDateString('pt-BR');

    const dataEmissaoTexto = task.releasedAt 
        ? new Date(task.releasedAt).toLocaleDateString('pt-BR') 
        : new Date().toLocaleDateString('pt-BR');

    const chk = (val) => val ? "[ X ]" : "[   ]";
    const isBio = reportData.tipo_material_radio ? reportData.tipo_material_radio === 'biopsia' : task.type === 'biopsia';
    const isNecro = reportData.tipo_material_radio ? reportData.tipo_material_radio === 'necropsia' : task.type === 'necropsia';

    // Nomes para assinatura
    const nomeDocente = task.docente || "Dra. Mariana Martins Flores";
    const nomePos = task.posGraduando || "Pós-Graduando";

    // --- LÓGICA DE ASSINATURA ---
    // Defina isPosRelease como true quando implementar a feature de liberação por pós
    const isPosRelease = false; 

    let assinaturaBlock;

    if (isPosRelease) {
        // Cenario Futuro: Pós assina com supervisão
        assinaturaBlock = {
            stack: [
                { text: nomePos, bold: true, fontSize: 12 },
                { text: 'Pós-Graduando(a) / LPV', fontSize: 11, margin: [0, 0, 0, 2] },
                { text: `Supervisão: ${nomeDocente}/ CRMV 14.636`, fontSize: 10, italics: true }
            ],
            alignment: 'center',
            margin: [0, 40, 0, 0],
            unbreakable: true
        };
    } else {
        // Cenario Atual: Apenas Docente assina
        assinaturaBlock = {
            stack: [
                { text: nomeDocente, bold: true, fontSize: 12 },
                { text: 'Patologista / CRMV 14.636', fontSize: 11 }
            ],
            alignment: 'center',
            margin: [0, 40, 0, 0],
            unbreakable: true
        };
    }


    // Função auxiliar para seções
    const createSection = (title, content, boldBody = false) => {
        const bodyText = content || "-";
        return [
            { text: title + ":", style: 'sectionHeader', margin: [0, 10, 0, 2] },
            { text: bodyText, style: boldBody ? 'bodyBold' : 'body', margin: [0, 0, 0, 5] }
        ];
    };

    // --- DEFINIÇÃO DO DOCUMENTO ---
    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [30, 30, 30, 30], // Margens padrão (~1cm)

        content: [
            // 1. CABEÇALHO
            {
                table: {
                    widths: ['20%', '60%', '20%'],
                    body: [
                        [
                            { image: base64UFSM || '', width: 90, alignment: 'center' },
                            {
                                stack: [
                                    { text: 'UNIVERSIDADE FEDERAL DE SANTA MARIA', bold: true, fontSize: 12 },
                                    { text: 'DEPARTAMENTO DE PATOLOGIA', bold: true, fontSize: 10 },
                                    { text: 'Laboratório de Patologia Veterinária', fontSize: 10 },
                                    { text: 'Prédio 97B, 97105-900 Santa Maria, RS, Brasil', fontSize: 9 },
                                    { text: 'lpv@ufsm.br | 55 3220-8168', fontSize: 9 }
                                ],
                                alignment: 'center',
                                margin: [0, 10, 0, 0]
                            },
                            { image: base64LPV || '', width: 90, alignment: 'center', margin: [0, 15, 0, 0] }
                        ]
                    ]
                },
                layout: 'noBorders'
            },

            // 2. TÍTULO
            { text: `LAUDO HISTOPATOLÓGICO (${protocolo})`, style: 'mainTitle', margin: [0, 20, 0, 5] },
            { text: [{ text: 'Data de recebimento: ', bold: true }, dataReceb], fontSize: 11, margin: [0, 0, 0, 15] },

            // 3. TABELA DE DADOS
            {
                style: 'tableExample',
                table: {
                    widths: ['15%', '35%', '15%', '35%'],
                    body: [
                        [{ text: 'DADOS DO ANIMAL', style: 'tableHeaderGray', colSpan: 4, border: [false, false, false, false] }, {}, {}, {}],
                        [
                            { text: 'Nome:', style: 'label' }, { text: task.animalNome || "-", style: 'value' },
                            { text: 'Espécie:', style: 'label' }, { text: task.especie || "-", style: 'value' }
                        ],
                        [
                            { text: 'Raça:', style: 'label' }, { text: task.raca || "SRD", style: 'value' },
                            { text: 'Sexo/Idade:', style: 'label' }, { text: `${task.sexo || "-"} / ${task.idade || "-"}`, style: 'value' }
                        ],

                        [{ text: 'REQUISITANTE', style: 'tableHeaderGray', colSpan: 4, border: [false, false, false, false] }, {}, {}, {}],
                        [
                            { text: 'Requisitante:', style: 'label' }, { text: task.remetente || "-", style: 'value' },
                            { text: 'Telefone:', style: 'label' }, { text: reportData.telefone_requisitante || "-", style: 'value' }
                        ],
                        [
                            { text: 'Email:', style: 'label' }, { text: reportData.email_requisitante || "-", style: 'value' },
                            { text: 'Clínica:', style: 'label' }, { text: reportData.clinica_requisitante || "-", style: 'value' }
                        ],
                        [
                            { text: 'Endereço:', style: 'label' }, { text: reportData.endereco_requisitante || "-", style: 'value', colSpan: 3 }, {}, {}
                        ],

                        [{ text: 'PROPRIETÁRIO', style: 'tableHeaderGray', colSpan: 4, border: [false, false, false, false] }, {}, {}, {}],
                        [
                            { text: 'Proprietário:', style: 'label' }, { text: task.proprietario || "-", style: 'value' },
                            { text: 'Telefone:', style: 'label' }, { text: reportData.telefone_proprietario || "-", style: 'value' }
                        ],
                        [
                            { text: 'Endereço:', style: 'label' }, { text: reportData.endereco_proprietario || "-", style: 'value', colSpan: 3 }, {}, {}
                        ]
                    ]
                },
                layout: {
                    hLineWidth: function (i, node) { return 0; },
                    vLineWidth: function (i, node) { return 0; },
                    paddingLeft: function(i, node) { return 4; },
                    paddingRight: function(i, node) { return 4; },
                    paddingTop: function(i, node) { return 2; },
                    paddingBottom: function(i, node) { return 2; }
                }
            },

            // 4. MATERIAL
            {
                margin: [0, 15, 0, 15],
                stack: [
                    { text: [ { text: 'Material Remetido: ', bold: true }, `Biópsia ${chk(isBio)}    Necropsia ${chk(isNecro)}` ] },
                    { text: [ { text: 'Tipo de Material: ', bold: true }, reportData.tipo_material_desc || "-" ] },
                    { text: [ { text: 'Tempo Morte/Colheita: ', bold: true }, (reportData.tempo_morte || '-') + ' horas' ] },
                    { text: [ { text: 'Circunstância: ', bold: true }, `Morte Espontânea ${chk(reportData.morte_tipo === 'espontanea')}    Eutanásia ${chk(reportData.morte_tipo === 'eutanasia')}` ] },
                    { text: [ { text: 'Conservação: ', bold: true }, `Formol ${chk(!reportData.conservacao || reportData.conservacao==='formol')}   Refrig. ${chk(reportData.conservacao==='refrigerado')}   Cong. ${chk(reportData.conservacao==='congelado')}` ] },
                ],
                fontSize: 11
            },
            
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }] },

            // 5. TEXTOS
            ...createSection("HISTÓRICO CLÍNICO", reportData.historico),
            ...createSection("DIAGNÓSTICO PRESUNTIVO/SUSPEITA", reportData.suspeita),
            ...createSection("DESCRIÇÃO MACROSCÓPICA", reportData.macroscopia),
            ...createSection("DESCRIÇÃO MICROSCÓPICA", reportData.microscopia),
            ...createSection("DIAGNÓSTICO(S)", reportData.diagnostico, true),
            ...createSection("COMENTÁRIOS", reportData.comentarios),

            // 6. DATA E ASSINATURA
            { text: [{ text: 'Data de emissão de laudo: ', bold: true }, dataEmissaoTexto], margin: [0, 20, 0, 10], fontSize: 11 },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 535, y2: 0, lineWidth: 1 }] },

            // Bloco de assinatura condicional
            assinaturaBlock
        ],

        // --- ESTILOS ---
        styles: {
            mainTitle: { fontSize: 14, bold: true, decoration: 'underline', alignment: 'center' },
            sectionHeader: { fontSize: 11, bold: true, decoration: 'underline' },
            body: { fontSize: 11, alignment: 'justify', lineHeight: 1.3 },
            bodyBold: { fontSize: 11, alignment: 'justify', bold: true, lineHeight: 1.3 },
            label: { fontSize: 11, bold: true },
            value: { fontSize: 11 },
            tableHeaderGray: { 
                fillColor: '#E6E6E6', 
                bold: true, 
                alignment: 'center', 
                fontSize: 10,
                margin: [0, 2, 0, 2]
            }
        },
        defaultStyle: { font: 'Roboto' }
    };

    const nomeLimpo = (task.animalNome || "animal").replace(/[^a-z0-9]/gi, '_');
    pdfMake.createPdf(docDefinition).download(`Laudo_${protocolo}_${nomeLimpo}.pdf`);
}