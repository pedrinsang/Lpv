/**
 * CONTATO — telefone ou e-mail no mesmo campo.
 *
 * O contato do remetente e o do proprietário são um campo só, que aceita as
 * duas coisas: na prática cada pessoa deixa uma ou outra, e obrigar a escolher
 * criaria um campo vazio em metade dos cadastros.
 *
 * Só que telefone tem forma e e-mail não. Sem normalizar, o mesmo número entra
 * como "55999991234", "55 99999-1234" e "(55)99999-1234" — três grafias que a
 * busca do Livro trata como três contatos diferentes. Por isso a formatação
 * decide pelo conteúdo: o que só tem dígito e pontuação de telefone vira
 * "(55) 99999-1234"; qualquer coisa com letra ou @ é e-mail e passa intacta.
 */

/** Dígitos e a pontuação que aparece em telefone escrito à mão. */
const SO_TELEFONE = /^[\d\s()+.-]+$/;

/**
 * Devolve o contato na forma final. Não valida nada: contato incompleto ou
 * fora do padrão brasileiro volta como a pessoa escreveu, porque um telefone
 * pela metade ainda é a informação que ela tinha — recusar seria pior.
 */
export function formatarContato(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return '';

    // Letra ou @ decide na hora: é e-mail, e e-mail não tem forma a impor.
    if (!SO_TELEFONE.test(texto)) return texto;

    // Número internacional é escrito por quem sabe o que está fazendo — o "+"
    // já avisa que a forma não é a nossa.
    if (texto.startsWith('+')) return texto;

    const digitos = texto.replace(/\D/g, '');

    // 11 dígitos = celular (DDD + 9), 10 = fixo (DDD + 8). Impor "(xx) xxxxx-xxxx"
    // a um fixo produziria "(55) 33334-444", que não é o número de ninguém.
    if (digitos.length === 11) {
        return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
    }
    if (digitos.length === 10) {
        return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
    }

    // Fora dessa faixa não é telefone brasileiro completo: pode ser ramal,
    // número sem DDD ou digitação pela metade. Formatar seria inventar o que
    // não está lá.
    return texto;
}
