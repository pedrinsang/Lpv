/**
 * PROTOCOLO — leitura, ordenação e ano da série.
 *
 * O protocolo ("V001-26", "Vn113-26") carrega três informações: o tipo do caso
 * (V = biópsia, Vn = necropsia), o número sequencial e o ano da série. Ele é o
 * identificador do caso no laboratório, então tanto a ordenação quanto o filtro
 * por ano do Livro de Registros saem daqui — e não da data do laudo, que pode
 * cair no ano seguinte (um caso de 2025 laudado em fevereiro de 2026 continua
 * sendo um caso de 2025).
 *
 * Aceita também as grafias antigas ("V-001/26", "VN 1-2026").
 */

const RE_PROTOCOLO = /^\s*(VN|V)\s*[-–\s]?\s*(\d{1,4})\s*[-/–]?\s*(\d{2}|\d{4})\s*$/i;

/** "V001-26" -> { tipo: 'biopsia', numero: 1, ano: 2026 } | null */
export function parseProtocolo(protocolo) {
    const m = String(protocolo || '').match(RE_PROTOCOLO);
    if (!m) return null;

    const numero = Number(m[2]);
    const bruto = Number(m[3]);
    // dois dígitos: 00-79 -> 2000-2079, 80-99 -> 1980-1999
    const ano = m[3].length === 4 ? bruto : (bruto <= 79 ? 2000 + bruto : 1900 + bruto);

    return { tipo: m[1].toUpperCase() === 'VN' ? 'necropsia' : 'biopsia', numero, ano };
}

/** Ano da série do caso. 0 quando o protocolo não é legível. */
export function anoProtocolo(protocolo) {
    const p = parseProtocolo(protocolo);
    return p ? p.ano : 0;
}

/**
 * Peso para ordenação cronológica.
 *
 * Ordenar o texto puro não serve: "V140-26" viria antes de "V009-26" e todas as
 * biópsias antes de qualquer necropsia. Aqui o ano manda, depois o número da
 * série (que é sequencial no tempo); o tipo entra só para desempatar V001-26 de
 * Vn001-26, que são casos diferentes.
 *
 * Sem protocolo legível o peso é o maior possível, então esses casos ficam no
 * fim da lista em ordem crescente.
 */
export function pesoProtocolo(protocolo) {
    const p = parseProtocolo(protocolo);
    if (!p) return Number.MAX_SAFE_INTEGER;
    return (p.ano * 10000 + p.numero) * 2 + (p.tipo === 'necropsia' ? 1 : 0);
}

/** Grafia oficial: V001-26 (biópsia), Vn001-26 (necropsia). */
export function formatarProtocolo(protocolo) {
    const p = parseProtocolo(protocolo);
    if (!p) return String(protocolo || '');
    const sigla = p.tipo === 'necropsia' ? 'Vn' : 'V';
    return `${sigla}${String(p.numero).padStart(3, '0')}-${String(p.ano).slice(-2)}`;
}

/**
 * Campos derivados que ficam gravados no documento do caso. Guardá-los no
 * Firestore é o que deixa o Livro de Registros carregar um ano por vez em vez
 * de puxar o acervo inteiro a cada abertura.
 */
export function camposDerivados(protocolo) {
    const p = parseProtocolo(protocolo);
    return {
        protocoloAno: p ? p.ano : 0,
        protocoloPeso: pesoProtocolo(protocolo)
    };
}
