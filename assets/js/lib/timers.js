/**
 * LPV - BASE DE DADOS DE PROTOCOLOS
 * Contém as instruções exatas de tempo e passos.
 */

// Placeholder para protocolos futuros
const EM_BREVE = [
    { nome: 'Em Desenvolvimento', tipo: 'manual', instrucao: 'Protocolo aguardando cadastro técnico.' }
];

// 1. HEMATOXILINA E EOSINA (HE) - Cópia Fiel do seu Protocolo
const HE_STEPS = [
    { nome: 'Desparafinização', tipo: 'timer', tempo: 2400 }, // 40 min
    { nome: 'Xilol Frio 1', tipo: 'timer', tempo: 1200 }, // 20 min
    { nome: 'Xilol Frio 2', tipo: 'timer', tempo: 300 }, // 5 min
    { nome: 'Álcool Absoluto 1', tipo: 'timer', tempo: 60 }, // 1 min
    { nome: 'Álcool Absoluto 2', tipo: 'timer', tempo: 30 }, // 30 seg
    { nome: 'Álcool 96º', tipo: 'timer', tempo: 30 }, // 30 seg
    { nome: 'Álcool 70º', tipo: 'timer', tempo: 60 }, // 1 min
    { nome: 'Água Corrente', tipo: 'timer', tempo: 60 }, // 1 min
    { nome: 'Hematoxilina', tipo: 'timer', tempo: 90 }, // 90 seg
    { nome: 'Água Corrente', tipo: 'timer', tempo: 360 }, // 6 min
    { nome: 'Aviso Importante', tipo: 'manual', instrucao: 'Esgotar bem a água.\n(Bater o carrinho sobre papel toalha)' },
    { nome: 'Eosina', tipo: 'timer', tempo: 90 }, // 90 seg
    { nome: 'Lavagem Final', tipo: 'manual', instrucao: 'Álcool Absoluto: 3 séries de 10 mergulhos.' },
    { nome: 'Clarificação', tipo: 'timer', tempo: 120 }, // 2 min
    { nome: 'Finalização', tipo: 'manual', instrucao: 'Aplicar Xilol de Montagem e cobrir com lamínula.' }
];

// Objeto Principal exportado
export const PROTOCOLS_DATA = {
    'he': { 
        name: 'Hematoxilina e Eosina', 
        color: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)', 
        steps: HE_STEPS 
    },
    'toluidina': { 
        name: 'Azul de Toluidina', 
        color: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)', 
        steps: EM_BREVE 
    },
    'grocott': { 
        name: 'Grocott', 
        color: 'linear-gradient(135deg, #434343 0%, #000000 100%)', 
        steps: EM_BREVE 
    },
    'pas': { 
        name: 'PAS', 
        color: 'linear-gradient(135deg, #ec008c 0%, #fc6767 100%)', 
        steps: EM_BREVE 
    },
    'fontana': { 
        name: 'Fontana Masson', 
        color: 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 100%)', 
        steps: EM_BREVE 
    },
    'perls': { 
        name: 'Perls', 
        color: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', 
        steps: EM_BREVE 
    },
    'tricromico': { 
        name: 'Tricrômico', 
        color: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', 
        steps: EM_BREVE 
    },
    'ziehl': { 
        name: 'Ziehl-Neelsen', 
        color: 'linear-gradient(135deg, #cb2d3e 0%, #ef473a 100%)', 
        steps: EM_BREVE 
    },
    'gram': { 
        name: 'Gram', 
        color: 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 100%)', 
        steps: EM_BREVE 
    },
    'alciano': { 
        name: 'Azul Alciano', 
        color: 'linear-gradient(135deg, #00f260 0%, #0575e6 100%)', 
        steps: EM_BREVE 
    }
};