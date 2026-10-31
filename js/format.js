// Formatação brasileira: moeda, datas e meses.
// Todos os valores de dinheiro são guardados em CENTAVOS (números inteiros)
// para evitar erros de arredondamento.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DEC = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];

/** 123456 -> "R$ 1.234,56" */
export function money(cents) {
  return BRL.format((cents || 0) / 100);
}

/** 123456 -> "1.234,56" (sem o símbolo) */
export function plainMoney(cents) {
  return DEC.format((cents || 0) / 100);
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

/** Date -> "AAAA-MM-DD" usando o fuso do aparelho */
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

/** "2026-11-05" -> "2026-11" */
export function monthOf(iso) {
  return iso.slice(0, 7);
}

/** "2026-11-05" -> 5 */
export function dayOf(iso) {
  return Number(iso.slice(8, 10));
}

/** "2026-11" -> 30 */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** ("2026-11", -1) -> "2026-10" */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** ("2026-11-30", 1) -> "2026-12-01" */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + n));
}

/** ("2026-02", 31) -> "2026-02-28" (vencimento ajustado ao último dia do mês) */
export function dateInMonth(month, day) {
  const last = daysInMonth(month);
  return `${month}-${pad(Math.min(Math.max(1, day), last))}`;
}

/** "2026-11-05" -> "05/11/2026" */
export function fmtDate(iso) {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-11-05" -> "05/11" */
export function fmtDayMonth(iso) {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "2026-11" -> "novembro de 2026" */
export function monthName(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

/** "2026-11" -> "Novembro de 2026" */
export function monthTitle(month) {
  const s = monthName(month);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-11" -> "Novembro" */
export function monthOnly(month) {
  const m = Number(month.slice(5, 7));
  const s = MESES[m - 1];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-10-31" -> "sábado, 31 de outubro" */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return `${DIAS_SEMANA[wd]}, ${d} de ${MESES[m - 1]}`;
}

/** Dia da semana (0 = domingo) do dia 1 do mês */
export function firstWeekday(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}
