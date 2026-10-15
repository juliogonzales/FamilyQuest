'use strict';
/* =====================================================================
   FamilyQuest — lógica do app (JavaScript Vanilla ES6+)
   Estrutura:
     1. Utilitários            5. Regras de negócio (tarefas/pontos/penalidade)
     2. Camada de sincronização 6. Views (Perfis, PIN, Pais, Filhas)
     3. Estado + localStorage   7. Ações e formulários
     4. Cálculo de pontos       8. Inicialização / PWA
   ===================================================================== */

/* ---------- 1. Utilitários ---------- */
const KEY = 'familyquest.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const dKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => new Date(k + 'T00:00:00');
const fmtDate = (k) => { const [, m, d] = k.split('-'); return `${d}/${m}`; };
const fmtDateTime = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const AVATARS = ['🦄', '🐱', '🐼', '🦊', '🐸', '🦋', '🐯', '🐙'];
// Hash simples só para não guardar o PIN em texto puro. (localStorage não é um cofre:
// quem tem acesso técnico ao aparelho consegue alterar dados. Serve para barrar as crianças.)
const hashPin = (p) => { let h = 5381; for (const c of 'fq:' + p) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

const startOfWeek = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/* ---------- 2. Camada de sincronização (ponto de extensão) ----------
   Hoje o app funciona 100% local. Para sincronizar vários aparelhos na
   mesma rede Wi-Fi, implemente aqui. Ideias:

   (a) WebSocket + servidor Node.js local (ex.: PC/Raspberry em 192.168.0.10):
       const ws = new WebSocket('ws://192.168.0.10:3000');
       Sync.push = (state) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'state', state, at: Date.now() }));
       ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'state') Sync.receive(m.state); };
       // No servidor: guarde o último estado e faça broadcast para os demais clientes.

   (b) API REST local (Express): fetch('http://192.168.0.10:3000/state', { method: 'PUT', body: JSON.stringify(state) })
       e um setInterval de GET para atualizar.

   (c) Supabase (nuvem, tempo real): crie a tabela `family_state (id, data jsonb)` e use
       supabase.channel('fq').on('postgres_changes', { event: '*', schema: 'public', table: 'family_state' },
         (p) => Sync.receive(p.new.data)).subscribe();
       Para produção, prefira tabelas separadas (tasks, ledger...) em vez de um único JSON,
       e use Auth + RLS para proteger os dados.

   Dica: ao receber estado remoto, resolva conflitos por `updatedAt` ou por entrada
   (ledger e notifications só crescem, então podem ser mesclados por id). */
const Sync = {
  push(/* state */) { /* TODO: enviar estado ao servidor (WebSocket/API/Supabase) */ },
  receive(remote) { // chame quando chegar estado de outro aparelho
    if (!remote || !Array.isArray(remote.tasks)) return;
    Store.state = migrate(remote);
    Store.persistOnly();
    render();
  },
};

/* ---------- 3. Estado + localStorage ---------- */
const defaults = () => ({
  v: 1,
  settings: { pin: hashPin('1234'), penaltyPercent: 100, autoApprove: false },
  kids: [
    { id: 'k1', name: 'Filha 1', avatar: '🦄', seen: [] },
    { id: 'k2', name: 'Filha 2', avatar: '🐱', seen: [] },
  ],
  tasks: [],
  rewards: [
    { id: uid(), name: 'Parque', emoji: '🎡', minPoints: 150 },
    { id: uid(), name: 'Rodízio Japonês', emoji: '🍣', minPoints: 300 },
    { id: uid(), name: 'Churrasco', emoji: '🍖', minPoints: 500 },
  ],
  ledger: [],        // {id,kidId,points,at,reason,type,taskId}  → fonte da verdade dos pontos
  notifications: [], // {id,at,type,text,kidId,taskId,read}
});

function migrate(d) {
  const base = defaults();
  const out = Object.assign(base, d || {});
  out.settings = Object.assign(defaults().settings, (d && d.settings) || {});
  ['kids', 'tasks', 'rewards', 'ledger', 'notifications'].forEach((k) => { if (!Array.isArray(out[k])) out[k] = base[k]; });
  out.kids.forEach((k) => { if (!Array.isArray(k.seen)) k.seen = []; });
  return out;
}

const Store = {
  state: null,
  load() {
    try { const raw = localStorage.getItem(KEY); this.state = raw ? migrate(JSON.parse(raw)) : defaults(); }
    catch (e) { console.warn('Falha ao ler dados, usando padrão', e); this.state = defaults(); }
  },
  persistOnly() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
    catch (e) { toast('⚠️ Não foi possível salvar (armazenamento cheio?)'); }
  },
  save() { this.persistOnly(); Sync.push(this.state); },
};

const S = () => Store.state;
const kidOf = (id) => S().kids.find((k) => k.id === id) || { id, name: '?', avatar: '👤', seen: [] };
const taskOf = (id) => S().tasks.find((t) => t.id === id);

/* ---------- 4. Cálculo de pontos ---------- */
const sumFrom = (kidId, from) => S().ledger.filter((l) => l.kidId === kidId && new Date(l.at) >= from).reduce((a, l) => a + l.points, 0);
const weekPts = (kidId) => sumFrom(kidId, startOfWeek());
const monthPts = (kidId) => sumFrom(kidId, startOfMonth());
const sortedRewards = () => [...S().rewards].sort((a, b) => a.minPoints - b.minPoints);
// Próxima meta: primeiro prêmio ainda não atingido; se todos atingidos, o maior.
function goalFor(kidId) {
  const pts = monthPts(kidId), rs = sortedRewards();
  return rs.find((r) => pts < r.minPoints) || rs[rs.length - 1] || null;
}
const level = (pts) => Math.max(1, Math.floor(Math.max(0, pts) / 100) + 1);

/* ---------- 5. Regras de negócio ---------- */
function notify(type, text, extra = {}) {
  S().notifications.unshift({ id: uid(), at: new Date().toISOString(), type, text, kidId: extra.kidId || null, taskId: extra.taskId || null, read: false });
  S().notifications = S().notifications.slice(0, 300);
}

function addLedger(kidId, points, reason, type, taskId = null) {
  const before = monthPts(kidId);
  S().ledger.push({ id: uid(), kidId, points, at: new Date().toISOString(), reason, type, taskId });
  const after = monthPts(kidId);
  sortedRewards().forEach((r) => {
    if (before < r.minPoints && after >= r.minPoints) notify('reward', `🎉 ${kidOf(kidId).name} desbloqueou "${r.name}" (${r.minPoints} pts)!`, { kidId });
  });
}

const penaltyFor = (t) => Math.round(t.points * (S().settings.penaltyPercent / 100));
const endOf = (t) => new Date(`${t.date}T${t.end || '23:59'}:${t.end ? '00' : '59'}`);
const startOf = (t) => new Date(`${t.date}T${t.start || '00:00'}:00`);

function completeTask(id) {
  const t = taskOf(id);
  if (!t || t.status !== 'pending') return;
  if (new Date() > endOf(t)) { toast('⏰ O prazo dessa tarefa já acabou'); sweep(); render(); return; }
  t.status = 'done';
  t.doneAt = new Date().toISOString(); // hora exata do check-in
  notify('done', `✋ ${kidOf(t.kidId).name} concluiu "${t.title}" às ${fmtDateTime(t.doneAt).slice(6)}`, { kidId: t.kidId, taskId: t.id });
  if (S().settings.autoApprove) approveTask(id, true);
  Store.save();
  confetti(80);
  toast(S().settings.autoApprove ? `⭐ +${t.points} pontos!` : '🕐 Enviado para aprovação dos pais!');
  render();
}

function approveTask(id, auto = false) {
  const t = taskOf(id);
  if (!t || t.status !== 'done') return;
  t.status = 'approved';
  t.approvedAt = new Date().toISOString();
  addLedger(t.kidId, t.points, `Tarefa: ${t.title}`, 'task', t.id);
  notify('approved', `✅ "${t.title}" de ${kidOf(t.kidId).name} ${auto ? 'aprovada automaticamente' : 'aprovada'} (+${t.points} pts)`, { kidId: t.kidId, taskId: t.id });
  if (!auto) { Store.save(); toast('✅ Aprovada!'); render(); }
}

function rejectTask(id) {
  const t = taskOf(id);
  if (!t || t.status !== 'done') return;
  t.status = 'pending'; // volta para refazer (se ainda houver prazo)
  t.rejected = true;
  t.doneAt = null;
  notify('rejected', `↩️ "${t.title}" de ${kidOf(t.kidId).name} voltou para refazer`, { kidId: t.kidId, taskId: t.id });
  Store.save(); toast('↩️ Devolvida para refazer'); render();
}

/* Penalidade automática: tarefa pendente cujo horário limite passou → expira e desconta pontos. */
function sweep() {
  const now = new Date(); let changed = false;
  S().tasks.forEach((t) => {
    if (t.status === 'pending' && now > endOf(t)) {
      t.status = 'expired'; t.expiredAt = now.toISOString();
      const p = penaltyFor(t);
      if (p > 0) addLedger(t.kidId, -p, `Penalidade: ${t.title}`, 'penalty', t.id);
      notify('expired', `❌ "${t.title}" de ${kidOf(t.kidId).name} expirou sem conclusão${p > 0 ? ` (−${p} pts)` : ''}`, { kidId: t.kidId, taskId: t.id });
      changed = true;
    }
  });
  if (changed) Store.save();
  return changed;
}

/* ---------- Efeitos: toast e confete ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function confetti(n = 140) {
  const c = $('#confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#38bdf8', '#fde047'];
  const ps = Array.from({ length: n }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4,
    rot: Math.random() * 6, vr: -0.25 + Math.random() * 0.5,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  let f = 0;
  (function step() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    if (++f < 240) requestAnimationFrame(step); else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

/* ---------- 6. Views ---------- */
const ui = { tab: 'dash', kidTab: 'today', pin: '', pinError: false, filterKid: 'all', filterStatus: 'all' };
const getSession = () => { try { return JSON.parse(sessionStorage.getItem('fq.session')); } catch { return null; } };
const setSession = (s) => (s ? sessionStorage.setItem('fq.session', JSON.stringify(s)) : sessionStorage.removeItem('fq.session'));
const getLock = () => { try { return JSON.parse(localStorage.getItem('fq.lock')) || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } };
const lockLeft = () => Math.max(0, Math.ceil((getLock().until - Date.now()) / 1000));

const STATUS = {
  pending: { l: 'Pendente', i: '⏳', c: 'bg-amber-100 text-amber-800' },
  done: { l: 'Aguardando aprovação', i: '🕐', c: 'bg-sky-100 text-sky-800' },
  approved: { l: 'Aprovada', i: '✅', c: 'bg-emerald-100 text-emerald-800' },
  expired: { l: 'Expirada', i: '❌', c: 'bg-rose-100 text-rose-800' },
};

const bar = (val, max) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return `<div class="bar ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>`;
};

function timeInfo(t) {
  const now = new Date(), e = endOf(t), s = startOf(t);
  const m = Math.round((e - now) / 60000);
  if (m <= 0) return { txt: 'Tempo esgotado', cls: 'text-rose-600', urgent: false };
  const left = m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`;
  if (now < s) return { txt: `Começa às ${t.start} · janela livre`, cls: 'text-slate-500', urgent: false };
  const urgent = m <= 30 && t.date === dKey();
  return { txt: `⏱ Faltam ${left}`, cls: urgent ? 'text-rose-600 font-bold' : 'text-emerald-600', urgent };
}

function taskCard(t, mode) {
  const k = kidOf(t.kidId), st = STATUS[t.status] || STATUS.pending;
  const ti = t.status === 'pending' ? timeInfo(t) : null;
  const isKid = mode === 'kid';
  let actions = '';
  if (isKid && t.status === 'pending') {
    actions = `<button class="btn btn-ok btn-block mt-3" data-act="complete" data-id="${t.id}">✔ Concluir tarefa</button>`;
  } else if (!isKid) {
    if (t.status === 'done') actions += `<button class="btn btn-ok btn-sm" data-act="approve" data-id="${t.id}">✅ Aprovar</button><button class="btn btn-ghost btn-sm" data-act="reject" data-id="${t.id}">↩️ Refazer</button>`;
    actions += `<button class="btn btn-danger btn-sm" data-act="delTask" data-id="${t.id}">🗑</button>`;
    actions = `<div class="flex flex-wrap gap-2 mt-3">${actions}</div>`;
  }
  return `
  <div class="card fade-in ${ti && ti.urgent && isKid ? 'pulse-alert' : ''}">
    <div class="flex items-start gap-3">
      <div class="text-3xl leading-none">${esc(t.emoji || '📝')}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-extrabold text-slate-800 leading-tight">${esc(t.title)}</h3>
          <span class="chip bg-violet-100 text-violet-700 shrink-0">⭐ ${t.points}</span>
        </div>
        ${t.desc ? `<p class="text-sm text-slate-500 mt-0.5">${esc(t.desc)}</p>` : ''}
        <div class="flex flex-wrap items-center gap-1.5 mt-2">
          <span class="chip ${st.c}">${st.i} ${st.l}</span>
          ${!isKid ? `<span class="chip bg-slate-100 text-slate-600">${esc(k.avatar)} ${esc(k.name)}</span>` : ''}
          <span class="chip bg-slate-100 text-slate-600">📅 ${fmtDate(t.date)} · ${esc(t.start)}–${esc(t.end)}</span>
          ${t.rejected && t.status === 'pending' ? '<span class="chip bg-orange-100 text-orange-700">↩️ refazer</span>' : ''}
        </div>
        ${ti ? `<p class="text-xs mt-2 ${ti.cls}">${ti.txt}${isKid ? ` · perde ${penaltyFor(t)} pts se não concluir` : ''}</p>` : ''}
        ${t.doneAt ? `<p class="text-xs mt-1 text-sky-600">Concluída em ${fmtDateTime(t.doneAt)}</p>` : ''}
        ${actions}
      </div>
    </div>
  </div>`;
}

/* ----- Tela: seleção de perfil ----- */
function viewProfiles() {
  return `
  <div class="min-h-screen flex flex-col items-center justify-center p-6 fade-in">
    <div class="text-7xl wiggle">🏆</div>
    <h1 class="text-4xl font-black mt-2 bg-gradient-to-r from-violet-600 to-pink-500 bg-clip-text text-transparent">FamilyQuest</h1>
    <p class="text-slate-500 mt-1 mb-8 font-semibold">Quem vai jogar hoje?</p>
    <div class="w-full max-w-xs space-y-3">
      ${S().kids.map((k) => `
        <button class="card w-full flex items-center gap-4 text-left active:scale-95 transition" data-act="loginKid" data-id="${k.id}">
          <span class="text-5xl">${esc(k.avatar)}</span>
          <span><span class="block text-xl font-extrabold">${esc(k.name)}</span><span class="text-sm text-slate-500">⭐ ${Math.max(0, monthPts(k.id))} pts no mês</span></span>
        </button>`).join('')}
      <button class="card w-full flex items-center gap-4 text-left active:scale-95 transition !bg-violet-50" data-act="loginParent">
        <span class="text-5xl">🔒</span>
        <span><span class="block text-xl font-extrabold">Pais / Gestores</span><span class="text-sm text-slate-500">Acesso com PIN</span></span>
      </button>
    </div>
  </div>`;
}

/* ----- Tela: PIN ----- */
function viewPin() {
  const left = lockLeft();
  const dots = [0, 1, 2, 3].map((i) => `<span class="pin-dot ${i < ui.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'del'].map((k) =>
    k === 'back' ? `<button class="key !text-base" data-act="logout">Voltar</button>`
      : k === 'del' ? `<button class="key" data-act="pinKey" data-k="del">⌫</button>`
        : `<button class="key" data-act="pinKey" data-k="${k}">${k}</button>`).join('');
  return `
  <div class="min-h-screen flex flex-col items-center justify-center p-6 fade-in">
    <div class="text-5xl">🔒</div>
    <h2 class="text-2xl font-black mt-2">Área dos Pais</h2>
    <p class="text-slate-500 text-sm mb-6">${left > 0 ? `Muitas tentativas. Aguarde ${left}s` : ui.pinError ? '<span class="text-rose-600 font-bold">PIN incorreto, tente de novo</span>' : 'Digite o PIN de 4 dígitos'}</p>
    <div class="flex gap-4 mb-8 ${ui.pinError ? 'shake' : ''}">${dots}</div>
    <div class="grid grid-cols-3 gap-3 w-full max-w-xs ${left > 0 ? 'opacity-40 pointer-events-none' : ''}">${keys}</div>
  </div>`;
}

/* ----- Tela: Pais ----- */
function viewParent() {
  const unread = S().notifications.filter((n) => !n.read).length;
  const tabs = [['dash', '🏠', 'Painel'], ['tasks', '➕', 'Tarefas'], ['rewards', '🎁', 'Prêmios'], ['feed', '🔔', 'Avisos'], ['settings', '⚙️', 'Ajustes']];
  const body = { dash: pDash, tasks: pTasks, rewards: pRewards, feed: pFeed, settings: pSettings }[ui.tab]();
  return `
  <header class="px-4 pt-4 pb-2 flex items-center justify-between">
    <div><p class="text-xs font-bold text-violet-500">FamilyQuest</p><h1 class="text-2xl font-black">Painel dos Pais 👨‍👩‍👧</h1></div>
    <button class="btn btn-ghost btn-sm" data-act="logout">Sair</button>
  </header>
  <main class="px-4 pb-28 pt-2 space-y-4 fade-in">${body}</main>
  <nav class="bottom-nav"><div class="flex">
    ${tabs.map(([id, ic, lb]) => `<button class="nav-btn ${ui.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}"><span class="ico">${ic}</span>${lb}${id === 'feed' && unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`).join('')}
  </div></nav>`;
}

function pDash() {
  const today = dKey();
  const waiting = S().tasks.filter((t) => t.status === 'done');
  let h = '';
  if (waiting.length) h += `<section><h2 class="font-extrabold mb-2">🕐 Aguardando sua aprovação (${waiting.length})</h2><div class="space-y-3">${waiting.map((t) => taskCard(t, 'parent')).join('')}</div></section>`;
  h += S().kids.map((k) => {
    const kt = S().tasks.filter((t) => t.kidId === k.id);
    const c = (s) => kt.filter((t) => t.status === s).length;
    const goal = goalFor(k.id), mp = monthPts(k.id);
    const activeToday = kt.filter((t) => t.status === 'pending' && t.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 4);
    return `
    <section class="card">
      <div class="flex items-center gap-3">
        <span class="text-4xl">${esc(k.avatar)}</span>
        <div class="flex-1"><h3 class="text-lg font-black">${esc(k.name)}</h3><p class="text-xs text-slate-500">Nível ${level(mp)} · semana ⭐ ${weekPts(k.id)} · mês ⭐ ${mp}</p></div>
      </div>
      ${goal ? `<div class="mt-3"><div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${esc(goal.emoji)} ${esc(goal.name)}</span><span>${Math.max(0, mp)}/${goal.minPoints}</span></div>${bar(mp, goal.minPoints)}</div>` : '<p class="text-xs text-slate-400 mt-3">Cadastre prêmios na aba 🎁</p>'}
      <div class="grid grid-cols-4 gap-2 mt-3 text-center">
        <div class="rounded-xl bg-amber-50 p-2"><div class="text-lg font-black text-amber-700">${c('pending')}</div><div class="text-[10px] font-bold text-amber-700">Pendentes</div></div>
        <div class="rounded-xl bg-sky-50 p-2"><div class="text-lg font-black text-sky-700">${c('done')}</div><div class="text-[10px] font-bold text-sky-700">Aprovar</div></div>
        <div class="rounded-xl bg-emerald-50 p-2"><div class="text-lg font-black text-emerald-700">${c('approved')}</div><div class="text-[10px] font-bold text-emerald-700">Concluídas</div></div>
        <div class="rounded-xl bg-rose-50 p-2"><div class="text-lg font-black text-rose-700">${c('expired')}</div><div class="text-[10px] font-bold text-rose-700">Expiradas</div></div>
      </div>
      ${activeToday.length ? `<div class="mt-3 space-y-1">${activeToday.map((t) => `<div class="text-sm flex justify-between gap-2"><span class="truncate">${esc(t.emoji || '📝')} ${esc(t.title)}</span><span class="text-slate-400 shrink-0">${fmtDate(t.date)} ${esc(t.start)}–${esc(t.end)}</span></div>`).join('')}</div>` : ''}
    </section>`;
  }).join('');
  return h;
}

function pTasks() {
  const today = dKey();
  const kidOpts = S().kids.map((k) => `<option value="${k.id}">${esc(k.avatar)} ${esc(k.name)}</option>`).join('');
  let list = [...S().tasks];
  if (ui.filterKid !== 'all') list = list.filter((t) => t.kidId === ui.filterKid);
  if (ui.filterStatus !== 'all') list = list.filter((t) => t.status === ui.filterStatus);
  list.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const fchip = (type, val, label) => `<button class="chip ${ui[type] === val ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}" data-act="filter" data-type="${type}" data-val="${val}">${label}</button>`;
  return `
  <form data-form="taskNew" class="card space-y-3">
    <h2 class="font-extrabold">➕ Nova tarefa</h2>
    <div class="flex gap-2"><div class="w-20"><label class="lbl">Emoji</label><input class="input text-center" name="emoji" value="🧹" maxlength="4"></div>
      <div class="flex-1"><label class="lbl">Título *</label><input class="input" name="title" required maxlength="60" placeholder="Arrumar o quarto"></div></div>
    <div><label class="lbl">Descrição</label><textarea class="input" name="desc" rows="2" maxlength="200" placeholder="Detalhes (opcional)"></textarea></div>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="lbl">Responsável</label><select class="input" name="kidId">${kidOpts}<option value="all">👭 Ambas</option></select></div>
      <div><label class="lbl">Data limite</label><input class="input" type="date" name="date" value="${today}" min="${today}" required></div>
      <div><label class="lbl">Início da janela</label><input class="input" type="time" name="start" value="14:00" required></div>
      <div><label class="lbl">Fim da janela</label><input class="input" type="time" name="end" value="18:00" required></div>
    </div>
    <div><label class="lbl">Valor em pontos</label><input class="input" type="number" name="points" value="10" min="1" max="1000" required></div>
    <button class="btn btn-primary btn-block">Criar tarefa</button>
  </form>
  <div class="flex flex-wrap gap-2">
    ${fchip('filterKid', 'all', 'Todas')}${S().kids.map((k) => fchip('filterKid', k.id, `${esc(k.avatar)} ${esc(k.name)}`)).join('')}
  </div>
  <div class="flex flex-wrap gap-2">
    ${fchip('filterStatus', 'all', 'Qualquer status')}${Object.entries(STATUS).map(([id, s]) => fchip('filterStatus', id, `${s.i} ${s.l}`)).join('')}
  </div>
  <div class="space-y-3">${list.length ? list.slice(0, 80).map((t) => taskCard(t, 'parent')).join('') : '<p class="text-center text-slate-400 py-8">Nenhuma tarefa por aqui ainda 🌱</p>'}</div>`;
}

function pRewards() {
  const rs = sortedRewards();
  return `
  <form data-form="rewardNew" class="card space-y-3">
    <h2 class="font-extrabold">🎁 Novo prêmio mensal</h2>
    <div class="flex gap-2"><div class="w-20"><label class="lbl">Emoji</label><input class="input text-center" name="emoji" value="🎁" maxlength="4"></div>
      <div class="flex-1"><label class="lbl">Nome *</label><input class="input" name="name" required maxlength="50" placeholder="Rodízio Japonês"></div></div>
    <div><label class="lbl">Pontuação mínima no mês *</label><input class="input" type="number" name="minPoints" min="1" max="100000" value="200" required></div>
    <button class="btn btn-primary btn-block">Cadastrar prêmio</button>
  </form>
  <div class="space-y-3">
    ${rs.map((r) => `
    <div class="card flex items-center gap-3">
      <span class="text-3xl">${esc(r.emoji)}</span>
      <div class="flex-1"><h3 class="font-extrabold">${esc(r.name)}</h3><p class="text-xs text-slate-500">Mínimo: ⭐ ${r.minPoints} pts no mês</p>
        <div class="flex gap-2 mt-1">${S().kids.map((k) => `<span class="chip ${monthPts(k.id) >= r.minPoints ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${esc(k.avatar)} ${monthPts(k.id) >= r.minPoints ? 'atingido' : `${Math.max(0, monthPts(k.id))}/${r.minPoints}`}</span>`).join('')}</div></div>
      <button class="btn btn-danger btn-sm" data-act="delReward" data-id="${r.id}">🗑</button>
    </div>`).join('') || '<p class="text-center text-slate-400 py-8">Nenhum prêmio cadastrado</p>'}
  </div>`;
}

const FEED_ICON = { done: '✋', approved: '✅', rejected: '↩️', expired: '❌', reward: '🎉', adjust: '🎯', new: '🆕' };
function pFeed() {
  const items = S().notifications;
  if (!items.length) return '<p class="text-center text-slate-400 py-10">Sem avisos ainda. Quando as filhas concluírem tarefas, aparece aqui! 🔔</p>';
  return `<div class="flex justify-between items-center"><h2 class="font-extrabold">Central de notificações</h2><button class="btn btn-ghost btn-sm" data-act="clearFeed">Limpar</button></div>
  <div class="space-y-2">${items.slice(0, 120).map((n) => {
    const t = n.taskId ? taskOf(n.taskId) : null;
    const pending = t && t.status === 'done' && n.type === 'done';
    return `<div class="card !p-3 ${n.read ? '' : 'is-new'}">
      <div class="flex gap-2"><span class="text-xl">${FEED_ICON[n.type] || '🔔'}</span>
      <div class="flex-1"><p class="text-sm font-semibold">${esc(n.text)}</p><p class="text-xs text-slate-400 mt-0.5">${fmtDateTime(n.at)}</p>
      ${pending ? `<div class="flex gap-2 mt-2"><button class="btn btn-ok btn-sm" data-act="approve" data-id="${t.id}">✅ Aprovar</button><button class="btn btn-ghost btn-sm" data-act="reject" data-id="${t.id}">↩️ Refazer</button></div>` : ''}
      </div></div></div>`;
  }).join('')}</div>`;
}

function pSettings() {
  const st = S().settings;
  return `
  <form data-form="adjust" class="card space-y-3">
    <h2 class="font-extrabold">🎯 Ajuste manual de pontos</h2>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="lbl">Filha</label><select class="input" name="kidId">${S().kids.map((k) => `<option value="${k.id}">${esc(k.avatar)} ${esc(k.name)}</option>`).join('')}</select></div>
      <div><label class="lbl">Pontos (+ ou −)</label><input class="input" type="number" name="points" placeholder="-20 ou 30" required></div>
    </div>
    <div><label class="lbl">Motivo</label><input class="input" name="reason" maxlength="80" placeholder="Ex.: ajudou sem pedir"></div>
    <button class="btn btn-primary btn-block">Aplicar ajuste</button>
  </form>

  <form data-form="settings" class="card space-y-3">
    <h2 class="font-extrabold">⚖️ Regras</h2>
    <div><label class="lbl">Penalidade por tarefa expirada (% dos pontos da tarefa)</label><input class="input" type="number" name="penaltyPercent" min="0" max="300" value="${st.penaltyPercent}"></div>
    <label class="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="autoApprove" ${st.autoApprove ? 'checked' : ''} class="w-5 h-5"> Aprovar automaticamente ao concluir</label>
    <div class="space-y-2"><label class="lbl">Nomes e avatares</label>
      ${S().kids.map((k, i) => `<div class="flex gap-2"><select class="input !w-20 text-center" name="avatar${i}">${AVATARS.map((a) => `<option ${a === k.avatar ? 'selected' : ''}>${a}</option>`).join('')}</select><input class="input" name="name${i}" value="${esc(k.name)}" maxlength="20" required></div>`).join('')}
    </div>
    <button class="btn btn-primary btn-block">Salvar regras</button>
  </form>

  <form data-form="pin" class="card space-y-3">
    <h2 class="font-extrabold">🔑 Alterar PIN</h2>
    <div class="grid grid-cols-2 gap-2">
      <div><label class="lbl">Novo PIN</label><input class="input" name="pin1" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="••••" autocomplete="off"></div>
      <div><label class="lbl">Confirmar</label><input class="input" name="pin2" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="••••" autocomplete="off"></div>
    </div>
    <button class="btn btn-primary btn-block">Atualizar PIN</button>
  </form>

  <div class="card space-y-2">
    <h2 class="font-extrabold">💾 Backup</h2>
    <p class="text-xs text-slate-500">Os dados ficam só neste aparelho. Exporte para guardar ou levar a outro celular.</p>
    <div class="flex gap-2"><button class="btn btn-ghost btn-sm flex-1" data-act="export">⬇️ Exportar</button>
    <label class="btn btn-ghost btn-sm flex-1">⬆️ Importar<input type="file" accept="application/json" class="hidden" id="importFile"></label></div>
    <button class="btn btn-danger btn-sm btn-block" data-act="reset">Apagar todos os dados</button>
  </div>`;
}

/* ----- Tela: Filhas ----- */
function viewKid(kidId) {
  const k = kidOf(kidId), mp = monthPts(kidId), wp = weekPts(kidId), goal = goalFor(kidId);
  const tabs = [['today', '📅', 'Hoje'], ['week', '🗓️', 'Semana'], ['prizes', '🏆', 'Prêmios']];
  const msg = mp >= (goal ? goal.minPoints : Infinity) ? '🎉 Você bateu a meta! Incrível!' : wp > 0 ? 'Continue assim, campeã! 💪' : 'Vamos começar a juntar pontos! 🚀';
  const body = { today: kToday, week: kWeek, prizes: kPrizes }[ui.kidTab](kidId);
  return `
  <header class="px-4 pt-4 pb-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3"><span class="text-4xl pop">${esc(k.avatar)}</span><div><p class="text-xs font-bold text-violet-500">Nível ${level(mp)}</p><h1 class="text-2xl font-black leading-tight">Oi, ${esc(k.name)}!</h1></div></div>
      <button class="btn btn-ghost btn-sm" data-act="logout">Sair</button>
    </div>
    <div class="card mt-3 !bg-gradient-to-br from-violet-600 to-pink-500 !text-white !border-0">
      <div class="flex justify-around text-center">
        <div><div class="text-3xl font-black">${wp}</div><div class="text-xs font-bold opacity-80">pontos na semana</div></div>
        <div class="w-px bg-white/30"></div>
        <div><div class="text-3xl font-black">${mp}</div><div class="text-xs font-bold opacity-80">pontos no mês</div></div>
      </div>
      ${goal ? `<div class="mt-3"><div class="flex justify-between text-xs font-bold mb-1"><span>${esc(goal.emoji)} ${esc(goal.name)}</span><span>${Math.max(0, mp)}/${goal.minPoints}</span></div><div class="bar !bg-white/30"><i style="width:${Math.max(0, Math.min(100, (mp / goal.minPoints) * 100))}%"></i></div></div>` : ''}
      <p class="text-xs font-semibold mt-2 text-center opacity-90">${msg}</p>
    </div>
  </header>
  <main class="px-4 pb-28 pt-2 space-y-3 fade-in">${body}</main>
  <nav class="bottom-nav"><div class="flex">${tabs.map(([id, ic, lb]) => `<button class="nav-btn ${ui.kidTab === id ? 'active' : ''}" data-act="kidTab" data-tab="${id}"><span class="ico">${ic}</span>${lb}</button>`).join('')}</div></nav>`;
}

function kToday(kidId) {
  const today = dKey();
  const list = S().tasks.filter((t) => t.kidId === kidId && t.date === today).sort((a, b) => a.start.localeCompare(b.start));
  if (!list.length) return '<div class="card text-center py-10"><div class="text-5xl mb-2">🌈</div><p class="font-bold">Nenhuma tarefa para hoje!</p><p class="text-sm text-slate-500">Aproveite seu dia livre.</p></div>';
  const open = list.filter((t) => t.status === 'pending').length;
  return `<p class="text-sm font-bold text-slate-500">${open ? `Você tem ${open} tarefa${open > 1 ? 's' : ''} para fazer hoje` : '🎉 Tudo feito por hoje!'}</p>${list.map((t) => taskCard(t, 'kid')).join('')}`;
}

function kWeek(kidId) {
  const s = startOfWeek(), today = dKey();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(s); d.setDate(s.getDate() + i);
    const key = dKey(d), ts = S().tasks.filter((t) => t.kidId === kidId && t.date === key).sort((a, b) => a.start.localeCompare(b.start));
    return `<section>
      <h3 class="font-extrabold text-sm mb-1 ${key === today ? 'text-violet-600' : 'text-slate-500'}">${key === today ? '📍 Hoje' : WEEKDAYS[d.getDay()]} · ${fmtDate(key)}</h3>
      ${ts.length ? `<div class="space-y-2">${ts.map((t) => taskCard(t, 'kid')).join('')}</div>` : '<p class="text-xs text-slate-400 mb-2">Sem tarefas</p>'}
    </section>`;
  }).join('');
}

function kPrizes(kidId) {
  const mp = monthPts(kidId);
  const hist = S().ledger.filter((l) => l.kidId === kidId).slice(-8).reverse();
  return `
  ${sortedRewards().map((r) => {
    const ok = mp >= r.minPoints;
    return `<div class="card ${ok ? '!bg-emerald-50' : ''}"><div class="flex items-center gap-3"><span class="text-4xl ${ok ? 'pop' : 'grayscale opacity-60'}">${esc(r.emoji)}</span>
      <div class="flex-1"><div class="flex justify-between"><h3 class="font-extrabold">${esc(r.name)}</h3><span class="text-lg">${ok ? '🔓' : '🔒'}</span></div>
      <p class="text-xs text-slate-500 mb-1">${ok ? 'Conquistado este mês!' : `Faltam ${r.minPoints - Math.max(0, mp)} pontos`}</p>${bar(mp, r.minPoints)}</div></div></div>`;
  }).join('') || '<p class="text-center text-slate-400 py-8">Os pais ainda não cadastraram prêmios</p>'}
  <h3 class="font-extrabold pt-2">Últimos pontos</h3>
  <div class="card !p-3 space-y-1.5">${hist.map((l) => `<div class="flex justify-between text-sm"><span class="truncate pr-2">${esc(l.reason)}</span><span class="font-black ${l.points >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${l.points > 0 ? '+' : ''}${l.points}</span></div>`).join('') || '<p class="text-sm text-slate-400">Ainda sem movimentos</p>'}</div>`;
}

/* ---------- Render principal (roteamento de telas) ---------- */
const appEl = () => $('#app');
function render() {
  const y = window.scrollY, ses = getSession();
  let html;
  if (ui.screen === 'pin') html = viewPin();
  else if (!ses) html = viewProfiles();
  else if (ses.role === 'parent') html = viewParent();
  else html = viewKid(ses.kidId);
  appEl().innerHTML = html;
  window.scrollTo(0, y);
  if (ses && ses.role === 'parent' && ui.tab === 'feed') markRead();
  if (ses && ses.role === 'kid') setTimeout(() => celebrate(ses.kidId), 350);
}

function markRead() {
  if (S().notifications.some((n) => !n.read)) setTimeout(() => { S().notifications.forEach((n) => (n.read = true)); Store.persistOnly(); }, 600);
}

/* Confete quando a filha vê um prêmio recém-desbloqueado no mês (funciona mesmo se os pais aprovaram em outro aparelho) */
function celebrate(kidId) {
  const k = kidOf(kidId), mp = monthPts(kidId), mk = monthKey();
  const fresh = S().rewards.filter((r) => mp >= r.minPoints && !k.seen.includes(`${mk}:${r.id}`));
  if (!fresh.length) return;
  fresh.forEach((r) => k.seen.push(`${mk}:${r.id}`));
  Store.persistOnly();
  confetti(220);
  toast(`🏆 Prêmio desbloqueado: ${fresh[0].name}!`);
}

/* ---------- 7. Ações e formulários ---------- */
const actions = {
  loginKid: ({ id }) => { setSession({ role: 'kid', kidId: id }); ui.kidTab = 'today'; ui.screen = null; render(); },
  loginParent: () => { ui.screen = 'pin'; ui.pin = ''; ui.pinError = false; render(); },
  logout: () => { setSession(null); ui.screen = null; ui.pin = ''; render(); },
  pinKey: ({ k }) => {
    if (lockLeft() > 0) return;
    ui.pinError = false;
    if (k === 'del') ui.pin = ui.pin.slice(0, -1); else if (ui.pin.length < 4) ui.pin += k;
    if (ui.pin.length === 4) {
      if (hashPin(ui.pin) === S().settings.pin) {
        localStorage.setItem('fq.lock', JSON.stringify({ fails: 0, until: 0 }));
        setSession({ role: 'parent' }); ui.screen = null; ui.tab = 'dash'; ui.pin = '';
      } else {
        const l = getLock(); l.fails++;
        if (l.fails >= 3) { l.until = Date.now() + 30000; l.fails = 0; }
        localStorage.setItem('fq.lock', JSON.stringify(l));
        ui.pin = ''; ui.pinError = true;
      }
    }
    render();
  },
  tab: ({ tab }) => { ui.tab = tab; render(); window.scrollTo(0, 0); },
  kidTab: ({ tab }) => { ui.kidTab = tab; render(); window.scrollTo(0, 0); },
  filter: ({ type, val }) => { ui[type] = val; render(); },
  complete: ({ id }) => { if (confirm('Marcar esta tarefa como concluída?')) completeTask(id); },
  approve: ({ id }) => approveTask(id),
  reject: ({ id }) => rejectTask(id),
  delTask: ({ id }) => { if (!confirm('Excluir esta tarefa?')) return; S().tasks = S().tasks.filter((t) => t.id !== id); Store.save(); render(); },
  delReward: ({ id }) => { if (!confirm('Excluir este prêmio?')) return; S().rewards = S().rewards.filter((r) => r.id !== id); Store.save(); render(); },
  clearFeed: () => { if (!confirm('Limpar todas as notificações?')) return; S().notifications = []; Store.save(); render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `familyquest-backup-${dKey()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  reset: () => {
    if (!confirm('Apagar TODOS os dados (tarefas, pontos, prêmios, PIN)? Isso não pode ser desfeito.')) return;
    localStorage.removeItem(KEY); Store.load(); Store.save(); toast('Dados apagados'); render();
  },
};

const forms = {
  taskNew(d, f) {
    if (d.end <= d.start) return toast('⚠️ O fim da janela deve ser depois do início');
    const kids = d.kidId === 'all' ? S().kids.map((k) => k.id) : [d.kidId];
    kids.forEach((kidId) => {
      const t = { id: uid(), title: d.title.trim(), desc: (d.desc || '').trim(), emoji: (d.emoji || '📝').trim(), kidId, date: d.date, start: d.start, end: d.end, points: Math.max(1, parseInt(d.points, 10) || 1), status: 'pending', createdAt: new Date().toISOString() };
      S().tasks.push(t);
      notify('new', `🆕 Tarefa "${t.title}" criada para ${kidOf(kidId).name}`, { kidId, taskId: t.id });
    });
    Store.save(); f.reset(); toast('✅ Tarefa criada!'); render();
  },
  rewardNew(d, f) {
    S().rewards.push({ id: uid(), name: d.name.trim(), emoji: (d.emoji || '🎁').trim(), minPoints: Math.max(1, parseInt(d.minPoints, 10) || 1) });
    Store.save(); f.reset(); toast('🎁 Prêmio cadastrado!'); render();
  },
  adjust(d, f) {
    const p = parseInt(d.points, 10);
    if (!p) return toast('⚠️ Informe um valor diferente de zero');
    const reason = (d.reason || '').trim() || 'Ajuste dos pais';
    addLedger(d.kidId, p, `Ajuste: ${reason}`, 'adjust');
    notify('adjust', `🎯 ${p > 0 ? '+' : ''}${p} pts para ${kidOf(d.kidId).name} (${reason})`, { kidId: d.kidId });
    Store.save(); f.reset(); toast('🎯 Pontos ajustados'); render();
  },
  settings(d) {
    S().settings.penaltyPercent = Math.max(0, Math.min(300, parseInt(d.penaltyPercent, 10) || 0));
    S().settings.autoApprove = d.autoApprove === 'on';
    S().kids.forEach((k, i) => { k.name = (d['name' + i] || k.name).trim(); k.avatar = d['avatar' + i] || k.avatar; });
    Store.save(); toast('💾 Regras salvas'); render();
  },
  pin(d, f) {
    if (!/^\d{4}$/.test(d.pin1)) return toast('⚠️ O PIN deve ter 4 números');
    if (d.pin1 !== d.pin2) return toast('⚠️ Os PINs não conferem');
    S().settings.pin = hashPin(d.pin1); Store.save(); f.reset(); toast('🔑 PIN atualizado');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset, el);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  forms[f.dataset.form]?.(Object.fromEntries(new FormData(f)), f);
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.kids)) throw new Error('formato');
      if (!confirm('Importar este backup e substituir os dados atuais?')) return;
      Store.state = migrate(data); Store.save(); toast('✅ Backup importado'); render();
    } catch { toast('⚠️ Arquivo de backup inválido'); }
  };
  r.readAsText(file);
});
// Teclado físico no PIN
document.addEventListener('keydown', (e) => {
  if (ui.screen !== 'pin') return;
  if (/^\d$/.test(e.key)) actions.pinKey({ k: e.key });
  else if (e.key === 'Backspace') actions.pinKey({ k: 'del' });
});

/* ---------- 8. Inicialização / PWA ---------- */
const isTyping = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };

function tick() {
  sweep();
  if (!isTyping()) render(); // atualiza contagens regressivas e alertas
}

function init() {
  Store.load();
  sweep();
  // Multi-aba / multi-janela no mesmo aparelho: reflete mudanças feitas em outra aba.
  // (Entre aparelhos diferentes, use a camada Sync acima.)
  window.addEventListener('storage', (e) => { if (e.key === KEY) { Store.load(); if (!isTyping()) render(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { sweep(); if (!isTyping()) render(); } });
  setInterval(tick, 30000);                                   // varredura de penalidades + contagem regressiva
  setInterval(() => { if (ui.screen === 'pin' && lockLeft() >= 0 && getLock().until) render(); }, 1000); // contagem do bloqueio do PIN
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW falhou', e));
}
init();
