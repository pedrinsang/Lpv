/**
 * LPV - GERENCIADOR DE ANIVERSÁRIOS (FIRESTORE)
 */
import { db } from './core.js';
import { collection, getDocs, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const COLLECTION_NAME = 'birthdays';

// 1. Buscar todos os aniversários
export async function fetchBirthdays() {
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    const list = [];
    querySnapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
    });
    return list;
}

// 2. Adicionar novo
export async function addBirthday(nome, dia, mes) {
    await addDoc(collection(db, COLLECTION_NAME), {
        nome: nome,
        dia: parseInt(dia),
        mes: parseInt(mes)
    });
}

// 3. Deletar
export async function deleteBirthday(id) {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
}

// 4. Organizar por Mês (Helper)
export function groupBirthdaysByMonth(list) {
    const grouped = {};
    list.forEach(b => {
        if (!grouped[b.mes]) grouped[b.mes] = [];
        grouped[b.mes].push(b);
    });
    // Ordena dias
    for (const mes in grouped) {
        grouped[mes].sort((a, b) => a.dia - b.dia);
    }
    return grouped;
}

// 5. Filtrar os de Hoje (Helper)
export function filterBirthdaysToday(list) {
    const hoje = new Date();
    const dia = hoje.getDate();
    const mes = hoje.getMonth() + 1;
    return list.filter(b => b.dia === dia && b.mes === mes);
}

export const monthNames = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];