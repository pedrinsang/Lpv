/* --- assets/js/components/docx-generator.js --- */

// 1. Carrega a biblioteca DOCX
async function carregarDocx() {
    if (window.docx) return window.docx;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/docx@7.8.2/build/index.js';
        script.onload = () => resolve(window.docx);
        script.onerror = () => reject(new Error("Erro ao carregar biblioteca DOCX"));
        document.head.appendChild(script);
    });
}

// 2. Converte Imagem para Base64
async function getImageAsBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1]; 
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn(`Imagem não carregada (${url}):`, error);
        return null;
    }
}

// 3. FUNÇÃO PRINCIPAL (Sem conflito de variáveis)
// Recebe 'task' e 'reportData' (dados finais)
export async function generateLaudoWord(task, reportData) {
    const docx = await carregarDocx();
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, ImageRun, WidthType, AlignmentType, VerticalAlign, BorderStyle } = docx;

    // --- IMAGENS ---
    const urlUFSM = "../assets/images/Logo-UFSM.png"
    const urlLPV = "../assets/images/LPV.png"; 
    
    const [base64UFSM, base64LPV] = await Promise.all([
        getImageAsBase64(urlUFSM),
        getImageAsBase64(urlLPV)
    ]);

    // --- VARIÁVEIS ---
    const protocolo = task.protocolo || task.accessCode || "---";
    const dataReceb = task.dataEntrada 
        ? new Date(task.dataEntrada + 'T12:00:00').toLocaleDateString('pt-BR') 
        : new Date(task.createdAt).toLocaleDateString('pt-BR');

    let dataEmissaoTexto = "";
    if (task.releasedAt) {
        // Converte timestamp ISO do banco para DD/MM/AAAA
        dataEmissaoTexto = new Date(task.releasedAt).toLocaleDateString('pt-BR');
    } else {
        // Ainda não liberado: Data atual (Rascunho)
        dataEmissaoTexto = new Date().toLocaleDateString('pt-BR');
    }
    
    const chk = (val) => val ? "[ X ]" : "[   ]";
    
    // Usa reportData em vez de tentar ler o DOM
    // Prioriza o que foi marcado no formulário (reportData), senão usa o tipo da task
    const isBio = reportData.tipo_material_radio ? reportData.tipo_material_radio === 'biopsia' : task.type === 'biopsia';
    const isNecro = reportData.tipo_material_radio ? reportData.tipo_material_radio === 'necropsia' : task.type === 'necropsia';

    // --- ESTILOS ---
    const fontName = "Times New Roman";
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };
    
    // Helpers
    const createTextCell = (text, bold=false, size=22, align=AlignmentType.LEFT) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: text||"", bold: bold, font: fontName, size: size })], alignment: align })],
        verticalAlign: VerticalAlign.CENTER, borders: { top:noBorder, bottom:noBorder, left:noBorder, right:noBorder }
    });

    const createDataRow = (lbl1, val1, lbl2, val2) => {
        const cells = [
            new TableCell({ children:[new Paragraph({children:[new TextRun({text:lbl1, bold:true, font:fontName, size:22})]})], width:{size:15, type:WidthType.PERCENTAGE} }),
            new TableCell({ children:[new Paragraph({children:[new TextRun({text:val1||"-", font:fontName, size:22})]})], width:{size:35, type:WidthType.PERCENTAGE} })
        ];
        if(lbl2) {
            cells.push(
                new TableCell({ children:[new Paragraph({children:[new TextRun({text:lbl2, bold:true, font:fontName, size:22})]})], width:{size:15, type:WidthType.PERCENTAGE} }),
                new TableCell({ children:[new Paragraph({children:[new TextRun({text:val2||"-", font:fontName, size:22})]})], width:{size:35, type:WidthType.PERCENTAGE} })
            );
        } else {
            // Se não tiver label 2, faz a célula de valor ocupar o resto da linha
            cells[1] = new TableCell({ children:[new Paragraph({children:[new TextRun({text:val1||"-", font:fontName, size:22})]})], columnSpan:3, width:{size:85, type:WidthType.PERCENTAGE} });
        }
        return new TableRow({ children: cells });
    };

    // --- MONTAGEM ---
    const sections = [];

    // 1. CABEÇALHO
    const headerCells = [];
    if (base64UFSM) {
        headerCells.push(new TableCell({
            children: [new Paragraph({ children: [new ImageRun({ data: base64UFSM, transformation: { width: 120, height: 120 } })], alignment: AlignmentType.CENTER })],
            width: { size: 20, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
        }));
    } else { headerCells.push(createTextCell("", true, 20, AlignmentType.CENTER)); }

    headerCells.push(new TableCell({
        children: [
            new Paragraph({ children: [new TextRun({ text: "UNIVERSIDADE FEDERAL DE SANTA MARIA", bold: true, size: 24, font: fontName })], alignment: AlignmentType.CENTER }),
            new Paragraph({ children: [new TextRun({ text: "DEPARTAMENTO DE PATOLOGIA", bold: true, size: 20, font: fontName })], alignment: AlignmentType.CENTER }),
            new Paragraph({ children: [new TextRun({ text: "Laboratório de Patologia Veterinária", size: 20, font: fontName })], alignment: AlignmentType.CENTER }),
            new Paragraph({ children: [new TextRun({ text: "Prédio 97B, 97105-900 Santa Maria, RS, Brasil", size: 18, font: fontName })], alignment: AlignmentType.CENTER }),
            new Paragraph({ children: [new TextRun({ text: "lpv@ufsm.br | 55 3220-8168", size: 18, font: fontName })], alignment: AlignmentType.CENTER }),
        ],
        width: { size: 60, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
    }));

    if (base64LPV) {
        headerCells.push(new TableCell({
            children: [new Paragraph({ children: [new ImageRun({ data: base64LPV, transformation: { width: 120, height: 64 } })], alignment: AlignmentType.CENTER })],
            width: { size: 20, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.CENTER, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
        }));
    } else { headerCells.push(createTextCell("", true, 20, AlignmentType.CENTER)); }

    sections.push(new Table({ columnWidths: [2000, 5000, 2000], rows: [new TableRow({ children: headerCells })], width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder, insideHorizontal: noBorder } }));

    // 2. TÍTULO
    sections.push(
        new Paragraph({ children: [new TextRun({ text: `LAUDO HISTOPATOLÓGICO (${protocolo})`, bold: true, size: 28, font: fontName, underline: {} })], alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: "Data de recebimento: ", bold: true, size: 22, font: fontName }), new TextRun({ text: dataReceb, size: 22, font: fontName })], spacing: { after: 100 } })
    );

    // 3. DADOS (PREENCHIDO COM DADOS DO FORMULÁRIO DE LAUDO)
    sections.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            // --- DADOS DO ANIMAL ---
            new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "DADOS DO ANIMAL", bold: true, size: 20, font: "Arial" })], alignment: AlignmentType.CENTER })], columnSpan: 4, shading: { fill: "E6E6E6" } })] }),
            createDataRow("Nome:", task.animalNome, "Espécie:", task.especie),
            createDataRow("Raça:", task.raca || "SRD", "Sexo/Idade:", `${task.sexo || "-"} / ${task.idade || "-"}`),
            
            // --- REQUISITANTE ---
            new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "REQUISITANTE", bold: true, size: 20, font: "Arial" })], alignment: AlignmentType.CENTER })], columnSpan: 4, shading: { fill: "E6E6E6" } })] }),
            // Usa 'task.docente' (nome do veterinário cadastrado) ou fallback para remetente
            createDataRow("Requisitante:", task.remetente, "Telefone:", reportData.telefone_requisitante),
            createDataRow("Email:", reportData.email_requisitante, "Clínica/Empresa:", reportData.clinica_requisitante),
            createDataRow("Endereço:", reportData.endereco_requisitante),
            
            // --- PROPRIETÁRIO ---
            new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "PROPRIETÁRIO", bold: true, size: 20, font: "Arial" })], alignment: AlignmentType.CENTER })], columnSpan: 4, shading: { fill: "E6E6E6" } })] }),
            createDataRow("Proprietário:", task.proprietario, "Telefone:", reportData.telefone_proprietario),
            createDataRow("Email:", reportData.email_proprietario, "Endereço:", reportData.endereco_proprietario),
        ]
    }));
    sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

    // 4. MATERIAL
    sections.push(
        new Paragraph({ children: [new TextRun({ text: "Material Remetido: ", bold: true, font: fontName, size: 22 }), new TextRun({ text: `Biópsia ${chk(isBio)}    Necropsia ${chk(isNecro)}`, font: fontName, size: 22 })], spacing: { after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: "Tipo de Material: ", bold: true, font: fontName, size: 22 }), new TextRun({ text: reportData.tipo_material_desc || "-", font: fontName, size: 22 })], spacing: { after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: "Tempo Morte/Colheita: ", bold: true, font: fontName, size: 22 }), new TextRun({ text: `${reportData.tempo_morte || '-'} horas`, font: fontName, size: 22 })], spacing: { after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: "Circunstância: ", bold: true, font: fontName, size: 22 }), new TextRun({ text: `Morte Espontânea ${chk(reportData.morte_tipo === 'espontanea')}    Eutanásia ${chk(reportData.morte_tipo === 'eutanasia')}`, font: fontName, size: 22 })], spacing: { after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: "Conservação: ", bold: true, font: fontName, size: 22 }), new TextRun({ text: `Formol ${chk(!reportData.conservacao || reportData.conservacao==='formol')}   Refrig. ${chk(reportData.conservacao==='refrigerado')}   Cong. ${chk(reportData.conservacao==='congelado')}`, font: fontName, size: 22 })], spacing: { after: 120 } }),
        new Paragraph({ border: { bottom: { color: "000000", space: 1, style: "single", size: 6 } }, spacing: { after: 300 } })
    );

    // 5. TEXTOS
    const addSection = (title, content, boldC = false) => {
        sections.push(
            new Paragraph({ children: [new TextRun({ text: title + ":", bold: true, underline: {}, font: fontName, size: 22 })], spacing: { before: 100, after: 50 } }),
            new Paragraph({ children: [new TextRun({ text: content || "-", font: fontName, size: 22, bold: boldC })], alignment: AlignmentType.JUSTIFIED, spacing: { after: 150 } })
        );
    };

    addSection("HISTÓRICO CLÍNICO", reportData.historico);
    addSection("DIAGNÓSTICO PRESUNTIVO/SUSPEITA", reportData.suspeita);
    addSection("DESCRIÇÃO MACROSCÓPICA", reportData.macroscopia);
    addSection("DESCRIÇÃO MICROSCÓPICA", reportData.microscopia);
    addSection("DIAGNÓSTICO(S)", reportData.diagnostico, true);
    addSection("COMENTÁRIOS", reportData.comentarios);

    sections.push(new Paragraph({spacing: { after: 100 }}));

    // DATA DE EMISSÃO DO LAUDO (FIXA OU ATUAL)
    sections.push(new Paragraph({ 
        children: [
            new TextRun({ text: "Data de emissão de laudo: ", bold: true, font: fontName, size: 22 }),
            new TextRun({ text: dataEmissaoTexto, font: fontName, size: 22 }) 
        ], 
    }));

    sections.push(new Paragraph({spacing: { after: 200 }}));
    sections.push(new Paragraph({ border: { bottom: { color: "000000", space: 1, style: "single", size: 6 } }, spacing: { after: 200 } }));
    
    // 6. ASSINATURAS (COM PROTEÇÃO DE QUEBRA DE PÁGINA)
    const signatureRow = new TableRow({
        cantSplit: true, 
        children: [
            // Coluna Esquerda: Patologista
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "Dra. Mariana Martins Flores", bold: true, font: fontName, size: 22 })],
                        alignment: AlignmentType.CENTER,
                        keepNext: true,
                        keepLines: true
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: "Patologista / CRMV 14.636", font: fontName, size: 22 })],
                        alignment: AlignmentType.CENTER,
                        keepLines: true
                    }),
                ]
            }),
            
            // Coluna Direita: Pós-Graduando
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: task.posGraduando || "Pós-Graduando", bold: true, font: fontName, size: 22 })],
                        alignment: AlignmentType.CENTER,
                        keepNext: true,
                        keepLines: true
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: "Pós-Graduando(a) / LPV", font: fontName, size: 22 })],
                        alignment: AlignmentType.CENTER,
                        keepLines: true
                    }),
                ]
            })
        ]
    });

    sections.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideVertical: noBorder },
        rows: [signatureRow]
    }));

    // GERA DOWNLOAD
    const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1133, right: 1133, bottom: 1133, left: 1133 } } }, children: sections }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const nomeLimpo = (task.animalNome || "animal").replace(/[^a-z0-9]/gi, '_');
    link.download = `Laudo_${protocolo}_${nomeLimpo}.docx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
}