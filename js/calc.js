// Regras de cálculo do app. Funções puras: recebem os dados e devolvem números.
// Valores em centavos. Datas "AAAA-MM-DD", meses "AAAA-MM".
//
// Estrutura dos dados (S):
//   S.settings       { setupDone, setupDate, salaryDefault }
//   S.incomes        [{ id, type, amount, date }]                  entradas "Recebi"
//   S.fixedTemplates [{ id, name, amount, dueDay, createdMonth }]  fixos que se repetem
//   S.fixedMonths    [{ id, templateId, month, name, amount, dueDay, paid, paidDate }]
//   S.expenses       [{ id, amount, description, category, date, createdAt }]
//   S.dayLimits      { "AAAA-MM-DD": centavos }   limite salvo no fechamento de cada dia

import { monthOf, dayOf, daysInMonth, addMonths, addDays } from './format.js';

const sum = (arr, f = x => x.amount) => arr.reduce((t, x) => t + f(x), 0);

/** Divisão arredondada para baixo, para nunca liberar mais do que existe. */
export function floorDiv(a, b) {
  return Math.floor(a / b);
}

/** Primeiro mês com dados (ou o mês da configuração inicial). */
export function firstMonth(S, today) {
  let m = S.settings.setupDate ? monthOf(S.settings.setupDate) : monthOf(today);
  for (const i of S.incomes) if (monthOf(i.date) < m) m = monthOf(i.date);
  for (const e of S.expenses) if (monthOf(e.date) < m) m = monthOf(e.date);
  for (const f of S.fixedMonths) if (f.month < m) m = f.month;
  return m;
}

/** Totais de um mês. */
export function monthFlows(S, month) {
  const incomes = S.incomes.filter(i => monthOf(i.date) === month);
  const fixed = S.fixedMonths.filter(f => f.month === month);
  const expenses = S.expenses.filter(e => monthOf(e.date) === month);
  const fixedPaid = sum(fixed.filter(f => f.paid));
  const fixedPending = sum(fixed.filter(f => !f.paid));
  return {
    incomeCount: incomes.length,
    salary: sum(incomes),
    fixedPaid,
    fixedPending,
    fixedTotal: fixedPaid + fixedPending,
    flex: sum(expenses),
  };
}

/** Saldo que sobrou do mês anterior e passa para este mês. */
export function carryInto(S, month, today) {
  const first = firstMonth(S, today);
  let carry = 0;
  for (let m = first; m < month; m = addMonths(m, 1)) {
    const f = monthFlows(S, m);
    carry = carry + f.salary - f.fixedPaid - f.flex;
  }
  return carry;
}

/** Todas as métricas da tela Hoje (regras 2 a 7 e 9). */
export function todayMetrics(S, today) {
  const month = monthOf(today);
  const f = monthFlows(S, month);
  const carry = carryInto(S, month, today);
  const spentToday = sum(S.expenses.filter(e => e.date === today));

  // Regra 3 (+ sobra do mês anterior)
  const saldoConta = carry + f.salary - f.fixedPaid - f.flex;
  // Regra 4
  const pendentes = f.fixedPending;
  // Regra 5
  const livre = saldoConta - pendentes;
  // Regra 6: dias restantes contando hoje
  const diasRestantes = daysInMonth(month) - dayOf(today) + 1;
  // Regra 9
  const hasSalary = f.incomeCount > 0;
  // Regra 6 + exceção da regra 8: os gastos de hoje não reduzem o limite de hoje
  const limite = hasSalary ? floorDiv(livre + spentToday, diasRestantes) : null;
  // Regra 7
  const restante = hasSalary ? limite - spentToday : null;

  return {
    month, carry, salary: f.salary, fixedPaid: f.fixedPaid, fixedTotal: f.fixedTotal,
    flexMonth: f.flex, saldoConta, pendentes, livre, diasRestantes,
    hasSalary, limite, spentToday, restante,
  };
}

/**
 * Limite de um dia passado calculado a partir dos dados
 * (usado só quando o app não estava aberto no fechamento daquele dia).
 * Considera o que já tinha sido recebido até aquele dia e os gastos dos dias anteriores.
 */
export function computeDayLimit(S, date, today) {
  const month = monthOf(date);
  const incomes = S.incomes.filter(i => monthOf(i.date) === month && i.date <= date);
  if (incomes.length === 0) return null; // regra 9: sem salário, sem limite
  const carry = carryInto(S, month, today);
  const fixedTotal = sum(S.fixedMonths.filter(f => f.month === month));
  const flexBefore = sum(S.expenses.filter(e => monthOf(e.date) === month && e.date < date));
  const livre = carry + sum(incomes) - fixedTotal - flexBefore;
  return floorDiv(livre, daysInMonth(month) - dayOf(date) + 1);
}

/** Limite de qualquer dia: hoje = valor atual; passado = valor salvo; futuro = nenhum. */
export function limitForDay(S, date, today) {
  if (date > today) return null;
  if (date === today) return todayMetrics(S, today).limite;
  if (S.dayLimits[date] !== undefined) return S.dayLimits[date];
  if (S.settings.setupDate && date < S.settings.setupDate) return null;
  return computeDayLimit(S, date, today);
}

export function spentOnDay(S, date) {
  return sum(S.expenses.filter(e => e.date === date));
}

/** Regra 10: 'green', 'red' ou 'gray'. */
export function dayStatus(S, date, today) {
  const limit = limitForDay(S, date, today);
  if (limit === null || limit === undefined) return 'gray';
  return spentOnDay(S, date) <= limit ? 'green' : 'red';
}

/** Contagem de dias verdes e vermelhos de um mês. */
export function monthDayStats(S, month, today) {
  let green = 0, red = 0;
  const n = daysInMonth(month);
  for (let d = 1; d <= n; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date > today) break;
    const st = dayStatus(S, date, today);
    if (st === 'green') green++;
    else if (st === 'red') red++;
  }
  return { green, red };
}

/** Sequência atual de dias verdes seguidos, terminando hoje (ou ontem, se hoje ainda não tem dados). */
export function greenStreak(S, today) {
  let date = today;
  if (dayStatus(S, date, today) === 'gray') date = addDays(date, -1);
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    if (dayStatus(S, date, today) !== 'green') break;
    count++;
    date = addDays(date, -1);
  }
  return count;
}

/**
 * Dias passados que ainda não têm limite salvo: calcula e devolve para salvar.
 * Assim a cor de um dia passado nunca muda depois (regra 10).
 */
export function freezePastDays(S, today) {
  const out = [];
  if (!S.settings.setupDate) return out;
  for (let date = S.settings.setupDate; date < today; date = addDays(date, 1)) {
    if (S.dayLimits[date] !== undefined) continue;
    const limit = computeDayLimit(S, date, today);
    if (limit !== null) out.push({ date, limit });
  }
  return out;
}

/** Cria os fixos do mês a partir dos modelos, com status "Não pago". */
export function ensureMonthFixed(S, month, newId) {
  const created = [];
  for (const t of S.fixedTemplates) {
    if (t.createdMonth && t.createdMonth > month) continue;
    const exists = S.fixedMonths.some(f => f.templateId === t.id && f.month === month);
    if (!exists) {
      created.push({
        id: newId(), templateId: t.id, month, name: t.name, amount: t.amount,
        dueDay: t.dueDay, paid: false, paidDate: null,
      });
    }
  }
  return created;
}

/** Linhas do Histórico, do mês mais recente para o mais antigo. */
export function historyRows(S, today) {
  const rows = [];
  const first = firstMonth(S, today);
  const current = monthOf(today);
  let carry = 0;
  for (let m = first; m <= current; m = addMonths(m, 1)) {
    const f = monthFlows(S, m);
    const total = f.fixedPaid + f.flex;
    const sobra = carry + f.salary - total;
    const st = monthDayStats(S, m, today);
    rows.push({
      month: m, carry, salary: f.salary, fixed: f.fixedPaid, flex: f.flex,
      total, sobra, green: st.green, red: st.red,
    });
    carry = sobra;
  }
  return rows.reverse();
}
