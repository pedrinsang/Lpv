/**
 * SÉRIE DO PROTOCOLO — qual é o próximo número.
 *
 * A numeração é sequencial por tipo e por ano (V001-26, V002-26… e a série de
 * necropsia correndo em paralelo, Vn001-26, Vn002-26…). Quem cadastra a entrada
 * hoje precisa abrir o Livro de Registros ou o Mural para descobrir onde a série
 * parou — daí este módulo: ele varre os casos e responde qual é o próximo.
 *
 * A varredura é da coleção `tasks` inteira, sem filtro. Consultar só o ano
 * (`where('protocoloAno','==',ano)`) seria bem mais barato, mas `protocoloAno`
 * só passou a ser gravado em agosto/26 e o Firestore não devolve documento que
 * não tem o campo: os casos cadastrados antes disso ficariam de fora da conta e
 * a sugestão repetiria um número já usado — que é justamente o erro que a
 * sugestão existe para evitar. O número sai do texto do protocolo, que todo caso
 * tem, esteja ele pendente no Mural ou já liberado no Livro.
 */
import { db } from '../core.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { parseProtocolo, montarProtocolo } from './protocolo.js';

/**
 * Quanto tempo a varredura vale antes de ser refeita.
 *
 * Não dá para varrer a cada abertura do modal (é a coleção inteira a cada
 * cadastro) nem para varrer uma vez só por sessão: duas pessoas cadastrando ao
 * mesmo tempo receberiam o mesmo número. Dois minutos cobrem a sequência de
 * cadastros de uma pessoa — e os cadastros feitos por esta aba entram no cache
 * na hora, sem esperar a próxima varredura.
 */
const VALIDADE_MS = 2 * 60 * 1000;

/** `maiores`: "tipo:ano" -> maior número visto. `existentes`: protocolos já usados. */
let cache = null;
let carregadoEm = 0;
let carregando = null;

const chave = (tipo, ano) => `${tipo}:${ano}`;

function anotar(dados, protocolo) {
    const p = parseProtocolo(protocolo);
    if (!p) return;   // agendamento rápido e protocolo ilegível não têm série

    const k = chave(p.tipo, p.ano);
    if (p.numero > (dados.maiores.get(k) || 0)) dados.maiores.set(k, p.numero);
    dados.existentes.add(montarProtocolo(p.tipo, p.numero, p.ano));
}

async function varrer() {
    const dados = { maiores: new Map(), existentes: new Set() };
    const snapshot = await getDocs(collection(db, 'tasks'));
    snapshot.forEach((d) => anotar(dados, d.data().protocolo));

    cache = dados;
    carregadoEm = Date.now();
    return dados;
}

/**
 * Garante uma varredura recente. Chame ao abrir o formulário para que o número
 * já esteja pronto quando a pessoa digitar o prefixo.
 *
 * Resolve com os dados da série, ou `null` quando a leitura falhou e não há
 * varredura anterior para reaproveitar. Esse `null` importa: sem saber onde a
 * série parou, sugerir qualquer número seria sugerir o 001 e mandar a pessoa
 * repetir um protocolo — melhor não sugerir nada e deixar que ela digite, como
 * sempre fez.
 */
export function prepararSerie() {
    const vencido = !cache || (Date.now() - carregadoEm) > VALIDADE_MS;

    if (!carregando && vencido) {
        carregando = varrer()
            .catch((erro) => {
                console.warn('Não foi possível ler a série dos protocolos.', erro);
                return cache;   // varredura antiga serve; null na primeira falha
            })
            .finally(() => { carregando = null; });
    }

    return carregando || Promise.resolve(cache);
}

/** Maior número já usado nessa série. 0 quando a série do ano ainda não começou. */
export function ultimoDaSerie(tipo, ano) {
    return (cache && cache.maiores.get(chave(tipo, ano))) || 0;
}

/** Próximo protocolo da série, na grafia oficial. */
export function proximoDaSerie(tipo, ano) {
    return montarProtocolo(tipo, ultimoDaSerie(tipo, ano) + 1, ano);
}

/**
 * O protocolo já pertence a algum caso? Vale o que a última varredura viu — é
 * um aviso, não uma trava.
 */
export function protocoloJaUsado(protocolo) {
    const p = parseProtocolo(protocolo);
    if (!p || !cache) return false;
    return cache.existentes.has(montarProtocolo(p.tipo, p.numero, p.ano));
}

/**
 * Soma à conta um caso recém-cadastrado, para que o cadastro seguinte já receba
 * o número certo sem esperar a próxima varredura.
 */
export function registrarNaSerie(protocolo) {
    if (cache) anotar(cache, protocolo);
}
