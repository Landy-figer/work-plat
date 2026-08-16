/* =====================================================================
 * WORK-Plat — 个人工作台 (app.js)
 * 路由、工作台合并视图、智能汇报自动解析、项目内联展开、OKLCH 极简主题
 * ===================================================================== */
(function (global) {
  'use strict';
  const LB = global.LB;
  const S = LB.store;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => ('' + (s == null ? '' : s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PRI = { '高': 'pri-high', '中': 'pri-mid', '低': 'pri-low' };
  const STAT = { '进行中': 'st-active', '已完成': 'st-done', '已暂停': 'st-pause', '已结案': 'st-closed' };

  function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDT(iso) { if (!iso) return '—'; const d = new Date(iso); return fmtDate(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function daysLeft(iso) { if (!iso) return null; const t = new Date(); t.setHours(0, 0, 0, 0); const d = new Date(iso); d.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); }
  function rel(iso) { const n = daysLeft(iso); if (n == null) return ''; if (n === 0) return '<span class="rel today">今天</span>'; if (n < 0) return '<span class="rel overdue">逾期' + (-n) + '天</span>'; if (n === 1) return '<span class="rel soon">明天</span>'; return '<span class="rel">剩' + n + '天</span>'; }

  const state = {
    view: 'dashboard', calMode: 'week', calDate: new Date(),
    projFilter: { q: '', status: '', cause: '', tag: '' }, projOpenId: null, openCases: {}, openCreditors: {},
    reportPreview: null, lastAppliedRaw: '', rpStatus: '', lawQ: '', validateHtml: ''
  };
  let rpTimer = null;

  /* ===================== 导航 ===================== */
  const NAV = [
    { id: 'dashboard', label: '工作台', icon: '▦', c: 'oklch(62% 0.052 240)', title: '工作台' },
    { id: 'calendar', label: '日程管理', icon: '◷', c: 'oklch(59% 0.050 155)', title: '日程管理' },
    { id: 'projects', label: '项目管理', icon: '▤', c: 'oklch(61% 0.058 45)', title: '项目管理' },
    { id: 'personnel', label: '人员管理', icon: '☺', c: 'oklch(69% 0.058 80)', title: '人员管理' },
    { id: 'export', label: '数据导出', icon: '⇩', c: 'oklch(62% 0.048 200)', title: '数据导出' }
  ];
  const NAVC = { dashboard: 'oklch(62% 0.052 240)', calendar: 'oklch(59% 0.050 155)', projects: 'oklch(61% 0.058 45)', personnel: 'oklch(69% 0.058 80)', export: 'oklch(62% 0.048 200)' };

  function navigate(v) { state.view = v; state.reportPreview = null; render(); }

  function render() {
    $('#nav').innerHTML = NAV.map((n) => {
      const active = state.view === n.id;
      const st = active ? `background:${n.c};color:#fff;border-color:transparent;` : '';
      return `<button class="nav-item ${active ? 'active' : ''}" data-view="${n.id}" style="${st}"><span class="ni" style="background:${active ? '#fff' : n.c}"></span><span>${n.label}</span></button>`;
    }).join('');
    const nv = NAV.find((n) => n.id === state.view) || NAV[0];
    const vt = $('#view-title'); vt.textContent = nv.title; vt.className = 'tt';
    const view = $('#view'); view.style.setProperty('--mc', NAVC[state.view] || NAVC.dashboard);
    if (state.view === 'dashboard') view.innerHTML = viewDashboard();
    else if (state.view === 'calendar') view.innerHTML = viewCalendar();
    else if (state.view === 'projects') view.innerHTML = viewProjects();
    else     if (state.view === 'personnel') view.innerHTML = viewPersonnel();
    else if (state.view === 'export') view.innerHTML = viewExport();
    else if (state.view === 'reminders') view.innerHTML = viewReminders();
    bindView();
    $('.view-scroll').scrollTop = 0;
  }

  /* ===================== Modal ===================== */
  function openModal(title, bodyHtml, onSave, opts) {
    opts = opts || {};
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal').classList.add('open');
    const saveBtn = $('#modal-save');
    saveBtn.style.display = opts.readonly ? 'none' : '';
    saveBtn.onclick = () => { if (onSave) onSave(collectForm()); };
    $('#modal-cancel').onclick = closeModal;
  }
  function closeModal() { $('#modal').classList.remove('open'); }
  /* 应用内确认弹窗：替代原生 confirm()，避免部分浏览器/内嵌环境拦截模态对话框导致删除等操作“静默失效” */
  function confirmModal(message, onYes, opts) {
    opts = opts || {};
    const saveBtn = $('#modal-save');
    const restore = () => { saveBtn.textContent = '保存'; };
    $('#modal-title').textContent = opts.title || '操作确认';
    $('#modal-body').innerHTML = '<p class="confirm-msg">' + esc(message) + '</p>';
    $('#modal').classList.add('open');
    saveBtn.style.display = '';
    saveBtn.textContent = opts.okText || '确认删除';
    saveBtn.onclick = () => { closeModal(); restore(); onYes(); };
    $('#modal-cancel').onclick = () => { closeModal(); restore(); };
    $('.modal-mask').onclick = () => { closeModal(); restore(); };
  }
  function collectForm() { const o = {}; $$('#modal-body [data-field]').forEach((inp) => { o[inp.dataset.field] = inp.type === 'checkbox' ? inp.checked : inp.value; }); return o; }
  /* 进展状态编辑：修改说明与日期（作者保留，不展示「我」标识） */
  function openProgressEditor(title, item, onSave) {
    item = item || {};
    openModal(title, field('content', '进展说明', 'textarea', item.content || '', { wide: true, rows: 3 }) + field('date', '日期', 'date', (item.date || '').slice(0, 10)), (v) => {
      onSave({ content: v.content, date: v.date ? v.date : (item.date || '') });
      closeModal(); render();
    });
  }
  function field(name, label, type, val, opts) {
    opts = opts || {}; val = val == null ? '' : val;
    let ctrl;
    if (type === 'textarea') ctrl = `<textarea data-field="${name}" rows="${opts.rows || 3}" placeholder="${opts.ph || ''}">${esc(val)}</textarea>`;
    else if (type === 'select') ctrl = `<select data-field="${name}">${opts.options.map((o) => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (type === 'date') ctrl = `<input data-field="${name}" type="date" value="${esc(val)}">`;
    else if (type === 'datetime') ctrl = `<input data-field="${name}" type="datetime-local" value="${esc(val)}">`;
    else ctrl = `<input data-field="${name}" type="text" value="${esc(val)}" placeholder="${opts.ph || ''}"${opts.list ? ` list="${opts.list}"` : ''}>`;
    return `<label class="fld ${opts.wide ? 'wide' : ''}"><span>${label}</span>${ctrl}</label>`;
  }

  /* 组合框：从已有项目下拉选择，同时允许手动输入自定义内容 */
  function fieldCombo(key, label, value, options, extra) {
    const listId = 'combo_' + key;
    const dl = `<datalist id="${listId}">${(options || []).map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
    return field(key, label, 'text', value, Object.assign({ list: listId }, extra || {})) + dl;
  }

  /* ===================== 查封与保全：多项编辑器（按类型自动计算查封/续封期限） =====================
   * 期限规则（法源：查封规定 2020修正 第1条）：资金/银行存款≤1年、动产≤2年、不动产/其他财产权≤3年；续封≤原期限 1/2。
   * 计算统一走 store 暴露的 LB.util.computeSeizureEnd / addMonthsISO，避免两端规则漂移。 */
  function szTypes() { return (LB.util && LB.util.SEIZURE_PERIODS) ? Object.keys(LB.util.SEIZURE_PERIODS) : ['资金/银行存款', '动产', '不动产', '其他财产权']; }
  function szCompute(type, start) { return (LB.util && LB.util.computeSeizureEnd) ? LB.util.computeSeizureEnd(type, start) : { end: '', renewalEnd: '' }; }
  function szAddMonths(s, n) { return (LB.util && LB.util.addMonthsISO) ? LB.util.addMonthsISO(s, n) : ''; }
  function szRowHtml(it) {
    it = it || {};
    const type = it.type || '不动产';
    const opts = szTypes().map((t) => `<option value="${esc(t)}" ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const e = szCompute(type, it.start);
    const end = it.end || e.end, rEnd = it.renewalEnd || e.renewalEnd;
    return `<div class="sz-row" data-sz-row>
      <select class="sz-type" data-sz="type">${opts}</select>
      <input class="sz-name" data-sz="name" type="text" value="${esc(it.name || '')}" placeholder="名称/编号">
      <input class="sz-start" data-sz="start" type="date" value="${esc(it.start || '')}">
      <span class="sz-computed">截止 <b>${esc(end || '—')}</b><br>续封最迟 <b>${esc(rEnd || '—')}</b></span>
      <button type="button" class="mini danger sz-del" data-sz-del>删</button>
    </div>`;
  }
  function szEditorHtml(seizures) {
    const list = Array.isArray(seizures) ? seizures : [];
    return `<div class="fld wide"><span>查封与保全（多项抵质押物 / 查封物，按类型自动计算查封与续封期限）</span>
      <div class="sz-editor" data-sz-editor>${list.length ? list.map(szRowHtml).join('') : '<div class="sz-empty">暂无查封物，点击「+ 添加查封物」录入。</div>'}
        <button type="button" class="mini sz-add" data-sz-add>+ 添加查封物</button>
      </div></div>`;
  }
  function szDetailHtml(seizures) {
    const list = Array.isArray(seizures) ? seizures : [];
    if (!list.length) return '<div class="kv"><span class="kv-k">查封与保全</span><span class="kv-v">—</span></div>';
    const rows = list.map((s) => { const e = szCompute(s.type || '不动产', s.start); const end = s.end || e.end, rEnd = s.renewalEnd || e.renewalEnd; return `<div class="sz-detail-row"><b>${esc(s.type || '')}</b> ${esc(s.name || '')}：起算 ${esc(s.start || '—')} → 查封截止 <b>${esc(end || '—')}</b>；续封最迟 <b>${esc(rEnd || '—')}</b></div>`; }).join('');
    return `<div class="kv kv-wide"><span class="kv-k">查封与保全（${list.length} 项）</span><div class="kv-v sz-detail">${rows}</div></div>`;
  }
  function collectSeizureItems() {
    const ed = $('#modal-body [data-sz-editor]'); if (!ed) return [];
    const out = [];
    ed.querySelectorAll('[data-sz-row]').forEach((row) => {
      const type = row.querySelector('[data-sz="type"]').value;
      const name = (row.querySelector('[data-sz="name"]').value || '').trim();
      const start = row.querySelector('[data-sz="start"]').value;
      if (!type && !name && !start) return;
      const e = szCompute(type, start);
      out.push({ type: type, name: name, start: start || '', end: e.end, renewalEnd: e.renewalEnd });
    });
    return out;
  }
  function bindSeizureEditor() {
    const ed = $('#modal-body [data-sz-editor]'); if (!ed) return;
    const recompute = () => ed.querySelectorAll('[data-sz-row]').forEach((row) => {
      const e = szCompute(row.querySelector('[data-sz="type"]').value, row.querySelector('[data-sz="start"]').value);
      const c = row.querySelector('.sz-computed'); if (c) c.innerHTML = '截止 <b>' + esc(e.end || '—') + '</b><br>续封最迟 <b>' + esc(e.renewalEnd || '—') + '</b>';
    });
    ed.addEventListener('input', (ev) => { if (ev.target.matches('[data-sz="type"],[data-sz="start"]')) recompute(); });
    ed.addEventListener('change', (ev) => { if (ev.target.matches('[data-sz="type"],[data-sz="start"]')) recompute(); });
    ed.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-sz-add]')) { const empty = ed.querySelector('.sz-empty'); if (empty) empty.remove(); ed.insertAdjacentHTML('beforeend', szRowHtml({})); recompute(); }
      else if (ev.target.closest('[data-sz-del]')) { const r = ev.target.closest('[data-sz-row]'); if (r) r.remove(); if (!ed.querySelector('[data-sz-row]')) ed.insertAdjacentHTML('afterbegin', '<div class="sz-empty">暂无查封物，点击「+ 添加查封物」录入。</div>'); }
    });
  }

  /* ===================== 破产要素：多项债权持有人 + 债权流转明细 =====================
   * 数据模型：holders:[{ id, name, transfers:[{ id, date, from(原始债权人/转让方), to(受让方), amount, applicant }] }]
   * 多次转让（A→B→C）以时间轴形式呈现，每次流转记录含转让时间/原始债权人/债权金额/申请执行人。 */
  function crHolderHtml(h) {
    h = h || {};
    const transfers = Array.isArray(h.transfers) ? h.transfers : [];
    return `<div class="cr-holder" data-cr-holder data-id="${esc(h.id || '')}">
      <div class="cr-holder-head">
        <input class="cr-name" data-cr="name" type="text" value="${esc(h.name || '')}" placeholder="债权持有人名称">
        <button type="button" class="mini danger cr-del" data-cr-del>删</button>
      </div>
      <div class="cr-transfers">
        <div class="cr-transfers-title">债权流转明细（多次转让按时间轴录入）</div>
        ${transfers.length ? transfers.map(crTransferRowHtml).join('') : '<div class="cr-empty-sm">暂无流转记录，点击「+ 添加流转」录入。</div>'}
        <button type="button" class="mini cr-add-tf" data-cr-add-tf>+ 添加流转</button>
      </div>
    </div>`;
  }
  function crTransferRowHtml(t) {
    t = t || {};
    return `<div class="cr-tf-row" data-cr-tf>
      <input class="cr-tf-date" data-cr-tf="date" type="text" value="${esc(t.date || '')}" placeholder="转让时间(如2021-07)">
      <input class="cr-tf-from" data-cr-tf="from" type="text" value="${esc(t.from || '')}" placeholder="原始债权人/转让方">
      <input class="cr-tf-to" data-cr-tf="to" type="text" value="${esc(t.to || '')}" placeholder="受让方">
      <input class="cr-tf-amt" data-cr-tf="amount" type="text" value="${esc(t.amount || '')}" placeholder="债权金额">
      <input class="cr-tf-app" data-cr-tf="applicant" type="text" value="${esc(t.applicant || '')}" placeholder="申请执行人">
      <button type="button" class="mini danger cr-tf-del" data-cr-tf-del>删</button>
    </div>`;
  }
  function creditorEditorHtml(holders) {
    const list = Array.isArray(holders) ? holders : [];
    return `<div class="fld wide"><span>债权持有人（多项，每位可展开录入债权流转明细）</span>
      <div class="cr-editor" data-cr-editor>${list.length ? list.map(crHolderHtml).join('') : '<div class="cr-empty">暂无债权持有人，点击「+ 添加债权持有人」录入。</div>'}
        <button type="button" class="mini cr-add" data-cr-add>+ 添加债权持有人</button>
      </div></div>`;
  }
  function crDetailHtml(holders) {
    const list = Array.isArray(holders) ? holders : [];
    if (!list.length) return '<div class="kv"><span class="kv-k">债权持有人</span><span class="kv-v">—</span></div>';
    const rows = list.map((h) => {
      const open = state.openCreditors[h.id];
      const orig = (h.transfers && h.transfers.length) ? (h.transfers[0].from || '—') : '—';
      const tl = (h.transfers && h.transfers.length) ? h.transfers.map((t) => `<li class="cr-tl-node"><div class="cr-tl-dot"></div><div class="cr-tl-body"><div class="cr-tl-date">${esc(t.date || '—')}</div><div class="cr-tl-flow">${esc(t.from || '')} <span class="cr-tl-arrow">→</span> ${esc(t.to || '')}</div><div class="cr-tl-meta">债权金额：<b>${esc(t.amount || '—')}</b>　申请执行人：${esc(t.applicant || '—')}</div></div></li>`).join('') : '<li class="cr-tl-empty">暂无流转记录</li>';
      return `<div class="cr-detail-holder" data-cr-id="${esc(h.id)}">
        <div class="cr-detail-head" data-act="cred-toggle" data-id="${esc(h.id)}">
          <span class="cr-detail-name">${esc(h.name || '未命名持有人')}</span>
          <span class="cr-detail-sub">原始债权人：${esc(orig)} · ${(h.transfers || []).length} 次流转 ${open ? '▲' : '▼'}</span>
        </div>
        ${open ? `<div class="cr-tl"><ul>${tl}</ul></div>` : ''}
      </div>`;
    }).join('');
    return `<div class="kv kv-wide"><span class="kv-k">债权持有人（${list.length} 项）</span><div class="kv-v cr-detail">${rows}</div></div>`;
  }
  function collectCreditorItems() {
    const ed = $('#modal-body [data-cr-editor]'); if (!ed) return [];
    const out = [];
    ed.querySelectorAll('[data-cr-holder]').forEach((h) => {
      const name = (h.querySelector('[data-cr="name"]').value || '').trim();
      const transfers = [];
      h.querySelectorAll('[data-cr-tf]').forEach((r) => {
        const date = (r.querySelector('[data-cr-tf="date"]').value || '').trim();
        const from = (r.querySelector('[data-cr-tf="from"]').value || '').trim();
        const to = (r.querySelector('[data-cr-tf="to"]').value || '').trim();
        const amount = (r.querySelector('[data-cr-tf="amount"]').value || '').trim();
        const applicant = (r.querySelector('[data-cr-tf="applicant"]').value || '').trim();
        if (!date && !from && !to && !amount && !applicant) return;
        transfers.push({ id: LB.util.uid('tf'), date: date, from: from, to: to, amount: amount, applicant: applicant });
      });
      if (!name && !transfers.length) return;
      out.push({ id: h.dataset.id || LB.util.uid('cr'), name: name, transfers: transfers });
    });
    return out;
  }
  function bindCreditorEditor() {
    const ed = $('#modal-body [data-cr-editor]'); if (!ed) return;
    ed.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-cr-add]')) { const empty = ed.querySelector('.cr-empty'); if (empty) empty.remove(); ed.insertAdjacentHTML('beforeend', crHolderHtml({ id: LB.util.uid('cr') })); }
      else if (ev.target.closest('[data-cr-del]')) { const h = ev.target.closest('[data-cr-holder]'); if (h) h.remove(); if (!ed.querySelector('[data-cr-holder]')) ed.insertAdjacentHTML('afterbegin', '<div class="cr-empty">暂无债权持有人，点击「+ 添加债权持有人」录入。</div>'); }
      else if (ev.target.closest('[data-cr-add-tf]')) { const h = ev.target.closest('[data-cr-holder]'); const tf = h.querySelector('.cr-transfers'); const empty = tf.querySelector('.cr-empty-sm'); if (empty) empty.remove(); tf.insertAdjacentHTML('beforeend', crTransferRowHtml({})); }
      else if (ev.target.closest('[data-cr-tf-del]')) { const r = ev.target.closest('[data-cr-tf]'); const tf = r.closest('.cr-transfers'); if (r) r.remove(); if (!tf.querySelector('[data-cr-tf]')) tf.insertAdjacentHTML('afterbegin', '<div class="cr-empty-sm">暂无流转记录，点击「+ 添加流转」录入。</div>'); }
    });
  }

  /* ===================== 工作台（合并：智能汇报 + 任务 + 提醒） ===================== */
  function viewDashboard() {
    // 任务提醒与任务管理去重：任务截止类提醒已展示在上方任务管理表中，此处仅保留开庭/合同到期/查封到期等事件型提醒
    const rem = S.reminders().filter((r) => r.type !== '任务截止').slice(0, 6);
    return `
    <div class="dash-cols">
      <section class="panel">
        <div class="ph"><h3 class="tt">任务管理</h3><button class="link" data-act="task-new">+ 新建任务</button></div>
        ${taskTableHtml(S.listTasks().filter((t) => t.status !== '已完成'))}
      </section>
      <section class="panel">
        <div class="ph"><h3 class="tt">任务提醒</h3><button class="link" data-act="goto-reminders">查看全部</button></div>
        ${remindersHtml(rem)}
      </section>
    </div>

    <section class="panel report-card">
      <textarea id="report-text" rows="4" placeholder="例：百高项目债权处置 明天提交处置进展报告，8月20日开庭"></textarea>
      <div class="rp-bar">
        <button class="btn primary" data-act="report-apply">确认</button>
        <span class="rp-status">${state.rpStatus ? esc(state.rpStatus) : '等待输入…'}</span>
      </div>
      <div id="rp-preview" class="rp-preview">${state.reportPreview ? reportPreviewHtml(state.reportPreview) : ''}</div>
    </section>`;
  }
  function reportPreviewHtml(p) {
    if (!p) return '';
    const warns = [];
    if (p.progress && !p.matchedProject && !p.createProject) warns.push('未匹配到项目且无“新建项目”，进展将不会被记录');
    return `<ul class="rp-sum">${p.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>${warns.length ? '<div class="rp-warn">⚠ ' + warns.join('；') + '</div>' : ''}`;
  }
  function updPreview() { const el = $('#rp-preview'); if (el) el.innerHTML = reportPreviewHtml(state.reportPreview); }

  function applyReport() {
    const ta = $('#report-text'); if (!ta) return;
    const text = ta.value; if (!text.trim()) return;
    const parsed = (state.reportPreview && state.reportPreview.raw === text) ? state.reportPreview : LB.nlp.parse(text);
    LB.nlp.apply(parsed);
    state.reportPreview = null; state.lastAppliedRaw = text;
    state.rpStatus = '✓ 已更新：' + parsed.summary.join('；');
    if (ta) ta.value = '';
    render();
  }

  function taskStatusClass(s) { return s === '已完成' ? 'done' : s === '待审阅' ? 'review' : 'todo'; }
  function taskTableHtml(tasks) {
    const list = tasks.slice(); // 直接按 DB 数组顺序（拖拽排序即持久化顺序），不再按状态/截止自动排序
    const cards = list.map((t) => {
      const isDone = t.status === '已完成';
      return `<li class="card-pill is-task pri-${PRIORITY_CLASS(t.priority)}${isDone ? ' row-done' : ''}" data-act="task-open" data-id="${t.id}">
        <span class="drag-handle" data-drag-handle title="拖拽排序">⠿</span>
        <label class="chk"><input type="checkbox" data-act="task-toggle" data-id="${t.id}" ${(t.status === '已完成' || t.status === '待审阅') ? 'checked' : ''}><span></span></label>
        <div class="card-pill-main">
          <div class="card-pill-title">${esc(t.title)}</div>
          <div class="card-pill-sub">截止 ${fmtDate(t.dueDate)} ${rel(t.dueDate)}</div>
        </div>
        <div class="card-pill-aside"><span class="st st-${taskStatusClass(t.status)} st-act" data-act="task-status" data-id="${t.id}" title="点击设置状态">${t.status}</span></div>
        <div class="card-pill-actions">
          <button class="mini" data-act="task-edit" data-id="${t.id}">编辑</button>
          <button class="mini danger" data-act="task-del" data-id="${t.id}">删</button>
        </div>
      </li>`;
    }).join('');
    return cards ? `<ul class="card-list">${cards}</ul>` : `<div class="empty"><p>暂无任务</p></div>`;
  }
  function PRIORITY_CLASS(p) { return p === '高' ? 'high' : (p === '中' ? 'mid' : 'low'); }

  function remindersHtml(rem) {
    if (!rem.length) return '<p class="empty">未来 14 天无预警</p>';
    return `<ul class="rem-list">${rem.map((r) => `<li class="rem rem-${r.level === '高' ? 'hi' : 'mid'}"><span class="rem-type">${r.type}</span><span class="rem-proj" data-act="goto-proj" data-id="${r.projectId || ''}">${esc(r.project)}</span><span class="rem-date">${fmtDate(r.date)} ${rel(r.date)}</span></li>`).join('')}</ul>`;
  }

  /* ===================== 日程管理（周/月 + 冲突检测） ===================== */
  function viewCalendar() {
    const evts = S.deriveEvents();
    const conflicts = detectConflicts(evts);
    let body, label;
    if (state.calMode === 'week') { const r = weekView(state.calDate, evts, conflicts); body = r.html; label = r.label; }
    else { const r = monthView(state.calDate, evts); body = r.html; label = r.label; }
    return `
    <div class="toolbar cal-bar">
      <div class="cal-nav"><button class="btn" data-act="cal-prev">‹</button><button class="btn" data-act="cal-today">今天</button><button class="btn" data-act="cal-next">›</button><strong class="cal-label">${label}</strong></div>
      <div class="seg"><button class="seg-btn ${state.calMode === 'week' ? 'on' : ''}" data-act="cal-week">周视图</button><button class="seg-btn ${state.calMode === 'month' ? 'on' : ''}" data-act="cal-month">月视图</button></div>
      <button class="btn primary" data-act="evt-new">+ 新建日程</button>
    </div>
    ${conflicts.length ? `<div class="conflict-banner">⚠ 检测到 ${conflicts.length} 处日程冲突：${conflicts.map((c) => esc(c.aTitle) + ' × ' + esc(c.bTitle)).join('；')}</div>` : ''}
    <div class="cal-body">${body}</div>`;
  }
  function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
  function weekView(ref, evts, conflicts) {
    const start = startOfWeek(ref);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
    const hours = Array.from({ length: 7 }, (_, i) => 8 + i * 2);
    const label = fmtDate(start.toISOString()) + ' ~ ' + fmtDate(days[6].toISOString());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const head = days.map((d) => { const isT = d.getTime() === today.getTime(); return `<div class="wk-head ${isT ? 'istoday' : ''}"><span class="wk-dow">${['一', '二', '三', '四', '五', '六', '日'][d.getDay() === 0 ? 6 : d.getDay() - 1]}</span><span class="wk-dn">${d.getDate()}</span></div>`; }).join('');
    let grid = '';
    days.forEach((d) => {
      const dayKey = d.toDateString();
      const dayEvents = evts.filter((e) => new Date(e.start).toDateString() === dayKey);
      const allDay = dayEvents.filter((e) => e.allDay);
      const timed = dayEvents.filter((e) => !e.allDay);
      let cells = hours.map((h) => {
        const items = timed.filter((e) => Math.floor(new Date(e.start).getHours() / 2) * 2 === h);
        return `<div class="wk-cell">${items.map((e) => `<div class="evt evt-${e.kind} ${isConf(e, conflicts) ? 'conf' : ''}" data-act="evt-open" data-id="${e.id}" data-kind="${e.kind}" data-ref="${e.refId || ''}"><span class="evt-t">${String(new Date(e.start).getHours()).padStart(2, '0')}:${String(new Date(e.start).getMinutes()).padStart(2, '0')}</span>${esc(e.title)}</div>`).join('')}</div>`;
      }).join('');
      grid += `<div class="wk-col"><div class="wk-allday">${allDay.map((e) => `<div class="evt evt-${e.kind}" data-act="evt-open" data-id="${e.id}" data-kind="${e.kind}" data-ref="${e.refId || ''}">${esc(e.title)}</div>`).join('')}</div><div class="wk-hours">${cells}</div></div>`;
    });
    return { html: `<div class="wk-head-row"><div class="wk-corner"></div>${head}</div><div class="wk-scroll"><div class="wk-times"><div class="wk-spad"></div>${hours.map((h) => `<div class="wk-time">${String(h).padStart(2, '0')}:00</div>`).join('')}</div><div class="wk-grid">${grid}</div></div><div class="wk-legend">图例：<span class="lg"><i class="lg-task"></i>任务</span><span class="lg"><i class="lg-hearing"></i>开庭</span><span class="lg"><i class="lg-contract"></i>合同到期</span><span class="lg"><i class="lg-renewal"></i>续费</span><span class="lg"><i class="lg-manual"></i>手动日程</span>${conflicts.length ? '<span class="lg"><i class="lg-conf"></i>冲突</span>' : ''}</div>`, label };
  }
  function isConf(e, conflicts) { return conflicts.some((c) => c.a === e.id || c.b === e.id); }
  function monthView(ref, evts) {
    const y = ref.getFullYear(), m = ref.getMonth();
    const first = new Date(y, m, 1); const start = startOfWeek(first);
    const label = y + '年' + (m + 1) + '月';
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const inMonth = d.getMonth() === m; const today = new Date(); today.setHours(0, 0, 0, 0); const isT = d.getTime() === today.getTime();
      const dayEvents = evts.filter((e) => new Date(e.start).toDateString() === d.toDateString());
      cells += `<div class="mc ${inMonth ? '' : 'out'} ${isT ? 'istoday' : ''}"><div class="mc-d">${d.getDate()}</div>${dayEvents.slice(0, 3).map((e) => `<div class="evt evt-${e.kind} sm" data-act="evt-open" data-id="${e.id}" data-kind="${e.kind}" data-ref="${e.refId || ''}">${esc(e.title)}</div>`).join('')}${dayEvents.length > 3 ? '<div class="mc-more">+' + (dayEvents.length - 3) + '</div>' : ''}</div>`;
    }
    return { html: `<div class="mc-grid">${cells}</div>`, label };
  }
  function detectConflicts(evts) {
    const out = []; const timed = evts.filter((e) => !e.allDay && e.start);
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      if (new Date(a.start).toDateString() !== new Date(b.start).toDateString()) continue;
      const as = new Date(a.start), ae = a.end ? new Date(a.end) : new Date(as.getTime() + 3600000);
      const bs = new Date(b.start), be = b.end ? new Date(b.end) : new Date(bs.getTime() + 3600000);
      if (as < be && bs < ae) out.push({ a: a.id, b: b.id, aTitle: a.title, bTitle: b.title });
    }
    return out;
  }

  /* ===================== 项目管理（schema 驱动的通用模板 + 类别扩展） =====================
   * 设计原则：
   *  1) 通用字段模块（PROJ_GENERIC_MODULES）适用于所有类别，不假设任何特定角色（如债权人）。
   *  2) 类别模板（PROJ_CATEGORY_TEMPLATES）只扩展本类别专属字段，绝不重复通用字段。
   *  3) 详情/表单/解析均由 projectModules(p) 统一驱动，新增类别只需在下面加一个模板。
   * 字段描述符：{ key, label, type:'text'|'date'|'datetime'|'textarea'|'select', options?, wide?, rows?, ph? }
   */
  const PROJ_CATEGORIES = ['诉讼类', '执行类', '破产类', '其他类'];

  // —— 通用模块（所有项目共享）——
  const PROJ_GENERIC_MODULES = [
    { section: '基础信息', fields: [
      { key: 'name', label: '项目名称', type: 'text', wide: true, ph: '如：百高项目债权处置' },
      { key: 'status', label: '状态', type: 'select', options: ['进行中', '已暂停', '已完成', '已结案'] },
      { key: 'category', label: '项目类别', type: 'select', options: PROJ_CATEGORIES },
      { key: 'tags', label: '标签（逗号分隔）', type: 'text', wide: true },
      { key: 'cause', label: '案由', type: 'text' },
      { key: 'caseNo', label: '主案号', type: 'text' }
    ] },
    { section: '当事人信息', fields: [
      { key: 'party', label: '当事人（我方委托人）', type: 'text' },
      { key: 'opponent', label: '对方当事人', type: 'text' },
      { key: 'contact', label: '对接人', type: 'text' },
      { key: 'contactContact', label: '对接人联系方式', type: 'text' }
    ] },
    { section: '合同信息', fields: [
      { key: 'contractName', label: '合同名称', type: 'text' },
      { key: 'contractNo', label: '合同编号', type: 'text' },
      { key: 'agentLawyer', label: '代理律师', type: 'text', wide: true },
      { key: 'signDate', label: '签约时间', type: 'date' }
    ] },
    { section: '费用信息', fields: [
      { key: 'fee', label: '律师费', type: 'text', wide: true, ph: '前期固定 / 后期按回款比例，可合并填写' },
      { key: 'feePayment', label: '付款情况', type: 'text', wide: true },
      { key: 'feeExtraction', label: '提取情况', type: 'text', wide: true },
      { key: 'transferTime', label: '转付时间', type: 'date' },
      { key: 'transferAmount', label: '转付金额', type: 'text' }
    ] },
    { section: '查封与保全信息', fields: [
      { key: 'seizures', label: '查封与保全（多项抵质押物 / 查封物）', type: 'seizures', wide: true }
    ] },
    { section: '时间节点', fields: [
      { key: 'hearingDate', label: '开庭日期', type: 'datetime' },
      { key: 'contractExpiryDate', label: '合同到期日', type: 'date' },
      { key: 'renewalDate', label: '查封到期提醒日', type: 'date' }
    ] }
  ];

  // —— 类别专属模板（仅扩展本类别字段，不重复通用模块）——
  const PROJ_CATEGORY_TEMPLATES = {
    '诉讼类': { modules: [] },
    '执行类': { modules: [
      { section: '执行要素', fields: [
        { key: 'execCourt', label: '执行法院', type: 'text', wide: true },
        { key: 'execCaseNo', label: '执行案号', type: 'text' },
        { key: 'applicant', label: '申请执行人', type: 'text' },
        { key: 'executed', label: '被执行人', type: 'text' },
        { key: 'execObject', label: '执行标的', type: 'text', wide: true },
        { key: 'assetClue', label: '财产线索', type: 'textarea', wide: true, rows: 2 },
        { key: 'execStatus', label: '执行状态', type: 'select', options: ['立案', '网络查控', '财产处置/拍卖', '终本', '结案'] },
        { key: 'recovered', label: '已执行到位金额', type: 'text' }
      ] }
    ] },
    '破产类': { modules: [
      { section: '破产要素', fields: [
        { key: 'creditors', label: '债权持有人（多项，点击展开债权流转明细）', type: 'creditors', wide: true },
        { key: 'debtor', label: '债务人', type: 'text' },
        { key: 'admin', label: '管理人', type: 'text' },
        { key: 'claimAmount', label: '债权金额', type: 'text' },
        { key: 'bankruptcyStage', label: '破产阶段', type: 'select', options: ['申请', '受理', '重整', '和解', '清算', '结案'] }
      ] }
    ] },
    '其他类': { modules: [] }
  };

  function projectModules(p) {
    const cat = (p && p.category) || '其他类';
    const tpl = PROJ_CATEGORY_TEMPLATES[cat] || PROJ_CATEGORY_TEMPLATES['其他类'];
    return PROJ_GENERIC_MODULES.concat(tpl.modules);
  }
  function projectField(f, p) {
    if (f.type === 'seizures') return szEditorHtml(p ? p.seizures : []);
    if (f.type === 'creditors') return creditorEditorHtml(p ? p.creditors : []);
    let val = p ? p[f.key] : '';
    if (f.type === 'date' && val) val = ('' + val).slice(0, 10);
    if (f.type === 'datetime' && val) val = ('' + val).slice(0, 16);
    const opts = f.options ? { options: f.options } : {};
    const wide = f.wide ? { wide: true } : {};
    const rows = f.rows ? { rows: f.rows } : {};
    const ph = f.ph ? { ph: f.ph } : {};
    return field(f.key, f.label, f.type, val, Object.assign({}, wide, opts, rows, ph));
  }
  function formatFieldValue(v, type) {
    if (v == null || v === '') return '';
    if (type === 'date' || type === 'datetime') return fmtDate(v);
    return v;
  }
  // 关联案件 schema：复用项目全维度字段，仅将「项目名称」标签改为「案件名称」
  function caseModules(c) {
    const mods = projectModules(c);
    return mods.map((m) => ({ section: m.section, fields: m.fields.map((f) => f.key === 'name' ? Object.assign({}, f, { label: '案件名称', ph: '如：变更执行人执行案' }) : f) }));
  }
  // 对外暴露 schema（通用结构即一等公民：新增类别只需在 PROJ_CATEGORY_TEMPLATES 加模板）
  LB.projectSchema = { categories: PROJ_CATEGORIES, genericModules: PROJ_GENERIC_MODULES, categoryTemplates: PROJ_CATEGORY_TEMPLATES, modules: projectModules };

  function viewProjects() {
    const f = state.projFilter;
    let list = S.listProjects();
    if (f.q) list = list.filter((p) => (p.name + (p.party || '') + (p.opponent || '') + (p.caseNo || '') + (p.cause || '') + (p.agentLawyer || '') + (p.category || '')).toLowerCase().indexOf(f.q.toLowerCase()) >= 0);
    if (f.status) list = list.filter((p) => p.status === f.status);
    if (f.cause) list = list.filter((p) => p.cause === f.cause);
    if (f.tag) list = list.filter((p) => (p.tags || []).indexOf(f.tag) >= 0);
    const hasFilter = !!(f.q || f.status || f.cause || f.tag);
    if (hasFilter) list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); // 无筛选时按 DB 数组顺序（即拖拽手动顺序）
    const causes = Array.from(new Set(S.listProjects().map((p) => p.cause).filter(Boolean)));
    const tags = Array.from(new Set(S.listProjects().flatMap((p) => p.tags || [])));
    const cards = list.map((p) => {
      const open = S.listTasks().filter((t) => t.projectId === p.id && t.status !== '已完成').length;
      const expanded = state.projOpenId === p.id;
      const subBits = [esc(p.category || '其他类'), `${open} 个待办`, p.cause ? esc(p.cause) : null].filter(Boolean);
      return `<li class="proj-row" data-id="${p.id}">
        <div class="card-pill is-proj" data-act="proj-toggle" data-id="${p.id}">
          <span class="drag-handle" data-drag-handle title="拖拽排序">⠿</span>
          <div class="card-pill-meta"><span class="st ${STAT[p.status] || ''}" style="font-size:var(--fs-xs)">${p.status}</span></div>
          <div class="card-pill-main">
            <div class="card-pill-title">${esc(p.name)}</div>
            <div class="card-pill-sub">${subBits.join(' · ')}${(p.tags || []).length ? ' · ' + p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : ''}</div>
          </div>
          <div class="card-pill-actions">
            <button class="mini" data-act="proj-edit" data-id="${p.id}">编辑</button>
            <button class="mini danger" data-act="proj-del" data-id="${p.id}">删</button>
          </div>
        </div>
        ${expanded ? `<div class="proj-detail-card">${projDetailHtml(p)}</div>` : ''}
      </li>`;
    }).join('');
    return `
    <div class="toolbar">
      <input class="search" data-act="proj-q" placeholder="搜索项目/债权人/对方/案号…" value="${esc(f.q)}">
      <select data-act="proj-status">${['<option value="">全部状态</option>'].concat(['进行中', '已暂停', '已完成', '已结案'].map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`)).join('')}</select>
      <select data-act="proj-cause">${['<option value="">全部案由</option>'].concat(causes.map((c) => `<option ${f.cause === c ? 'selected' : ''}>${esc(c)}</option>`)).join('')}</select>
      <select data-act="proj-tag">${['<option value="">全部标签</option>'].concat(tags.map((t) => `<option ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`)).join('')}</select>
      <button class="btn primary" data-act="proj-new">+ 新建项目</button>
    </div>
    <ul class="card-list proj-list">${cards || `<li class="empty"><p>还没有匹配的项目，点击右上角「+ 新建项目」开始登记台账。</p></li>`}</ul>`;
  }
  function kv(label, val) { return `<div class="kv"><span class="kv-k">${label}</span><span class="kv-v">${esc(val) || '—'}</span></div>`; }
  function projDetailHtml(p) {
    const tasks = S.listTasks().filter((t) => t.projectId === p.id);
    const mods = projectModules(p);
    const secHtml = mods.map((m) => `<div><div class="kv-sec">${m.section}</div>${m.fields.map((f) => f.key === 'seizures' ? szDetailHtml(p.seizures) : f.key === 'creditors' ? crDetailHtml(p.creditors) : kv(f.label, formatFieldValue(p[f.key], f.type))).join('')}</div>`).join('');
    const notesHtml = (p.notes && p.notes.length) ? p.notes.map((d, i) => `<li><span class="prog-d">${esc(d.date || '')}</span><span class="prog-c">${esc(d.content || '')}</span><span class="prog-a">${esc(d.recipient ? ('接收人：' + d.recipient) : '')}${d.archiveLocation ? (' · 位置：' + d.archiveLocation) : ''}${d.archiveCabinet ? (' · 柜：' + d.archiveCabinet) : ''}${d.author ? (' · ' + d.author) : ''} <button class="mini danger" data-act="proj-delnote" data-id="${p.id}" data-doc="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无备注</li>';
    return `<div class="proj-detail">
      <div class="kv-grid">${secHtml}</div>
      <div class="kv-sec">关联案件（${esc(String((p.cases || []).length))}）</div>
      <div class="cases-area">${casesHtml(p)}</div>
      <div class="ph"><button class="mini" data-act="case-new" data-id="${p.id}">+ 关联案件</button></div>
      <div class="kv-sec">其他备注</div>
      <ul class="prog">${notesHtml}</ul>
      <div class="kv-sec">进展状态</div>
      <ul class="prog">${(p.progress || []).map((x, i) => `<li><span class="prog-d">${esc(x.date)}</span><span class="prog-c">${esc(x.content)}</span><span class="prog-a"><button class="mini" data-act="proj-editprog" data-id="${p.id}" data-idx="${i}">编辑</button> <button class="mini danger" data-act="proj-delprog" data-id="${p.id}" data-idx="${i}">删</button></span></li>`).join('') || '<li class="empty">暂无进展</li>'}</ul>
      <div class="kv-sec">关联任务</div>
      <ul class="prog">${tasks.map((t) => `<li><span class="prog-d">${fmtDate(t.dueDate)}</span><span class="prog-c">${esc(t.title)}</span><span class="prog-a"><span class="st st-${taskStatusClass(t.status)} st-act" data-act="task-status" data-id="${t.id}">${t.status}</span></span></li>`).join('') || '<li class="empty">暂无任务</li>'}</ul>
      <div class="ph"><button class="mini" data-act="proj-addtask" data-id="${p.id}">+ 任务</button><button class="mini" data-act="proj-addprog" data-id="${p.id}">+ 进展</button><button class="mini" data-act="proj-edit" data-id="${p.id}">编辑</button><button class="mini danger" data-act="proj-del" data-id="${p.id}">删除</button></div>
    </div>`;
  }
  function projForm(p) {
    p = p || {};
    const mods = projectModules(p);
    const secs = mods.map((m) => `<div class="form-sec"><div class="kv-sec">${m.section}</div><div class="form-grid">${m.fields.map((f) => projectField(f, p)).join('')}</div></div>`).join('');
    const notesSec = `<div class="form-sec"><div class="kv-sec">其他备注（本次新增，留空忽略）</div><div class="form-grid">${field('noteRecipient', '接收人', 'text', '')}${field('noteContent', '备注', 'text', '', { wide: true })}${field('noteArchiveLocation', '纸质档案位置', 'text', '')}${field('noteArchiveCabinet', '档案柜', 'text', '')}</div></div>`;
    const progSec = `<div class="form-sec"><div class="kv-sec">进展状态（本次新增，留空忽略）</div><div class="form-grid">${field('progressNote', '本次进展', 'textarea', '', { wide: true, rows: 2 })}</div></div>`;
    return secs + notesSec + progSec;
  }
  function openProjForm(id, draft) {
    const base = id ? S.getProject(id) : {};
    const p = Object.assign({}, base, draft || {});
    if (!p.category) p.category = '其他类';
    const cat = p.category;
    openModal(id ? '编辑项目（' + cat + '）' : '新建项目（登记台账）', projForm(p), (v) => {
      const c = v.category || '其他类';
      const tpl = PROJ_CATEGORY_TEMPLATES[c] || PROJ_CATEGORY_TEMPLATES['其他类'];
      const allFields = PROJ_GENERIC_MODULES.concat(tpl.modules).reduce((a, m) => a.concat(m.fields), []);
      const data = {};
      allFields.forEach((f) => {
        let val = v[f.key];
        if (f.type === 'date' || f.type === 'datetime') val = val ? new Date(val).toISOString() : null;
        else val = (val == null ? '' : val);
        data[f.key] = val;
      });
      // 查封与保全：从多项编辑器收集，并按最早查封截止日自动回填「查封到期提醒日」（提前 30 天，便于办理续封）
      data.seizures = collectSeizureItems();
      if (data.seizures.length) {
        const ends = data.seizures.map((s) => s.end).filter(Boolean).sort();
        if (ends.length) { const lead = szAddMonths(ends[0], -30); if (lead) data.renewalDate = new Date(lead + 'T00:00:00.000Z').toISOString(); }
      }
      // 破产要素：仅当类别为破产类时从编辑器收集多项债权持有人；否则保留既有数据
      data.creditors = (c === '破产类') ? collectCreditorItems() : (base && base.creditors ? base.creditors.slice() : []);
      data.name = data.name || (base && base.name) || '未命名项目';
      data.tags = v.tags ? v.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : (base ? base.tags : []);
      data.notes = (base && base.notes) ? base.notes.slice() : [];
      data.progress = (base && base.progress) ? base.progress.slice() : [];
      data.cases = (base && base.cases) ? base.cases.slice() : [];
      if (id) { data.id = id; S.saveProject(data, false); }
      else { S.saveProject(data, true); }
      const pid = id || data.id;
      if (v.noteContent) S.addNote(pid, { recipient: v.noteRecipient, content: v.noteContent, archiveLocation: v.noteArchiveLocation, archiveCabinet: v.noteArchiveCabinet });
      if (v.progressNote) S.addProgress(pid, { content: v.progressNote });
      closeModal(); render();
    });
    const sel = $('#modal-body [data-field="category"]');
    if (sel) sel.onchange = () => { const extra = (cat === '破产类') ? { creditors: collectCreditorItems() } : {}; openProjForm(id, Object.assign(collectForm(), { seizures: collectSeizureItems() }, extra)); };
    bindSeizureEditor(); bindCreditorEditor();
  }
  function bindProjForm(id) { openProjForm(id, null); }

  /* ===================== 关联案件（每个案件独立区块，与项目同维度） ===================== */
  function casesHtml(p) {
    const cases = p.cases || [];
    if (!cases.length) return '<div class="empty"><p>暂无关联案件，点击「+ 关联案件」登记与项目同维度的案件详情。</p></div>';
    return `<ul class="card-list cases-list">${cases.map((c) => {
      const open = state.openCases[c.id];
      const subBits = [esc(c.category || '其他类'), c.cause ? esc(c.cause) : null, c.caseNo ? '案号 ' + esc(c.caseNo) : null, (c.progress ? c.progress.length : 0) + ' 条进展'].filter(Boolean);
      return `<li class="case-block">
        <div class="case-block-head" data-act="case-toggle" data-pid="${p.id}" data-cid="${c.id}">
          <div class="card-pill-meta"><span class="st ${STAT[c.status] || ''}">${c.status || '进行中'}</span></div>
          <div class="case-block-main">
            <div class="case-block-title">${esc(c.name || '未命名案件')}</div>
            <div class="case-block-sub">${subBits.join(' · ')}</div>
          </div>
          <div class="case-block-actions">
            <button class="mini" data-act="case-edit" data-pid="${p.id}" data-cid="${c.id}">编辑</button>
            <button class="mini danger" data-act="case-del" data-pid="${p.id}" data-cid="${c.id}">删除</button>
          </div>
        </div>
        ${open ? caseDetailHtml(p, c) : ''}
      </li>`;
    }).join('')}</ul>`;
  }
  function caseDetailHtml(p, c) {
    const mods = caseModules(c);
    const secHtml = mods.map((m) => `<div><div class="kv-sec">${m.section}</div>${m.fields.map((f) => f.key === 'seizures' ? szDetailHtml(c.seizures) : f.key === 'creditors' ? crDetailHtml(c.creditors) : kv(f.label, formatFieldValue(c[f.key], f.type))).join('')}</div>`).join('');
    const notesHtml = (c.notes && c.notes.length) ? c.notes.map((d, i) => `<li><span class="prog-d">${esc(d.date || '')}</span><span class="prog-c">${esc(d.content || '')}</span><span class="prog-a">${esc(d.recipient ? ('接收人：' + d.recipient) : '')}${d.archiveLocation ? (' · 位置：' + d.archiveLocation) : ''}${d.archiveCabinet ? (' · 柜：' + d.archiveCabinet) : ''}${d.author ? (' · ' + d.author) : ''} <button class="mini danger" data-act="case-delnote" data-pid="${p.id}" data-cid="${c.id}" data-doc="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无备注</li>';
    const progHtml = (c.progress && c.progress.length) ? c.progress.map((x, i) => `<li><span class="prog-d">${esc(x.date)}</span><span class="prog-c">${esc(x.content)}</span><span class="prog-a"><button class="mini" data-act="case-editprog" data-pid="${p.id}" data-cid="${c.id}" data-idx="${i}">编辑</button> <button class="mini danger" data-act="case-delprog" data-pid="${p.id}" data-cid="${c.id}" data-idx="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无进展</li>';
    return `<div class="case-detail">
      <div class="kv-grid">${secHtml}</div>
      <div class="kv-sec">其他备注</div>
      <ul class="prog">${notesHtml}</ul>
      <div class="kv-sec">进展状态</div>
      <ul class="prog">${progHtml}</ul>
      <div class="ph"><button class="mini" data-act="case-addprog" data-pid="${p.id}" data-cid="${c.id}">+ 进展</button><button class="mini" data-act="case-edit" data-pid="${p.id}" data-cid="${c.id}">编辑</button><button class="mini danger" data-act="case-del" data-pid="${p.id}" data-cid="${c.id}">删除</button></div>
    </div>`;
  }
  function caseForm(c) {
    c = c || {};
    const mods = caseModules(c);
    const secs = mods.map((m) => `<div class="form-sec"><div class="kv-sec">${m.section}</div><div class="form-grid">${m.fields.map((f) => projectField(f, c)).join('')}</div></div>`).join('');
    const notesSec = `<div class="form-sec"><div class="kv-sec">其他备注（本次新增，留空忽略）</div><div class="form-grid">${field('noteRecipient', '接收人', 'text', '')}${field('noteContent', '备注', 'text', '', { wide: true })}${field('noteArchiveLocation', '纸质档案位置', 'text', '')}${field('noteArchiveCabinet', '档案柜', 'text', '')}</div></div>`;
    const progSec = `<div class="form-sec"><div class="kv-sec">进展状态（本次新增，留空忽略）</div><div class="form-grid">${field('progressNote', '本次进展', 'textarea', '', { wide: true, rows: 2 })}</div></div>`;
    return secs + notesSec + progSec;
  }
  function openCaseForm(projectId, caseId, draft) {
    const p = S.getProject(projectId); if (!p) return;
    const base = caseId ? (S.getCase(projectId, caseId) || {}) : {};
    const c = Object.assign({}, base, draft || {});
    if (!c.category) c.category = p.category || '其他类';
    const cat = c.category;
    openModal(caseId ? '编辑关联案件（' + cat + '）' : '新建关联案件（' + cat + '）', caseForm(c), (v) => {
      const cc = v.category || '其他类';
      const tpl = PROJ_CATEGORY_TEMPLATES[cc] || PROJ_CATEGORY_TEMPLATES['其他类'];
      const allFields = PROJ_GENERIC_MODULES.concat(tpl.modules).reduce((a, m) => a.concat(m.fields), []);
      const data = {};
      allFields.forEach((f) => {
        let val = v[f.key];
        if (f.type === 'date' || f.type === 'datetime') val = val ? new Date(val).toISOString() : null;
        else val = (val == null ? '' : val);
        data[f.key] = val;
      });
      // 查封与保全：从多项编辑器收集，并按最早查封截止日自动回填「查封到期提醒日」（提前 30 天，便于办理续封）
      data.seizures = collectSeizureItems();
      if (data.seizures.length) {
        const ends = data.seizures.map((s) => s.end).filter(Boolean).sort();
        if (ends.length) { const lead = szAddMonths(ends[0], -30); if (lead) data.renewalDate = new Date(lead + 'T00:00:00.000Z').toISOString(); }
      }
      // 破产要素：仅当类别为破产类时从编辑器收集多项债权持有人；否则保留既有数据
      data.creditors = (cc === '破产类') ? collectCreditorItems() : (base && base.creditors ? base.creditors.slice() : []);
      data.name = data.name || (base && base.name) || '未命名案件';
      data.tags = v.tags ? v.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : (base ? base.tags : []);
      data.notes = (base && base.notes) ? base.notes.slice() : [];
      data.progress = (base && base.progress) ? base.progress.slice() : [];
      if (caseId) { data.id = caseId; S.saveCase(projectId, data, false); }
      else { S.saveCase(projectId, data, true); }
      const cid = caseId || data.id;
      if (v.noteContent) S.addCaseNote(projectId, cid, { recipient: v.noteRecipient, content: v.noteContent, archiveLocation: v.noteArchiveLocation, archiveCabinet: v.noteArchiveCabinet });
      if (v.progressNote) S.addCaseProgress(projectId, cid, { content: v.progressNote });
      closeModal(); render();
    });
    const sel = $('#modal-body [data-field="category"]');
    if (sel) sel.onchange = () => { const extra = (cat === '破产类') ? { creditors: collectCreditorItems() } : {}; openCaseForm(projectId, caseId, Object.assign(collectForm(), { seizures: collectSeizureItems() }, extra)); };
    bindSeizureEditor(); bindCreditorEditor();
  }

  /* ===================== 智能提醒（独立视图） ===================== */
  function viewReminders() {
    const rem = S.reminders();
    const g = { '高': rem.filter((r) => r.level === '高'), '中': rem.filter((r) => r.level === '中') };
    if (!rem.length) return `<div class="panel"><div class="empty"><p>未来 14 天暂无预警，安心推进在手事项。</p></div></div>`;
    return `<div class="toolbar"><span class="hint">基于开庭、合同到期、查封到期与任务截止自动生成，覆盖未来 14 天。</span></div>
    <div class="rem-grid">
      <section class="panel"><h3 class="tt">🔴 高优先预警（${g['高'].length}）</h3>${g['高'].length ? '<ul class="rem-list">' + g['高'].map((r) => `<li class="rem rem-hi"><span class="rem-type">${r.type}</span><span class="rem-proj" data-act="goto-proj" data-id="${r.projectId || ''}">${esc(r.project)}</span><span class="rem-date">${fmtDate(r.date)} ${rel(r.date)}</span></li>`).join('') + '</ul>' : '<p class="empty">无</p>'}</section>
      <section class="panel"><h3 class="tt">🟠 中优先提醒（${g['中'].length}）</h3>${g['中'].length ? '<ul class="rem-list">' + g['中'].map((r) => `<li class="rem rem-mid"><span class="rem-type">${r.type}</span><span class="rem-proj" data-act="goto-proj" data-id="${r.projectId || ''}">${esc(r.project)}</span><span class="rem-date">${fmtDate(r.date)} ${rel(r.date)}</span></li>`).join('') + '</ul>' : '<p class="empty">无</p>'}</section>
    </div>`;
  }

  /* ===================== 人员管理（拆分为「对接人」与「经办法官」两个独立区域） ===================== */
  function viewPersonnel() {
    const cls = S.listClients();
    const jds = S.listJudges();
    const cliCards = cls.length ? `<ul class="card-list">${cls.map((c) => `<li class="card-pill card-pill--personnel" data-act="cli-open" data-id="${c.id}">
      <span class="drag-handle" data-drag-handle title="拖拽排序">⠿</span>
      <span class="cp-cell cp-name">${esc(c.name)}</span>
      <span class="cp-cell cp-proj">${esc(c.project || '—')}${c.company ? '<span class="cp-sub">' + esc(c.company) + '</span>' : ''}</span>
      <span class="cp-cell cp-contact">${esc(c.contact || '—')}<span class="cp-sub">沟通 ${c.records ? c.records.length : 0} 条</span></span>
      <span class="cp-cell cp-addr">${esc(c.address || '—')}</span>
      <span class="cp-cell cp-act">
        <button class="mini" data-act="cli-edit" data-id="${c.id}">编辑</button>
        <button class="mini danger" data-act="cli-del" data-id="${c.id}">删</button>
      </span>
    </li>`).join('')}</ul>` : `<div class="empty"><p>暂无对接人</p></div>`;
    const judCards = jds.length ? `<ul class="card-list">${jds.map((j) => `<li class="card-pill card-pill--personnel" data-act="jud-open" data-id="${j.id}">
      <span class="drag-handle" data-drag-handle title="拖拽排序">⠿</span>
      <span class="cp-cell cp-name">${esc(j.name)}</span>
      <span class="cp-cell cp-proj">${esc(j.case || '—')}${j.court ? '<span class="cp-sub">' + esc(j.court) + '</span>' : ''}</span>
      <span class="cp-cell cp-contact">${esc(j.contact || '—')}<span class="cp-sub">沟通 ${j.records ? j.records.length : 0} 条</span></span>
      <span class="cp-cell cp-addr">${esc(j.address || '—')}</span>
      <span class="cp-cell cp-act">
        <button class="mini" data-act="jud-edit" data-id="${j.id}">编辑</button>
        <button class="mini danger" data-act="jud-del" data-id="${j.id}">删</button>
      </span>
    </li>`).join('')}</ul>` : `<div class="empty"><p>暂无经办法官</p></div>`;
    return `
    <section class="panel">
      <div class="ph"><h3 class="tt">对接人</h3><button class="link" data-act="cli-new">+ 新建对接人</button></div>
      <div class="card-list-head card-list-head--personnel">
        <span></span><span>姓名</span><span>所属项目</span><span>联系电话</span><span>地址</span><span></span>
      </div>
      ${cliCards}
    </section>
    <section class="panel">
      <div class="ph"><h3 class="tt">经办法官</h3><button class="link" data-act="jud-new">+ 新建经办法官</button></div>
      <div class="card-list-head card-list-head--personnel">
        <span></span><span>经办人</span><span>所属案件</span><span>联系方式</span><span>地址</span><span></span>
      </div>
      ${judCards}
    </section>`;
  }
  function cliForm(c) { c = c || {}; const projOpts = S.listProjects().map((p) => p.name); return field('name', '对接人', 'text', c.name) + fieldCombo('project', '所属项目', c.project, projOpts, { wide: true }) + field('company', '所属公司', 'text', c.company) + field('contact', '联系方式', 'text', c.contact) + field('address', '地址', 'text', c.address, { wide: true }); }
  function bindCliForm(id) { const c = id ? S.getClient(id) : null; openModal(id ? '编辑对接人' : '新建对接人', cliForm(c), (v) => { const data = { name: v.name, project: v.project, company: v.company, contact: v.contact, address: v.address }; if (id) { data.id = id; S.saveClient(data, false); } else S.saveClient(data, true); closeModal(); render(); }); }
  function cliDetail(id) {
    const c = S.getClient(id); if (!c) return;
    openModal(c.name + '（对接人）', `<div class="detail"><div class="dl"><div><b>所属项目</b>${esc(c.project || '—')}</div><div><b>所属公司</b>${esc(c.company || '—')}</div><div><b>联系方式</b>${esc(c.contact || '—')}</div><div><b>地址</b>${esc(c.address || '—')}</div></div>
      <h4>沟通情况</h4><ul class="prog">${(c.records || []).map((r) => `<li><span class="prog-d">${esc(r.date)}</span><span class="prog-c">${esc(r.content)}</span><span class="prog-a">${esc(r.by)}</span></li>`).join('') || '<li class="empty">暂无记录</li>'}</ul>
      <div class="ph"><button class="mini" data-act="cli-addrec" data-id="${c.id}">+ 沟通</button><button class="mini" data-act="cli-edit" data-id="${c.id}">编辑</button><button class="mini danger" data-act="cli-del" data-id="${c.id}">删除</button></div></div>`, null, { readonly: true });
  }
  function judForm(j) { j = j || {}; const projOpts = S.listProjects().map((p) => p.name); return field('name', '经办人', 'text', j.name) + fieldCombo('case', '所属案件', j.case, projOpts, { wide: true }) + field('court', '法院', 'text', j.court) + field('contact', '联系方式', 'text', j.contact) + field('address', '地址', 'text', j.address, { wide: true }); }
  function bindJudForm(id) { const j = id ? S.getJudge(id) : null; openModal(id ? '编辑经办法官' : '新建经办法官', judForm(j), (v) => { const data = { name: v.name, case: v.case, court: v.court, contact: v.contact, address: v.address }; if (id) { data.id = id; S.saveJudge(data, false); } else S.saveJudge(data, true); closeModal(); render(); }); }
  function judDetail(id) {
    const j = S.getJudge(id); if (!j) return;
    openModal(j.name + '（经办法官）', `<div class="detail"><div class="dl"><div><b>所属案件</b>${esc(j.case || '—')}</div><div><b>法院</b>${esc(j.court || '—')}</div><div><b>联系方式</b>${esc(j.contact || '—')}</div><div><b>地址</b>${esc(j.address || '—')}</div></div>
      <h4>沟通情况</h4><ul class="prog">${(j.records || []).map((r) => `<li><span class="prog-d">${esc(r.date)}</span><span class="prog-c">${esc(r.content)}</span><span class="prog-a">${esc(r.by)}</span></li>`).join('') || '<li class="empty">暂无记录</li>'}</ul>
      <div class="ph"><button class="mini" data-act="jud-addrec" data-id="${j.id}">+ 沟通</button><button class="mini" data-act="jud-edit" data-id="${j.id}">编辑</button><button class="mini danger" data-act="jud-del" data-id="${j.id}">删除</button></div></div>`, null, { readonly: true });
  }

  /* ===================== 数据导出 ===================== */
  function viewExport() {
    return `<div class="export-wrap">
      <section class="panel"><h3 class="tt">报表导出</h3><p class="hint">CSV 可用 Excel 打开，JSON 用于备份与多端恢复。</p>
        <div class="exp-btns"><button class="btn" data-act="exp" data-t="projects">导出案件台账(CSV)</button><button class="btn" data-act="exp" data-t="cases">导出关联案件(CSV)</button><button class="btn" data-act="exp" data-t="tasks">导出任务(CSV)</button><button class="btn" data-act="exp" data-t="clients">导出对接人(CSV)</button><button class="btn" data-act="exp" data-t="judges">导出经办法官(CSV)</button><button class="btn primary" data-act="exp-json">导出全量备份(JSON)</button></div>
        <p class="sync-state">上次同步：${S.meta().lastSync ? fmtDT(S.meta().lastSync) : '—'}</p></section>
      <section class="panel"><h3 class="tt">数据恢复 / 多端同步</h3><p class="hint">导入 JSON 备份以恢复数据；同源多标签页通过 BroadcastChannel 实时同步。</p>
        <div class="exp-btns"><label class="btn">选择备份文件导入<input type="file" id="imp-file" accept="application/json" hidden></label><button class="btn danger" data-act="reset-demo">恢复示范数据</button></div></section>
    </div>

    <section class="panel" style="max-width:960px">
      <h3 class="tt" style="margin:0 0 6px">导出二次校验（连接后端数据库）</h3>
      <p class="hint" style="margin:0 0 14px">先把当前数据同步到真实 SQLite 后端，导出前让后端按台账规则做一致性校验，返回缺失字段、逻辑冲突、孤儿任务等问题清单。</p>
      <div class="exp-btns">
        <button class="btn primary" data-act="exp-sync">同步到后端数据库</button>
        <button class="btn" data-act="exp-validate">导出前二次校验</button>
        <button class="btn" data-act="exp-db-health">检查后端状态</button>
      </div>
      <div id="validate-result" class="validate-result">${state.validateHtml || ''}</div>
    </section>`;
  }
  const API_BASE = (location.port === '8200') ? '' : 'http://localhost:8200';
  const REMOTE = (location.port === '8200' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  /* 本地同步服务：每次变更防抖推送；启动时拉取（最后写入者胜出） */
  let _saveTimer = null;
  LB.onPersist = function (db) {
    if (!REMOTE) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      fetch(API_BASE + '/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db }) })
        .then((r) => r.json()).then((j) => { if (j && j.savedAt) { db.meta = db.meta || {}; db.meta.syncedAt = j.savedAt; } })
        .catch(() => {});
    }, 700);
  };
  async function remoteHydrate() {
    const V = LB.vault;
    if (V && V.enabled && !V.isUnlocked()) return; // 锁定状态无密钥，跳过（避免拿到密文也无法解密）
    // 本地 / 8200 ：连本地同步服务
    if (REMOTE) {
      try {
        const r = await fetch(API_BASE + '/api/load');
        const j = await r.json();
        if (j && j.db) {
          let remoteDb = j.db;
          // 服务端返回密文（v1: 前缀）→ 本地用密钥解密
          if (typeof remoteDb === 'string' && remoteDb.indexOf('v1:') === 0 && V && V.key) {
            remoteDb = await V.unseal(remoteDb);
          }
          if (remoteDb && remoteDb.projects) {
            const localTs = (S.meta() && S.meta().syncedAt) || null;
            if (!localTs || (j.savedAt && j.savedAt > localTs)) {
              S.importJSON(JSON.stringify(remoteDb));
              S.DB.meta = S.DB.meta || {}; S.DB.meta.syncedAt = j.savedAt;
              await S.persist();
            } else if (localTs && (!j.savedAt || localTs > j.savedAt)) {
              await S.persist(); // 本地较新 → 推回（密文）
            }
          }
        }
      } catch (e) {}
      return;
    }
    // 线上（GitHub Pages 等静态托管）：同源拉取加密数据文件（只读镜像，无密码不可读）
    const IS_ONLINE = location.hostname.endsWith('github.io');
    if (IS_ONLINE) {
      try {
        const r = await fetch('data/workplat.enc.json', { cache: 'no-store' });
        if (!r.ok) return;
        const sealed = await r.text();
        if (typeof sealed === 'string' && sealed.indexOf('v1:') === 0 && V && V.key) {
          const remoteDb = await V.unseal(sealed);
          if (remoteDb && remoteDb.projects) {
            // 线上为只读镜像：以线上最新为准（本地编辑已推送到此）
            S.importJSON(JSON.stringify(remoteDb));
            S.DB.meta = S.DB.meta || {}; S.DB.meta.syncedAt = new Date().toISOString();
            await S.persist();
          }
        }
      } catch (e) {}
      return;
    }
    // 其它未知宿主：不同步
  }
  async function apiValidate() {
    const payload = { projects: S.listProjects(), tasks: S.listTasks(), clients: S.listClients() };
    try {
      const r = await fetch(API_BASE + '/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const res = await r.json();
      state.validateHtml = renderValidate(res, '校验完成');
    } catch (e) {
      state.validateHtml = `<div class="validate-issues"><li><span class="vi-level vi-error">错误</span><span>无法连接后端（${esc(e.message)}）。请确认 server/index.js 已在 8200 端口运行。</span></li></div>`;
    }
    render();
  }
  async function apiSync() {
    try {
      const payload = (LB.vault && LB.vault.isUnlocked()) ? await S.sealedRaw() : S.DB;
      const r = await fetch(API_BASE + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: payload, at: new Date().toISOString() }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const res = await r.json();
      if (res.sealed) state.validateHtml = `<div class="validate-ok">✓ 已加密同步到后端数据库（保存于 ${esc(res.savedAt)}）</div>`;
      else state.validateHtml = `<div class="validate-ok">✓ 已同步到后端数据库：项目 ${res.counts.projects} · 任务 ${res.counts.tasks} · 对接人 ${res.counts.clients}（保存于 ${esc(res.savedAt)}）</div>`;
    } catch (e) {
      state.validateHtml = `<div class="validate-issues"><li><span class="vi-level vi-error">错误</span><span>同步失败（${esc(e.message)}）。请确认后端已在 8200 端口运行。</span></li></div>`;
    }
    render();
  }
  async function apiHealth() {
    try {
      const r = await fetch(API_BASE + '/api/health');
      const res = await r.json();
      state.validateHtml = `<div class="validate-ok">✓ 后端在线：${esc(res.db)}，已存储 ${res.snapshots} 次快照。</div>`;
    } catch (e) {
      state.validateHtml = `<div class="validate-issues"><li><span class="vi-level vi-error">错误</span><span>后端未响应（${esc(e.message)}）。</span></li></div>`;
    }
    render();
  }
  function renderValidate(res, head) {
    if (!res.issues || !res.issues.length) return `<div class="validate-ok">✓ ${esc(head)}：未发现一致性问题（项目 ${res.counts.projects} · 任务 ${res.counts.tasks} · 客户 ${res.counts.clients}）。</div>`;
    const items = res.issues.map((i) => `<li><span class="vi-level vi-${i.level}">${i.level === 'error' ? '错误' : i.level === 'warn' ? '提醒' : '提示'}</span><span>${esc(i.msg)}</span></li>`).join('');
    return `<div class="validate-ok" style="background:oklch(57% 0.048 350 / .10);border-color:var(--c-aud);color:oklch(48% 0.05 350)">${esc(head)}：发现 ${res.issues.length} 项（错误 ${res.issues.filter((x) => x.level === 'error').length} / 提醒 ${res.issues.filter((x) => x.level === 'warn').length}）。</div><ul class="validate-issues">${items}</ul>`;
  }
  function download(name, content, mime) { const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }

  /* ===================== 事件 ===================== */
  function onAct(act, id, el) {
    switch (act) {
      case 'goto-reminders': navigate('reminders'); break;
      case 'goto-proj': if (id) { state.projOpenId = id; navigate('projects'); } break;
      case 'task-new': bindTaskForm(null); break;
      case 'task-edit': bindTaskForm(id); break;
      case 'task-del': confirmModal('确认删除该任务？删除后不可恢复。', () => { S.deleteTask(id); render(); }); break;
      case 'task-toggle': { const t = S.getTask(id); const next = (t.status === '待办') ? '待审阅' : '待办'; S.setTaskStatus(id, next); render(); } break;
      case 'task-status': openTaskStatus(id); break;
      case 'proj-new': bindProjForm(null); break;
      case 'proj-toggle': state.projOpenId = (state.projOpenId === id) ? null : id; render(); break;
      case 'vault-lock': if (LB.vault) LB.vault.lock(); location.reload(); break;
      case 'proj-edit': bindProjForm(id); break;
      case 'proj-del': confirmModal('确认删除该项目及其关联任务？此操作不可撤销。', () => { S.deleteProject(id); if (state.projOpenId === id) state.projOpenId = null; render(); }, { okText: '删除项目' }); break;
      case 'proj-addtask': openModal('新建关联任务', taskForm({ projectId: id }), (v) => { S.saveTask({ title: v.title, priority: v.priority, projectId: id, dueDate: v.dueDate ? new Date(v.dueDate).toISOString() : null, status: v.status }, true); closeModal(); render(); }); break;
      case 'proj-addprog': openModal('添加进展', field('content', '进展说明', 'textarea', ''), (v) => { S.addProgress(id, { content: v.content }); closeModal(); render(); }); break;
      case 'proj-editprog': { const o = S.getProject(id); const x = o && o.progress[parseInt(el.dataset.idx, 10)]; if (x) openProgressEditor('编辑进展', x, (note) => { S.updateProgress(id, parseInt(el.dataset.idx, 10), note); render(); }); break; }
      case 'proj-delprog': confirmModal('确认删除该进展记录？删除后不可恢复。', () => { S.deleteProgress(id, parseInt(el.dataset.idx, 10)); render(); }); break;
      case 'proj-delnote': confirmModal('确认删除该备注？', () => { S.deleteNote(id, parseInt(el.dataset.doc, 10)); render(); }); break;
      case 'cred-toggle': { const cid = el.dataset.id; state.openCreditors[cid] = !state.openCreditors[cid]; render(); break; }
      case 'case-new': openCaseForm(id, null); break;
      case 'case-toggle': { const cid = el.dataset.cid; state.openCases[cid] = !state.openCases[cid]; render(); break; }
      case 'case-edit': openCaseForm(el.dataset.pid, el.dataset.cid); break;
      case 'case-del': confirmModal('确认删除该关联案件？删除后不可恢复。', () => { S.deleteCase(el.dataset.pid, el.dataset.cid); render(); }); break;
      case 'case-addprog': openModal('添加案件进展', field('content', '进展说明', 'textarea', ''), (v) => { S.addCaseProgress(el.dataset.pid, el.dataset.cid, { content: v.content }); closeModal(); render(); }); break;
      case 'case-editprog': { const o = S.getCase(el.dataset.pid, el.dataset.cid); const x = o && o.progress[parseInt(el.dataset.idx, 10)]; if (x) openProgressEditor('编辑案件进展', x, (note) => { S.updateCaseProgress(el.dataset.pid, el.dataset.cid, parseInt(el.dataset.idx, 10), note); render(); }); break; }
      case 'case-delprog': confirmModal('确认删除该案件进展？删除后不可恢复。', () => { S.deleteCaseProgress(el.dataset.pid, el.dataset.cid, parseInt(el.dataset.idx, 10)); render(); }); break;
      case 'case-delnote': confirmModal('确认删除该案件备注？', () => { S.deleteCaseNote(el.dataset.pid, el.dataset.cid, parseInt(el.dataset.doc, 10)); render(); }); break;
      case 'evt-new': openModal('新建日程', field('title', '标题', 'text', '') + field('start', '开始时间', 'datetime', '') + field('end', '结束时间', 'datetime', ''), (v) => { S.saveManualEvent({ title: v.title, start: v.start ? new Date(v.start).toISOString() : new Date().toISOString(), end: v.end ? new Date(v.end).toISOString() : null, projectId: null }, true); closeModal(); render(); }); break;
      case 'evt-open': { const k = el.dataset.kind, ref = el.dataset.ref; if ((k === 'task') && ref) { const t = S.getTask(ref); if (t) openModal('任务', `<div class="detail"><div class="dl"><div><b>任务</b>${esc(t.title)}</div><div><b>优先级</b>${t.priority}</div><div><b>截止</b>${fmtDT(t.dueDate)}</div><div><b>状态</b>${t.status}</div></div></div>`, null, { readonly: true }); } else if ((k === 'hearing' || k === 'contract' || k === 'renewal') && ref) { state.projOpenId = ref; navigate('projects'); } break; }
      case 'cal-prev': state.calDate = shift(state.calDate, state.calMode === 'week' ? -7 : -1); render(); break;
      case 'cal-next': state.calDate = shift(state.calDate, state.calMode === 'week' ? 7 : 1); render(); break;
      case 'cal-today': state.calDate = new Date(); render(); break;
      case 'cal-week': state.calMode = 'week'; render(); break;
      case 'cal-month': state.calMode = 'month'; render(); break;
      case 'cli-new': bindCliForm(null); break;
      case 'cli-open': cliDetail(id); break;
      case 'cli-edit': bindCliForm(id); break;
      case 'cli-del': confirmModal('确认删除该对接人？', () => { S.deleteClient(id); render(); }); break;
      case 'cli-addrec': openModal('添加沟通记录', field('content', '内容', 'textarea', ''), (v) => { S.addClientRecord(id, { content: v.content }); closeModal(); render(); }); break;
      case 'jud-new': bindJudForm(null); break;
      case 'jud-open': judDetail(id); break;
      case 'jud-edit': bindJudForm(id); break;
      case 'jud-del': confirmModal('确认删除该经办法官？', () => { S.deleteJudge(id); render(); }); break;
      case 'jud-addrec': openModal('添加沟通记录', field('content', '内容', 'textarea', ''), (v) => { S.addJudgeRecord(id, { content: v.content }); closeModal(); render(); }); break;
      case 'report-apply': applyReport(); break;
      case 'exp-sync': apiSync(); break;
      case 'exp-validate': apiValidate(); break;
      case 'exp-db-health': apiHealth(); break;
      case 'exp': download('WORK-Plat_' + el.dataset.t + '_' + LB.util.todayStr() + '.csv', '﻿' + S.exportCSV(el.dataset.t), 'text/csv;charset=utf-8'); break;
      case 'exp-json': download('WORK-Plat_backup_' + LB.util.todayStr() + '.json', S.exportJSON(), 'application/json'); break;
      case 'reset-demo': confirmModal('将覆盖当前数据并恢复示范数据，此操作不可撤销，确认？', () => { S.resetDemo(); render(); }, { okText: '恢复示范数据' }); break;
    }
  }
  function shift(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function taskForm(t) {
    t = t || {};
    const opts = S.listProjects().map((p) => p.name);
    return field('title', '任务标题', 'text', t.title, { ph: '如：提交质证意见' }) +
      field('projectId', '关联项目', 'select', (S.getProject(t.projectId) || {}).name || '', { options: [''].concat(opts) }) +
      field('dueDate', '截止日期', 'datetime', t.dueDate ? t.dueDate.slice(0, 16) : '') +
      field('status', '状态', 'select', t.status || '待办', { options: ['待办', '待审阅', '已完成'] });
  }
  function bindTaskForm(id) { const t = id ? S.getTask(id) : null; openModal(id ? '编辑任务' : '新建任务', taskForm(t), (v) => { const pid = v.projectId ? (S.listProjects().find((p) => p.name === v.projectId) || {}).id : null; const data = { title: v.title, projectId: pid, dueDate: v.dueDate ? new Date(v.dueDate).toISOString() : null, status: v.status }; if (id) { data.id = id; S.saveTask(data, false); } else S.saveTask(data, true); closeModal(); render(); }); }

  /* 任务状态快捷设置：待办 → 待审阅 → 已完成（主动置“已完成”会触发自动归档） */
  function openTaskStatus(id) {
    const t = S.getTask(id); if (!t) return;
    const opts = ['待办', '待审阅', '已完成'];
    openModal('设置任务状态', '<div class="status-pick">' + opts.map((s) => `<button class="btn ${s === t.status ? 'primary' : ''}" data-st="${s}" style="display:block;width:100%;margin-bottom:9px">${s}</button>`).join('') + '<p class="hint" style="margin-top:4px">把状态主动改为「已完成」时，系统会自动归档到关联项目，生成“年月日，完成了什么工作”的进展记录。</p></div>', null, { readonly: true });
    $$('#modal-body [data-st]').forEach((b) => { b.onclick = () => { S.setTaskStatus(id, b.dataset.st); closeModal(); render(); }; });
  }

  /* ===================== 拖拽排序（Pointer Events，桌面 + 触屏通用） =====================
   * 手柄式：仅在 .drag-handle 上发起拖拽，避免与卡片点击（展开/打开）冲突；
   * 手柄设 touch-action:none，触屏拖拽不触发页面滚动。拖拽结束后吞掉误触 click。
   */
  function enableSortable(list, opts) {
    const itemSel = opts.itemSelector;
    const getKey = opts.getKey;
    const onEnd = opts.onEnd;
    const THRESH = 6;
    let act = null; // { item, x, y, pointerId, moved, ghost, placeholder, items, fromHandle }
    list.addEventListener('pointerdown', onDown);

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;          // 仅左键 / 触摸
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;                                      // 仅手柄发起拖拽
      const item = e.target.closest(itemSel);
      if (!item || !list.contains(item)) return;
      if (e.target.closest('button, input, select, textarea, a')) return;
      act = { item, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false, ghost: null, placeholder: null, items: [], fromHandle: true };
      try { list.setPointerCapture(e.pointerId); } catch (_) {}
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }

    function onMove(e) {
      if (!act) return;
      const dx = e.clientX - act.x, dy = e.clientY - act.y;
      if (!act.moved) {
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
        act.moved = true;
        const rect = act.item.getBoundingClientRect();
        const ph = document.createElement('li');
        ph.className = 'sort-ph';
        ph.style.height = rect.height + 'px';
        ph.style.listStyle = 'none';
        act.item.parentNode.insertBefore(ph, act.item);
        act.placeholder = ph;
        const g = act.item.cloneNode(true);
        g.className = act.item.className + ' sort-ghost';
        g.style.position = 'fixed';
        g.style.width = rect.width + 'px';
        g.style.left = rect.left + 'px';
        g.style.top = rect.top + 'px';
        g.style.margin = '0';
        g.style.pointerEvents = 'none';
        g.style.zIndex = '9999';
        document.body.appendChild(g);
        act.ghost = g;
        act.offX = act.x - rect.left;
        act.offY = act.y - rect.top;
        act.item.style.display = 'none';
        act.items = Array.from(list.querySelectorAll(itemSel)).filter((it) => it !== act.item);
        e.preventDefault();
      }
      act.ghost.style.left = (e.clientX - act.offX) + 'px';
      act.ghost.style.top = (e.clientY - act.offY) + 'px';
      const others = act.items;
      let placed = false;
      for (let i = 0; i < others.length; i++) {
        const r = others[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { list.insertBefore(act.placeholder, others[i]); placed = true; break; }
      }
      if (!placed) list.appendChild(act.placeholder);
      e.preventDefault();
    }

    function onUp(e) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!act) return;
      try { list.releasePointerCapture(e.pointerId); } catch (_) {}
      if (act.moved) {
        if (act.placeholder && act.placeholder.parentNode) act.placeholder.parentNode.replaceChild(act.item, act.placeholder);
        act.item.style.display = '';
        if (act.ghost) act.ghost.remove();
        const finalKeys = Array.from(list.querySelectorAll(itemSel)).map(getKey).filter(Boolean);
        onEnd(finalKeys);
      }
      // 手柄触发的点击（拖拽或点按）都要吞掉，避免误触卡片的展开/打开
      list.addEventListener('click', swallow, true);
      act = null;
    }

    function swallow(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      list.removeEventListener('click', swallow, true);
    }
  }

  function bindSortables() {
    // 项目管理：仅在无筛选时启用（筛选态按更新时间排序，手动重排无意义）
    const f = state.projFilter;
    const hasFilter = !!(f.q || f.status || f.cause || f.tag);
    const pl = $('.proj-list');
    if (pl && !hasFilter) enableSortable(pl, { itemSelector: '.proj-row', getKey: (el) => el.dataset.id, onEnd: (ids) => S.reorderProjects(ids) });
    // 人员管理：对接人 / 经办法官 两个列表分别独立重排
    $$('.card-list').forEach((ul) => {
      if (!ul.querySelector('.card-pill--personnel')) return;
      enableSortable(ul, {
        itemSelector: '.card-pill--personnel',
        getKey: (el) => el.dataset.id,
        onEnd: (ids) => { const first = ul.querySelector('.card-pill--personnel'); if (first && first.dataset.act === 'cli-open') S.reorderClients(ids); else S.reorderJudges(ids); }
      });
    });
    // 任务管理：仅工作台面板内的任务列表
    const tl = $('.dash-cols .card-list');
    if (tl) enableSortable(tl, { itemSelector: '.card-pill.is-task', getKey: (el) => el.dataset.id, onEnd: (ids) => S.reorderTasks(ids) });
  }

  function bindView() {
    $$('[data-view]').forEach((b) => b.onclick = () => navigate(b.dataset.view));
    $$('[data-act]').forEach((el) => { el.onclick = (e) => { onAct(el.dataset.act, el.dataset.id, el); e.stopPropagation(); }; });
    const pq = $('[data-act="proj-q"]'); if (pq) pq.oninput = (e) => { state.projFilter.q = e.target.value; render(); };
    const ps = $('[data-act="proj-status"]'); if (ps) ps.onchange = (e) => { state.projFilter.status = e.target.value; render(); };
    const pc = $('[data-act="proj-cause"]'); if (pc) pc.onchange = (e) => { state.projFilter.cause = e.target.value; render(); };
    const pt = $('[data-act="proj-tag"]'); if (pt) pt.onchange = (e) => { state.projFilter.tag = e.target.value; render(); };
    const imp = $('#imp-file'); if (imp) imp.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { S.importJSON(rd.result); alert('导入成功'); render(); } catch (err) { alert('导入失败：' + err.message); } }; rd.readAsText(f); };
    // 智能汇报：输入即解析预览 + 句末自动应用
    const ta = $('#report-text');
    if (ta) {
      ta.oninput = () => {
        clearTimeout(rpTimer);
        const v = ta.value;
        rpTimer = setTimeout(() => {
          state.reportPreview = LB.nlp.parse(v); updPreview();
          if (/[。！？；.!?]$/.test(v.trim()) && v.trim() !== state.lastAppliedRaw) {
            setTimeout(() => { if ($('#report-text') && $('#report-text').value === v) applyReport(); }, 650);
          }
        }, 420);
      };
      ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyReport(); } };
    }
    bindSortables();
  }

  LB.onSync = () => { if (state.view) render(); };

  /* ===================== 启动 ===================== */
  function buildShell() {
    const V = LB.vault;
    const lockBtn = (V && V.enabled) ? '<button class="btn ghost vault-lockbtn" data-act="vault-lock" title="锁定并退出">🔒 锁定</button>' : '';
    $('#app').innerHTML = `
      <aside class="sidebar"><div class="brand">WORK-Plat</div><nav id="nav"></nav></aside>
      <main class="main"><header class="topbar"><h2 id="view-title"></h2>${lockBtn}</header>
      <div class="view-scroll"><div id="view" class="view"></div></div></main>
      <div id="modal" class="modal"><div class="modal-mask" data-act="modal-mask"></div><div class="modal-card"><div class="modal-head"><h3 id="modal-title"></h3><button class="x" id="modal-x">×</button></div><div class="modal-body" id="modal-body"></div><div class="modal-foot"><button class="btn" id="modal-cancel">取消</button><button class="btn primary" id="modal-save">保存</button></div></div></div>`;
    $('#modal-x').onclick = closeModal;
    $('.modal-mask').onclick = closeModal;
  }
  function boot() {
    buildShell();
    remoteHydrate().then(render);
  }
  /* 全屏密码锁：未解锁前不渲染任何数据 */
  function renderLock() {
    $('#app').innerHTML = `
      <div class="vault-lock">
        <div class="vault-card">
          <div class="vault-logo">🔒 WORK-Plat</div>
          <p class="vault-sub">此工作台已加密保护</p>
          <p class="vault-sub2">请输入访问密码后使用</p>
          <input id="vault-pw" type="password" class="vault-input" placeholder="访问密码" autocomplete="off" />
          <div id="vault-err" class="vault-err"></div>
          <button id="vault-go" class="btn primary vault-btn">解锁</button>
          <p class="vault-hint">数据在本地以密码加密存储；忘记密码将无法恢复。</p>
        </div>
      </div>`;
    const go = async () => {
      const pw = $('#vault-pw').value;
      if (!pw) { $('#vault-err').textContent = '请输入访问密码'; return; }
      const btn = $('#vault-go'); btn.disabled = true; btn.textContent = '校验中…';
      try {
        await LB.vault.unlock(pw);
        await S.unsealLoad();
        await S.persist();
        boot();
      } catch (e) {
        $('#vault-err').textContent = (e && e.message) || '密码错误';
        btn.disabled = false; btn.textContent = '解锁';
      }
    };
    $('#vault-go').onclick = go;
    const inp = $('#vault-pw');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 0);
  }
  function init() {
    const V = LB.vault;
    if (V && V.enabled && V.locked) { renderLock(); return; }
    boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
