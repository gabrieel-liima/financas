// Interface do app: telas, formulários e recálculo imediato (regra 8).

import * as F from './format.js';
import * as C from './calc.js';
import * as DB from './db.js';
import { buildXlsx, XLSX_MIME } from './xlsx.js';

const CATEGORIAS = ['Alimentação', 'Transporte', 'Lazer', 'Compras', 'Outros'];
const TIPOS_RENDA = ['Salário', 'Adiantamento', 'Renda extra'];

let S = null;                       // todos os dados, em memória
let today = F.todayISO();
let tab = 'hoje';
let calMonth = F.monthOf(today);
let calSelected = today;

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const newId = () => (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2);

function saveErr(e) {
  console.error(e);
  alert('Não foi possível salvar no aparelho. Tente novamente.');
}
const save = (store, obj) => DB.put(store, obj).catch(saveErr);
const remove = (store, key) => DB.del(store, key).catch(saveErr);

// ---------- ícones ----------
const ICON = {
  hoje: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  calendario: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  fixos: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M3.5 6.5l1.2 1.2 2-2.2M3.5 12l1.2 1.2 2-2.2M3.5 17.5l1.2 1.2 2-2.2"/></svg>',
  salario: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
  historico: '<svg viewBox="0 0 24 24"><path d="M4 20.5h16"/><rect x="5" y="12" width="3.2" height="6" rx="1"/><rect x="10.4" y="7" width="3.2" height="11" rx="1"/><rect x="15.8" y="4" width="3.2" height="14" rx="1"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

// ---------- inicialização ----------
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  try {
    S = await DB.loadAll();
  } catch (e) {
    document.body.innerHTML = '<p class="fatal">Não foi possível abrir o armazenamento do aparelho. ' +
      'Verifique se o Safari não está em modo de navegação privada.</p>';
    return;
  }

  $$('#tabbar button').forEach(b => {
    b.innerHTML = ICON[b.dataset.tab] + `<span>${b.dataset.label}</span>`;
    b.addEventListener('click', () => goTab(b.dataset.tab));
  });
  $('#btn-add-gasto').addEventListener('click', () => openExpenseSheet(null));

  if (!S.settings.setupDone) {
    showWizard();
  } else {
    startDay();
    render();
  }

  // Virada do dia com o app aberto
  setInterval(checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
}

/** Cria os fixos do mês (status "Não pago") e salva o limite dos dias que já fecharam. */
function startDay() {
  const month = F.monthOf(today);
  for (const f of C.ensureMonthFixed(S, month, newId)) {
    S.fixedMonths.push(f);
    save('fixedMonths', f);
  }
  for (const d of C.freezePastDays(S, today)) {
    S.dayLimits[d.date] = d.limit;
    save('dayLimits', d);
  }
}

function checkDayChange() {
  const t = F.todayISO();
  if (t === today || !S || !S.settings.setupDone) return;
  const wasCalOnCurrent = calMonth === F.monthOf(today);
  today = t;
  if (wasCalOnCurrent) calMonth = F.monthOf(today);
  calSelected = today;
  startDay();
  render();
}

/** Guarda o limite de hoje; ao virar o dia ele fica congelado (regra 10). */
function syncTodayLimit() {
  const m = C.todayMetrics(S, today);
  if (m.limite === null) {
    if (S.dayLimits[today] !== undefined) {
      delete S.dayLimits[today];
      remove('dayLimits', today);
    }
  } else if (S.dayLimits[today] !== m.limite) {
    S.dayLimits[today] = m.limite;
    save('dayLimits', { date: today, limit: m.limite });
  }
}

function goTab(t) {
  tab = t;
  if (t === 'calendario') { calMonth = F.monthOf(today); calSelected = today; }
  render();
  window.scrollTo(0, 0);
}

/** Regra 8: qualquer alteração recalcula e redesenha tudo na hora. */
function render() {
  syncTodayLimit();
  $$('.tab').forEach(s => { s.hidden = s.id !== `tab-${tab}`; });
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#add-bar').hidden = tab !== 'hoje';
  document.body.classList.toggle('has-add-bar', tab === 'hoje');
  ({ hoje: renderHoje, calendario: renderCalendario, fixos: renderFixos,
    salario: renderSalario, historico: renderHistorico })[tab]();
}

function header(title, subtitle, extra = '') {
  const sub = subtitle.charAt(0).toUpperCase() + subtitle.slice(1);
  return `<header class="large-header"><div><p class="eyebrow">${esc(sub)}</p>` +
    `<h1>${esc(title)}</h1></div>${extra}</header>`;
}

// ---------- linhas deslizáveis (editar / excluir) ----------
function swipeRow(id, inner, cls = '') {
  return `<div class="swipe" data-id="${esc(id)}">
    <div class="swipe-actions"><button class="sa-edit" type="button">Editar</button><button class="sa-del" type="button">Excluir</button></div>
    <div class="swipe-content row ${cls}">${inner}</div></div>`;
}

function closeOpenRows(except) {
  $$('.swipe.open').forEach(r => { if (r !== except && r._close) r._close(); });
}

function bindSwipe(root, { onEdit, onDelete }) {
  const W = 160;
  $$('.swipe', root).forEach(row => {
    const content = $('.swipe-content', row);
    let x0 = 0, y0 = 0, dx = 0, tracking = false, decided = false, horizontal = false, open = false;

    const setOpen = v => {
      open = v;
      row.classList.toggle('open', v);
      content.style.transform = v ? `translateX(-${W}px)` : '';
    };
    row._close = () => setOpen(false);

    row.addEventListener('touchstart', e => {
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; dx = open ? -W : 0;
      tracking = true; decided = false; horizontal = false;
      content.style.transition = 'none';
      closeOpenRows(row);
    }, { passive: true });

    row.addEventListener('touchmove', e => {
      if (!tracking) return;
      const t = e.touches[0];
      const mx = t.clientX - x0, my = t.clientY - y0;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        horizontal = Math.abs(mx) > Math.abs(my);
      }
      if (!horizontal) return;
      e.preventDefault();
      dx = Math.min(0, Math.max(-W - 40, (open ? -W : 0) + mx));
      content.style.transform = `translateX(${dx}px)`;
    }, { passive: false });

    const end = () => {
      if (!tracking) return;
      tracking = false;
      content.style.transition = '';
      if (horizontal) setOpen(dx < -W / 2);
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);

    content.addEventListener('click', e => {
      if (e.target.closest('[data-stop]')) return;
      if (open) { setOpen(false); return; }
      onEdit(row.dataset.id);
    });
    $('.sa-edit', row).addEventListener('click', () => { setOpen(false); onEdit(row.dataset.id); });
    $('.sa-del', row).addEventListener('click', () => onDelete(row.dataset.id));
  });
}

// ---------- folhas (formulários) ----------
function openSheet({ title, body, saveLabel = 'Salvar', cancelLabel = 'Cancelar', onSave, onOpen }) {
  closeOpenRows();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-header">
      <button class="link" type="button" data-act="cancel">${cancelLabel}</button>
      <h2>${esc(title)}</h2>
      ${onSave ? `<button class="link bold" type="button" data-act="save">${saveLabel}</button>` : '<span class="link"></span>'}
    </div>
    <form class="sheet-body" novalidate>${body}</form></div>`;
  $('#overlay-root').appendChild(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('show'));

  const close = () => {
    wrap.classList.remove('show');
    document.body.classList.remove('sheet-open');
    setTimeout(() => wrap.remove(), 260);
  };
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  $('[data-act=cancel]', wrap).addEventListener('click', close);
  $('form', wrap).addEventListener('submit', e => e.preventDefault());
  if (onSave) {
    $('[data-act=save]', wrap).addEventListener('click', () => {
      if (onSave(wrap) !== false) close();
    });
  }
  if (onOpen) onOpen(wrap, close);
  return { el: wrap, close };
}

function moneyField(name, cents, label = 'Valor') {
  return `<label class="field"><span class="field-label">${label}</span>
    <span class="money-input"><span class="prefix">R$</span>
    <input name="${name}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0,00"
      value="${cents ? F.plainMoney(cents) : ''}" data-cents="${cents || 0}"></span></label>`;
}

/** Campo de dinheiro estilo caixa eletrônico: digitar 3 0 0 0 0 0 mostra 3.000,00 */
function bindMoney(root) {
  $$('.money-input input', root).forEach(inp => {
    inp.addEventListener('input', () => {
      const digits = inp.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
      const c = Number(digits || 0);
      inp.dataset.cents = c;
      inp.value = c ? F.plainMoney(c) : '';
    });
  });
}
const centsOf = inp => Number(inp.dataset.cents || 0);

function setMoney(inp, cents) {
  inp.dataset.cents = cents || 0;
  inp.value = cents ? F.plainMoney(cents) : '';
}

function dueDayOptions(selected) {
  let o = '';
  for (let d = 1; d <= 31; d++) o += `<option value="${d}" ${d === selected ? 'selected' : ''}>Dia ${d}</option>`;
  return o;
}

function invalid(el, msg) {
  alert(msg);
  if (el) el.focus();
  return false;
}

// ---------- TELA 1: HOJE ----------
function renderHoje() {
  const m = C.todayMetrics(S, today);
  const prevName = F.MESES[Number(F.addMonths(m.month, -1).slice(5, 7)) - 1];

  let hero;
  if (!m.hasSalary) {
    hero = `<div class="hero warn"><p class="hero-warn">Registre seu salário para calcular seu limite</p>
      <button class="btn-secondary" type="button" data-go="salario">Registrar salário</button></div>`;
  } else if (m.restante >= 0) {
    hero = `<div class="hero ok"><p class="hero-label">Você ainda pode gastar</p>
      <p class="hero-value">${F.money(m.restante)}</p><p class="hero-label">hoje</p></div>`;
  } else {
    hero = `<div class="hero over"><p class="hero-label">Você ainda pode gastar</p>
      <p class="hero-value">${F.money(m.restante)}</p>
      <p class="hero-over">Você passou ${F.money(-m.restante)} do limite de hoje</p></div>`;
  }

  let carryNote = '';
  if (m.carry > 0) carryNote = `<span class="row-sub">inclui ${F.money(m.carry)} que sobrou de ${prevName}</span>`;
  if (m.carry < 0) carryNote = `<span class="row-sub red">inclui ${F.money(m.carry)} que faltou em ${prevName}</span>`;

  const dash = '—';
  const summary = `<div class="group">
    <div class="row"><div class="row-main"><span class="row-title">Saldo em conta</span>${carryNote}</div>
      <span class="row-value ${m.saldoConta < 0 ? 'red' : ''}">${F.money(m.saldoConta)}</span></div>
    <div class="row"><div class="row-main"><span class="row-title">Fixos pendentes</span><span class="row-sub">reservado para as contas</span></div>
      <span class="row-value">${F.money(m.pendentes)}</span></div>
    <div class="row"><div class="row-main"><span class="row-title">Saldo livre do mês</span>
      <span class="row-sub">${plural(m.diasRestantes, 'dia restante', 'dias restantes')}, contando hoje</span></div>
      <span class="row-value ${m.hasSalary && m.livre < 0 ? 'red' : ''}">${m.hasSalary ? F.money(m.livre) : dash}</span></div>
    <div class="row"><span class="row-title">Limite do dia</span>
      <span class="row-value">${m.hasSalary ? F.money(m.limite) : dash}</span></div>
    <div class="row"><span class="row-title">Já gastei hoje</span>
      <span class="row-value">${F.money(m.spentToday)}</span></div>
  </div>`;

  const list = S.expenses.filter(e => e.date === today).sort((a, b) => a.createdAt - b.createdAt);
  const listHtml = list.length
    ? `<div class="group">${list.map(expenseRow).join('')}</div><p class="hint">Deslize um gasto para a esquerda para editar ou excluir.</p>`
    : '<p class="empty">Nenhum gasto hoje.</p>';

  const el = $('#tab-hoje');
  el.innerHTML = header('Hoje', F.longDate(today),
    `<button class="icon-btn" type="button" id="btn-ajustes" aria-label="Ajustes">${ICON.ajustes}</button>`) +
    hero + `<h3 class="section-title">Resumo</h3>` + summary +
    `<h3 class="section-title">Gastos de hoje</h3>` + listHtml;

  $('#btn-ajustes', el).addEventListener('click', openSettings);
  const go = $('[data-go]', el);
  if (go) go.addEventListener('click', () => goTab(go.dataset.go));
  bindSwipe(el, { onEdit: editExpense, onDelete: deleteExpense });
}

function expenseRow(e) {
  return swipeRow(e.id, `<div class="row-main"><span class="row-title">${esc(e.description)}</span>
    <span class="row-sub">${esc(e.category || 'Sem categoria')}</span></div>
    <span class="row-value">${F.money(e.amount)}</span>`);
}

function editExpense(id) {
  const e = S.expenses.find(x => x.id === id);
  if (e) openExpenseSheet(e);
}

function deleteExpense(id) {
  const e = S.expenses.find(x => x.id === id);
  if (!e || !confirm(`Excluir o gasto "${e.description}" de ${F.money(e.amount)}?`)) return;
  S.expenses = S.expenses.filter(x => x.id !== id);
  remove('expenses', id);
  render();
}

function openExpenseSheet(exp) {
  const isNew = !exp;
  const e = exp || { amount: 0, description: '', category: '', date: today };
  let category = e.category || '';

  openSheet({
    title: isNew ? 'Novo gasto' : 'Editar gasto',
    body: moneyField('amount', e.amount) +
      `<label class="field"><span class="field-label">Descrição</span>
        <input name="description" type="text" maxlength="60" placeholder="Ex.: almoço" value="${esc(e.description)}"></label>
      <div class="field"><span class="field-label">Categoria (opcional)</span>
        <div class="chips">${CATEGORIAS.map(c => `<button type="button" class="chip ${c === category ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div></div>
      <label class="field"><span class="field-label">Data</span>
        <input name="date" type="date" value="${e.date}" required></label>` +
      (isNew ? '' : '<button class="btn-danger" type="button" data-act="delete">Excluir gasto</button>'),
    onOpen(w, close) {
      bindMoney(w);
      $$('.chip', w).forEach(ch => ch.addEventListener('click', () => {
        category = category === ch.dataset.cat ? '' : ch.dataset.cat;
        $$('.chip', w).forEach(x => x.classList.toggle('on', x.dataset.cat === category));
      }));
      const del = $('[data-act=delete]', w);
      if (del) del.addEventListener('click', () => {
        if (!confirm('Excluir este gasto?')) return;
        S.expenses = S.expenses.filter(x => x.id !== e.id);
        remove('expenses', e.id);
        close();
        render();
      });
      if (isNew) $('input[name=amount]', w).focus();
    },
    onSave(w) {
      const amtInp = $('input[name=amount]', w);
      const amount = centsOf(amtInp);
      if (amount <= 0) return invalid(amtInp, 'Informe o valor do gasto.');
      const date = $('input[name=date]', w).value || today;
      const description = $('input[name=description]', w).value.trim() || category || 'Gasto';
      if (isNew) {
        const item = { id: newId(), amount, description, category, date, createdAt: Date.now() };
        S.expenses.push(item);
        save('expenses', item);
      } else {
        Object.assign(e, { amount, description, category, date });
        save('expenses', e);
      }
      render();
    },
  });
}

// ---------- TELA 2: CALENDÁRIO ----------
function renderCalendario() {
  const first = C.firstMonth(S, today);
  const cur = F.monthOf(today);
  if (calMonth > cur) calMonth = cur;
  if (calMonth < first) calMonth = first;

  const stats = C.monthDayStats(S, calMonth, today);
  const streak = C.greenStreak(S, today);

  const n = F.daysInMonth(calMonth);
  const blanks = F.firstWeekday(calMonth);
  let cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-wd">${d}</div>`).join('');
  for (let i = 0; i < blanks; i++) cells += '<div></div>';
  for (let d = 1; d <= n; d++) {
    const date = `${calMonth}-${F.pad(d)}`;
    const st = C.dayStatus(S, date, today);
    cells += `<button type="button" class="cal-day ${st} ${date === today ? 'today' : ''} ${date === calSelected ? 'sel' : ''}"
      data-date="${date}" aria-label="${F.fmtDate(date)}">${d}</button>`;
  }

  let detail = '';
  if (F.monthOf(calSelected) === calMonth) {
    const lim = C.limitForDay(S, calSelected, today);
    const spent = C.spentOnDay(S, calSelected);
    const st = C.dayStatus(S, calSelected, today);
    const label = { green: 'Dentro do limite', red: 'Passou do limite', gray: calSelected > today ? 'Dia futuro' : 'Sem dados' }[st];
    const list = S.expenses.filter(e => e.date === calSelected).sort((a, b) => a.createdAt - b.createdAt);
    detail = `<h3 class="section-title">${esc(F.longDate(calSelected))}</h3>
      <div class="group">
        <div class="row"><span class="row-title">Situação</span><span class="badge ${st}">${label}</span></div>
        <div class="row"><span class="row-title">Limite do dia</span><span class="row-value">${lim === null ? '—' : F.money(lim)}</span></div>
        <div class="row"><span class="row-title">Total gasto</span><span class="row-value ${st === 'red' ? 'red' : ''}">${F.money(spent)}</span></div>
      </div>` +
      (list.length ? `<div class="group">${list.map(expenseRow).join('')}</div>` : '<p class="empty">Nenhum gasto neste dia.</p>');
  }

  const el = $('#tab-calendario');
  el.innerHTML = header('Calendário', F.monthTitle(F.monthOf(today))) +
    `<div class="group stats">
      <p class="stats-main"><span class="green-text">${plural(stats.green, 'dia verde', 'dias verdes')}</span> / <span class="red-text">${plural(stats.red, 'dia vermelho', 'dias vermelhos')}</span></p>
      <p class="stats-sub">Sequência atual: <b>${plural(streak, 'dia verde', 'dias verdes')}</b> seguidos</p>
    </div>
    <div class="group cal">
      <div class="cal-nav">
        <button type="button" class="icon-btn" data-cal="-1" aria-label="Mês anterior" ${calMonth <= first ? 'disabled' : ''}>${ICON.prev}</button>
        <h2>${F.monthTitle(calMonth)}</h2>
        <button type="button" class="icon-btn" data-cal="1" aria-label="Próximo mês" ${calMonth >= cur ? 'disabled' : ''}>${ICON.next}</button>
      </div>
      <div class="cal-grid">${cells}</div>
    </div>` + detail;

  $$('[data-cal]', el).forEach(b => b.addEventListener('click', () => {
    calMonth = F.addMonths(calMonth, Number(b.dataset.cal));
    calSelected = calMonth === cur ? today : `${calMonth}-01`;
    render();
  }));
  $$('.cal-day', el).forEach(b => b.addEventListener('click', () => {
    calSelected = b.dataset.date;
    render();
  }));
  bindSwipe(el, { onEdit: editExpense, onDelete: deleteExpense });
}

// ---------- TELA 3: FIXOS ----------
function renderFixos() {
  const month = F.monthOf(today);
  const items = S.fixedMonths.filter(f => f.month === month).sort((a, b) => a.dueDay - b.dueDay);
  const flows = C.monthFlows(S, month);
  const total = flows.fixedTotal;
  const pct = flows.salary > 0 ? Math.round(total / flows.salary * 100) : null;
  const todayDay = F.dayOf(today);
  const last = F.daysInMonth(month);

  const rows = items.map(f => {
    const due = Math.min(f.dueDay, last);
    const overdue = !f.paid && todayDay > due;
    const sub = f.paid
      ? `<span class="row-sub green-text">Pago em ${F.fmtDate(f.paidDate)}</span>`
      : overdue
        ? `<span class="row-sub red">Venceu dia ${due} · não pago</span>`
        : `<span class="row-sub">Vence dia ${due}</span>`;
    return swipeRow(f.id, `
      <button type="button" class="check ${f.paid ? 'on' : ''}" data-stop data-toggle="${esc(f.id)}"
        role="checkbox" aria-checked="${f.paid}" aria-label="Pago: ${esc(f.name)}">${ICON.check}<span>Pago</span></button>
      <div class="row-main"><span class="row-title">${esc(f.name)}</span>${sub}</div>
      <span class="row-value ${overdue ? 'red' : ''}">${F.money(f.amount)}</span>`, overdue ? 'overdue' : '');
  }).join('');

  const el = $('#tab-fixos');
  el.innerHTML = header('Fixos', F.monthTitle(month)) +
    `<div class="group">
      <div class="row"><span class="row-title">Total pago</span><span class="row-value green-text">${F.money(flows.fixedPaid)}</span></div>
      <div class="row"><span class="row-title">Total pendente</span><span class="row-value">${F.money(flows.fixedPending)}</span></div>
      <div class="row"><div class="row-main"><span class="row-title">Salário comprometido</span>
        <span class="row-sub">${pct === null ? 'registre o salário para ver a porcentagem' : `${pct}% de ${F.money(flows.salary)} recebidos`}</span></div>
        <span class="row-value">${F.money(total)}</span></div>
    </div>
    <h3 class="section-title">Contas do mês</h3>` +
    (items.length ? `<div class="group">${rows}</div><p class="hint">Toque no círculo para marcar como pago. Deslize para a esquerda para editar ou excluir.</p>`
      : '<p class="empty">Nenhum gasto fixo cadastrado.</p>') +
    '<button class="btn-primary" type="button" id="btn-add-fixo">+ Adicionar fixo</button>';

  $$('[data-toggle]', el).forEach(b => b.addEventListener('click', () => togglePaid(b.dataset.toggle)));
  $('#btn-add-fixo', el).addEventListener('click', () => openFixedSheet(null));
  bindSwipe(el, {
    onEdit: id => openFixedSheet(S.fixedMonths.find(f => f.id === id)),
    onDelete: deleteFixed,
  });
}

function togglePaid(id) {
  const f = S.fixedMonths.find(x => x.id === id);
  if (!f) return;
  f.paid = !f.paid;
  f.paidDate = f.paid ? today : null;
  save('fixedMonths', f);
  render();
}

function deleteFixed(id) {
  const f = S.fixedMonths.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Excluir "${f.name}"? Ele deixa de aparecer neste mês e nos próximos. Os meses anteriores não mudam.`)) return;
  S.fixedMonths = S.fixedMonths.filter(x => x.id !== id);
  remove('fixedMonths', id);
  if (f.templateId) {
    S.fixedTemplates = S.fixedTemplates.filter(t => t.id !== f.templateId);
    remove('fixedTemplates', f.templateId);
  }
  render();
}

function openFixedSheet(inst) {
  const isNew = !inst;
  const f = inst || { name: '', amount: 0, dueDay: 10 };
  openSheet({
    title: isNew ? 'Novo gasto fixo' : 'Editar gasto fixo',
    body: `<label class="field"><span class="field-label">Nome</span>
        <input name="name" type="text" maxlength="40" placeholder="Ex.: aluguel" value="${esc(f.name)}"></label>` +
      moneyField('amount', f.amount) +
      `<label class="field"><span class="field-label">Dia de vencimento</span>
        <select name="dueDay">${dueDayOptions(f.dueDay)}</select></label>` +
      (isNew ? '' : '<button class="btn-danger" type="button" data-act="delete">Excluir gasto fixo</button>'),
    onOpen(w, close) {
      bindMoney(w);
      const del = $('[data-act=delete]', w);
      if (del) del.addEventListener('click', () => { close(); deleteFixed(f.id); });
      if (isNew) $('input[name=name]', w).focus();
    },
    onSave(w) {
      const nameInp = $('input[name=name]', w);
      const amtInp = $('input[name=amount]', w);
      const name = nameInp.value.trim();
      const amount = centsOf(amtInp);
      const dueDay = Number($('select[name=dueDay]', w).value);
      if (!name) return invalid(nameInp, 'Informe o nome do gasto fixo.');
      if (amount <= 0) return invalid(amtInp, 'Informe o valor do gasto fixo.');
      const month = F.monthOf(today);
      if (isNew) {
        const t = { id: newId(), name, amount, dueDay, createdMonth: month };
        const m = { id: newId(), templateId: t.id, month, name, amount, dueDay, paid: false, paidDate: null };
        S.fixedTemplates.push(t);
        S.fixedMonths.push(m);
        save('fixedTemplates', t);
        save('fixedMonths', m);
      } else {
        Object.assign(f, { name, amount, dueDay });
        save('fixedMonths', f);
        const t = S.fixedTemplates.find(x => x.id === f.templateId);
        if (t) { Object.assign(t, { name, amount, dueDay }); save('fixedTemplates', t); }
      }
      render();
    },
  });
}

// ---------- TELA 4: SALÁRIO ----------
let incomeType = 'Salário';

function renderSalario() {
  const month = F.monthOf(today);
  const list = S.incomes.filter(i => F.monthOf(i.date) === month).sort((a, b) => a.date.localeCompare(b.date));
  const total = list.reduce((t, i) => t + i.amount, 0);
  const received = list.some(i => i.type === 'Salário');
  const mesNome = F.MESES[Number(month.slice(5, 7)) - 1];

  const status = received
    ? `<div class="status ok">${ICON.check}<span>Salário de ${mesNome} recebido</span></div>`
    : `<div class="status pending"><span>Salário de ${mesNome} ainda não recebido</span></div>`;

  const rows = list.map(i => swipeRow(i.id, `<div class="row-main"><span class="row-title">${esc(i.type)}</span>
    <span class="row-sub">Recebido em ${F.fmtDate(i.date)}</span></div>
    <span class="row-value green-text">${F.money(i.amount)}</span>`)).join('');

  const el = $('#tab-salario');
  el.innerHTML = header('Salário', F.monthTitle(month)) + status +
    `<div class="group form-group">
      <div class="segmented">${TIPOS_RENDA.map(t => `<button type="button" class="${t === incomeType ? 'on' : ''}" data-type="${t}">${t}</button>`).join('')}</div>
      ${moneyField('amount', incomeType === 'Salário' ? S.settings.salaryDefault : 0, 'Valor recebido')}
      <button class="btn-primary" type="button" id="btn-recebi">Recebi</button>
    </div>
    <div class="group"><div class="row"><span class="row-title">Total recebido em ${mesNome}</span>
      <span class="row-value">${F.money(total)}</span></div></div>
    <h3 class="section-title">Entradas do mês</h3>` +
    (list.length ? `<div class="group">${rows}</div><p class="hint">Deslize uma entrada para a esquerda para editar ou excluir.</p>`
      : '<p class="empty">Nenhuma entrada registrada neste mês.</p>');

  bindMoney(el);
  const amtInp = $('input[name=amount]', el);
  $$('[data-type]', el).forEach(b => b.addEventListener('click', () => {
    incomeType = b.dataset.type;
    $$('[data-type]', el).forEach(x => x.classList.toggle('on', x.dataset.type === incomeType));
    setMoney(amtInp, incomeType === 'Salário' ? S.settings.salaryDefault : 0);
  }));
  $('#btn-recebi', el).addEventListener('click', () => {
    const amount = centsOf(amtInp);
    if (amount <= 0) return invalid(amtInp, 'Informe o valor recebido.');
    const item = { id: newId(), type: incomeType, amount, date: today };
    S.incomes.push(item);
    save('incomes', item);
    if (incomeType === 'Salário' && S.settings.salaryDefault !== amount) {
      S.settings.salaryDefault = amount;
      save('settings', S.settings);
    }
    render();
  });
  bindSwipe(el, {
    onEdit: id => openIncomeSheet(S.incomes.find(i => i.id === id)),
    onDelete: deleteIncome,
  });
}

function deleteIncome(id) {
  const i = S.incomes.find(x => x.id === id);
  if (!i || !confirm(`Excluir a entrada "${i.type}" de ${F.money(i.amount)}?`)) return;
  S.incomes = S.incomes.filter(x => x.id !== id);
  remove('incomes', id);
  render();
}

function openIncomeSheet(inc) {
  let type = inc.type;
  openSheet({
    title: 'Editar entrada',
    body: `<div class="field"><span class="field-label">Tipo</span>
        <div class="segmented">${TIPOS_RENDA.map(t => `<button type="button" class="${t === type ? 'on' : ''}" data-type="${t}">${t}</button>`).join('')}</div></div>` +
      moneyField('amount', inc.amount) +
      `<label class="field"><span class="field-label">Data do recebimento</span>
        <input name="date" type="date" value="${inc.date}" required></label>
      <button class="btn-danger" type="button" data-act="delete">Excluir entrada</button>`,
    onOpen(w, close) {
      bindMoney(w);
      $$('[data-type]', w).forEach(b => b.addEventListener('click', () => {
        type = b.dataset.type;
        $$('[data-type]', w).forEach(x => x.classList.toggle('on', x.dataset.type === type));
      }));
      $('[data-act=delete]', w).addEventListener('click', () => { close(); deleteIncome(inc.id); });
    },
    onSave(w) {
      const amtInp = $('input[name=amount]', w);
      const amount = centsOf(amtInp);
      if (amount <= 0) return invalid(amtInp, 'Informe o valor recebido.');
      inc.type = type;
      inc.amount = amount;
      inc.date = $('input[name=date]', w).value || inc.date;
      save('incomes', inc);
      render();
    },
  });
}

// ---------- TELA 5: HISTÓRICO ----------
function renderHistorico() {
  const rows = C.historyRows(S, today);
  const cur = F.monthOf(today);
  const cards = rows.map(r => `<div class="group hist">
    <div class="hist-title">${F.monthTitle(r.month)}${r.month === cur ? '<span class="tag">mês atual</span>' : ''}</div>
    <table class="hist-table"><tbody>
      <tr><th>Sobra do mês anterior</th><td>${F.money(r.carry)}</td></tr>
      <tr><th>Salário</th><td>${F.money(r.salary)}</td></tr>
      <tr><th>Total de fixos</th><td>${F.money(r.fixed)}</td></tr>
      <tr><th>Total de flexíveis</th><td>${F.money(r.flex)}</td></tr>
      <tr><th>Total gasto</th><td>${F.money(r.total)}</td></tr>
      <tr class="strong"><th>Sobrou</th><td class="${r.sobra < 0 ? 'red' : 'green-text'}">${F.money(r.sobra)}</td></tr>
      <tr><th>Dias verdes</th><td class="green-text">${r.green}</td></tr>
      <tr><th>Dias vermelhos</th><td class="red">${r.red}</td></tr>
    </tbody></table></div>`).join('');

  const el = $('#tab-historico');
  el.innerHTML = header('Histórico', 'Resumo por mês') +
    '<button class="btn-primary" type="button" id="btn-export">Exportar planilha</button>' +
    '<p class="hint">Total de fixos considera as contas já pagas. A sobra passa para o mês seguinte.</p>' + cards;
  $('#btn-export', el).addEventListener('click', exportSpreadsheet);
}

function exportSpreadsheet() {
  const resumo = C.historyRows(S, today).reverse();
  const lanc = [
    ...S.incomes.map(i => ({ date: i.date, desc: i.type, cat: '', tipo: 'Salário', v: i.amount, pago: '', pd: '' })),
    ...S.fixedMonths.map(f => ({
      date: F.dateInMonth(f.month, f.dueDay), desc: f.name, cat: '', tipo: 'Fixo', v: f.amount,
      pago: f.paid ? 'Sim' : 'Não', pd: f.paidDate || '',
    })),
    ...S.expenses.map(e => ({ date: e.date, desc: e.description, cat: e.category || '', tipo: 'Flexível', v: e.amount, pago: '', pd: '' })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const bytes = buildXlsx([
    {
      name: 'Resumo mensal',
      columns: [
        { header: 'Mês', width: 20 }, { header: 'Sobra do mês anterior', type: 'money', width: 20 },
        { header: 'Salário', type: 'money', width: 15 }, { header: 'Gastos fixos', type: 'money', width: 15 },
        { header: 'Gastos flexíveis', type: 'money', width: 17 }, { header: 'Total gasto', type: 'money', width: 15 },
        { header: 'Sobra', type: 'money', width: 15 }, { header: 'Dias verdes', type: 'int', width: 12 },
        { header: 'Dias vermelhos', type: 'int', width: 15 },
      ],
      rows: resumo.map(r => [F.monthTitle(r.month), r.carry, r.salary, r.fixed, r.flex, r.total, r.sobra, r.green, r.red]),
    },
    {
      name: 'Lançamentos',
      columns: [
        { header: 'Data', type: 'date', width: 12 }, { header: 'Descrição', width: 28 },
        { header: 'Categoria', width: 14 }, { header: 'Tipo', width: 11 },
        { header: 'Valor', type: 'money', width: 14 }, { header: 'Pago', width: 8 },
        { header: 'Data do pagamento', type: 'date', width: 18 },
      ],
      rows: lanc.map(l => [l.date, l.desc, l.cat, l.tipo, l.v, l.pago, l.pd]),
    },
  ]);

  const file = new File([bytes], 'Controle-Financeiro.xlsx', { type: XLSX_MIME });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Controle Financeiro' }).catch(err => {
      if (err && err.name !== 'AbortError') downloadFile(file);
    });
  } else {
    downloadFile(file);
  }
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- AJUSTES ----------
function openSettings() {
  openSheet({
    title: 'Ajustes',
    cancelLabel: 'Fechar',
    body: moneyField('salary', S.settings.salaryDefault, 'Salário mensal') +
      '<button class="btn-primary" type="button" data-act="salary">Salvar salário</button>' +
      '<button class="btn-secondary" type="button" data-act="fixos">Editar gastos fixos</button>' +
      '<p class="hint">O salário mensal é o valor que já vem preenchido na aba Salário.</p>' +
      '<button class="btn-danger" type="button" data-act="reset">Apagar todos os dados</button>',
    onOpen(w, close) {
      bindMoney(w);
      $('[data-act=salary]', w).addEventListener('click', () => {
        S.settings.salaryDefault = centsOf($('input[name=salary]', w));
        save('settings', S.settings);
        close();
        render();
      });
      $('[data-act=fixos]', w).addEventListener('click', () => { close(); goTab('fixos'); });
      $('[data-act=reset]', w).addEventListener('click', async () => {
        if (!confirm('Apagar TODOS os dados do app? Isso não pode ser desfeito.')) return;
        if (!confirm('Tem certeza? Exporte a planilha antes, se quiser guardar o histórico.')) return;
        await DB.clearAll();
        location.reload();
      });
    },
  });
}

// ---------- CONFIGURAÇÃO INICIAL ----------
function showWizard() {
  const wiz = { step: 1, salary: 0, received: false, fixos: [] };
  const box = document.createElement('div');
  box.id = 'wizard';
  document.body.appendChild(box);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  const draw = () => {
    let html = `<div class="wiz-steps">${[1, 2, 3].map(s => `<span class="${s <= wiz.step ? 'on' : ''}"></span>`).join('')}</div>`;
    if (wiz.step === 1) {
      html += `<h1>Boas-vindas!</h1><p class="wiz-text">Vamos configurar seu controle financeiro em 3 passos.</p>` +
        (standalone ? '' : '<p class="wiz-tip">Dica: instale o app pela Tela de Início antes de configurar. Os dados do Safari e do app instalado ficam separados.</p>') +
        moneyField('salary', wiz.salary, 'Quanto é o seu salário mensal?') +
        `<label class="toggle-row"><input type="checkbox" name="received" ${wiz.received ? 'checked' : ''}>
          <span>Já recebi o salário deste mês</span></label>
        <button class="btn-primary" type="button" data-next>Continuar</button>`;
    } else if (wiz.step === 2) {
      const total = wiz.fixos.reduce((t, f) => t + f.amount, 0);
      html += `<h1>Gastos fixos</h1><p class="wiz-text">Contas que se repetem todo mês: aluguel, internet, luz…</p>
        <div class="group form-group">
          <label class="field"><span class="field-label">Nome</span><input name="fname" type="text" maxlength="40" placeholder="Ex.: aluguel"></label>
          ${moneyField('famount', 0)}
          <label class="field"><span class="field-label">Dia de vencimento</span><select name="fday">${dueDayOptions(10)}</select></label>
          <button class="btn-secondary" type="button" data-addfixo>+ Adicionar à lista</button>
        </div>` +
        (wiz.fixos.length ? `<div class="group">${wiz.fixos.map((f, i) => `<div class="row">
            <div class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-sub">Vence dia ${f.dueDay}</span></div>
            <span class="row-value">${F.money(f.amount)}</span>
            <button type="button" class="remove-btn" data-rm="${i}" aria-label="Remover ${esc(f.name)}">×</button></div>`).join('')}
            <div class="row"><span class="row-title">Total</span><span class="row-value">${F.money(total)}</span></div></div>`
          : '<p class="empty">Nenhum gasto fixo ainda. Você pode adicionar depois.</p>') +
        `<div class="wiz-buttons"><button class="btn-secondary" type="button" data-back>Voltar</button>
          <button class="btn-primary" type="button" data-next>Continuar</button></div>`;
    } else {
      const total = wiz.fixos.reduce((t, f) => t + f.amount, 0);
      html += `<h1>Tudo pronto</h1>
        <div class="group">
          <div class="row"><span class="row-title">Salário mensal</span><span class="row-value">${F.money(wiz.salary)}</span></div>
          <div class="row"><span class="row-title">Salário deste mês</span><span class="row-value">${wiz.received ? 'Recebido' : 'Ainda não recebido'}</span></div>
          <div class="row"><span class="row-title">${plural(wiz.fixos.length, 'gasto fixo', 'gastos fixos')}</span><span class="row-value">${F.money(total)}</span></div>
        </div>
        <p class="wiz-text">Tudo isso pode ser alterado depois em Ajustes.</p>
        <div class="wiz-buttons"><button class="btn-secondary" type="button" data-back>Voltar</button>
          <button class="btn-primary" type="button" data-finish>Começar</button></div>`;
    }
    box.innerHTML = `<div class="wiz-inner">${html}</div>`;
    bindMoney(box);

    const next = $('[data-next]', box);
    if (next) next.addEventListener('click', () => {
      if (wiz.step === 1) {
        const inp = $('input[name=salary]', box);
        wiz.salary = centsOf(inp);
        wiz.received = $('input[name=received]', box).checked;
        if (wiz.salary <= 0) return invalid(inp, 'Informe o valor do seu salário.');
      }
      wiz.step++;
      draw();
    });
    const back = $('[data-back]', box);
    if (back) back.addEventListener('click', () => { wiz.step--; draw(); });

    const add = $('[data-addfixo]', box);
    if (add) add.addEventListener('click', () => {
      const nameInp = $('input[name=fname]', box);
      const amtInp = $('input[name=famount]', box);
      const name = nameInp.value.trim();
      const amount = centsOf(amtInp);
      if (!name) return invalid(nameInp, 'Informe o nome do gasto fixo.');
      if (amount <= 0) return invalid(amtInp, 'Informe o valor do gasto fixo.');
      wiz.fixos.push({ name, amount, dueDay: Number($('select[name=fday]', box).value) });
      draw();
    });
    $$('[data-rm]', box).forEach(b => b.addEventListener('click', () => {
      wiz.fixos.splice(Number(b.dataset.rm), 1);
      draw();
    }));

    const finish = $('[data-finish]', box);
    if (finish) finish.addEventListener('click', () => {
      const month = F.monthOf(today);
      S.settings = { key: 'main', setupDone: true, setupDate: today, salaryDefault: wiz.salary };
      save('settings', S.settings);
      for (const f of wiz.fixos) {
        const t = { id: newId(), name: f.name, amount: f.amount, dueDay: f.dueDay, createdMonth: month };
        S.fixedTemplates.push(t);
        save('fixedTemplates', t);
      }
      if (wiz.received) {
        const inc = { id: newId(), type: 'Salário', amount: wiz.salary, date: today };
        S.incomes.push(inc);
        save('incomes', inc);
      }
      box.remove();
      startDay();
      render();
    });
  };
  draw();
}

init();
