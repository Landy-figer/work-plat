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
    view: 'dashboard', calMode: 'week', calDate: new Date(), evtDetailId: null,
    projFilter: { q: '', status: '', cause: '', tag: '' }, projOpenId: null, openCases: {}, openCreditors: {}, cliFilter: { q: '' }, judFilter: { q: '' },
    reportPreview: null, lastAppliedRaw: '', rpStatus: '', lawQ: '', validateHtml: ''
  };
  let rpTimer = null;

  /* ===================== 导航 ===================== */
  const NAV = [
    { id: 'dashboard', label: '工作台', icon: '▦', c: 'oklch(62% 0.052 240)', title: '工作台' },
    { id: 'calendar', label: '日程管理', icon: '◷', c: 'oklch(59% 0.050 155)', title: '日程管理' },
    { id: 'projects', label: '项目管理', icon: '▤', c: 'oklch(61% 0.058 45)', title: '项目管理' },
    { id: 'clients', label: '对接人', icon: '☺', c: 'oklch(69% 0.058 80)', title: '对接人' },
    { id: 'judges', label: '经办人', icon: '⚖', c: 'oklch(64% 0.060 70)', title: '经办人' },
    { id: 'export', label: '数据导出', icon: '⇩', c: 'oklch(62% 0.048 200)', title: '数据导出' }
  ];
  const NAVC = { dashboard: 'oklch(62% 0.052 240)', calendar: 'oklch(59% 0.050 155)', projects: 'oklch(61% 0.058 45)', clients: 'oklch(69% 0.058 80)', judges: 'oklch(64% 0.060 70)', export: 'oklch(62% 0.048 200)' };

  function navigate(v) { state.view = v; state.reportPreview = null; render(); }

  let lastView = null;
  function render() {
    /* 重渲染前记录当前聚焦的输入（用于检索框输入/删除时不丢失焦点与光标位置） */
    const activeEl = document.activeElement;
    const activeAct = (activeEl && activeEl.dataset && activeEl.dataset.act && /^((proj|cli|jud)-q)$/.test(activeEl.dataset.act)) ? activeEl.dataset.act : null;
    let activeCaret = null;
    if (activeAct && activeEl.selectionStart != null) { try { activeCaret = activeEl.selectionStart; } catch (e) {} }
    $('#nav').innerHTML = NAV.map((n) => {
      const active = state.view === n.id;
      const st = active ? `background:${n.c};color:#fff;border-color:transparent;` : '';
      return `<button class="nav-item ${active ? 'active' : ''}" data-view="${n.id}" style="${st}"><span class="ni" style="background:${active ? '#fff' : n.c}"></span><span>${n.label}</span></button>`;
    }).join('');
    const nv = NAV.find((n) => n.id === state.view) || NAV[0];
    const vt = $('#view-title'); vt.textContent = nv.title; vt.className = 'tt';
    /* 同步浏览器标签页标题：与页面内 H1 一致，格式 `WORK-Plat · 页面标题` */
    if (document.title !== ('WORK-Plat · ' + nv.title)) document.title = 'WORK-Plat · ' + nv.title;
    const view = $('#view'); view.style.setProperty('--mc', NAVC[state.view] || NAVC.dashboard);
    if (state.view === 'dashboard') view.innerHTML = viewDashboard();
    else if (state.view === 'calendar') view.innerHTML = viewCalendar();
    else if (state.view === 'projects') view.innerHTML = viewProjects();
    else if (state.view === 'clients') view.innerHTML = viewClients();
    else if (state.view === 'judges') view.innerHTML = viewJudges();
    else if (state.view === 'export') view.innerHTML = viewExport();
    /* 仅当视图真正切换时才触发入场编排，避免状态更新（勾选/筛选/增删）时整页重放动画 */
    if (state.view !== lastView) {
      view.classList.remove('is-entering');
      void view.offsetWidth; /* 强制回流以重启动画 */
      view.classList.add('is-entering');
      lastView = state.view;
    }
    bindView();
    $('.view-scroll').scrollTop = 0;
    /* 检索框：重渲染后恢复焦点与光标，确保可连续输入/删除 */
    if (activeAct) {
      const nin = $('[data-act="' + activeAct + '"]');
      if (nin && nin.focus) {
        nin.focus();
        if (activeCaret != null && nin.setSelectionRange) { try { nin.setSelectionRange(activeCaret, activeCaret); } catch (e) {} }
      }
    }
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
  /* 轻量 toast 反馈：用于板块新增/恢复等操作的即时状态提示 */
  function toast(msg, kind) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' toast-' + kind : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 2400);
  }
  /* 板块管理弹窗：列出可恢复的板块（已隐藏的固定板块 / 已软删除的自定义板块）并提供恢复入口；
   * 同时内置新增自定义板块表单（名称必填、重名校验）。所有操作即时刷新弹窗与底层列表，形成清晰的状态管理。 */
  function openSectionManager(ctx) {
    const entity = ctx.entity, project = ctx.project;
    const cfg = ensureSectionCfg(entity);
    function bodyHtml() {
      const hidden = cfg.hidden || [];
      const delIds = cfg.deletedSections || [];
      const delRows = delIds.map((id) => {
        const s = (cfg.added || []).find((x) => x.id === id);
        const nm = s ? s.section : '(未知板块)';
        return `<div class="sm-row"><span class="sm-name">${esc(nm)}<span class="sm-tag">自定义</span></span><button class="btn sm-restore" data-restore="added" data-secid="${esc(id)}">恢复</button></div>`;
      }).join('');
      const hidRows = hidden.map((nm) => `<div class="sm-row"><span class="sm-name">${esc(nm)}<span class="sm-tag sm-tag--fix">固定</span></span><button class="btn sm-restore" data-restore="hidden" data-si="${esc(nm)}">恢复</button></div>`).join('');
      const rows = delRows + hidRows;
      const restoreBlock = rows
        ? `<div class="sm-list">${rows}</div>`
        : `<div class="sm-empty">当前没有可恢复的板块。</div>`;
      return `<div class="sec-manage">
        <div class="sm-section">
          <div class="sm-title">恢复已隐藏 / 已删除的板块</div>
          ${restoreBlock}
        </div>
        <div class="sm-section">
          <div class="sm-title">新增自定义板块</div>
          <div class="sm-add">
            <input data-field="secName" type="text" class="sm-input" placeholder="板块名称，如：项目进度、风险评估…">
            <button class="btn primary" id="sm-add-btn">新增</button>
          </div>
          <div class="sm-hint" id="sm-hint"></div>
        </div>
      </div>`;
    }
    openModal('板块管理', bodyHtml(), null, { readonly: true });
    const body = $('#modal-body');
    function bind() {
      body.querySelectorAll('.sm-restore').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.restore === 'hidden') {
            const nm = b.dataset.si;
            cfg.hidden = (cfg.hidden || []).filter((x) => x !== nm);
            toast('已恢复板块「' + nm + '」');
          } else {
            const id = b.dataset.secid;
            cfg.deletedSections = (cfg.deletedSections || []).filter((x) => x !== id);
            const s = (cfg.added || []).find((x) => x.id === id);
            toast('已恢复板块「' + (s ? s.section : '') + '」');
          }
          S.saveProject(project, false);
          $('#modal-body').innerHTML = bodyHtml();
          bind(); render();
        };
      });
      const addBtn = $('#sm-add-btn');
      if (addBtn) addBtn.onclick = () => {
        const inp = body.querySelector('input[data-field="secName"]');
        const hint = $('#sm-hint');
        const name = (inp.value || '').trim();
        if (!name) { if (hint) { hint.textContent = '请输入板块名称'; hint.className = 'sm-hint sm-hint--err'; } return; }
        const exists = projectModules(entity).some((m) => m.section === name) || (cfg.added || []).some((s) => s.section === name) || (cfg.hidden || []).indexOf(name) >= 0;
        if (exists) { if (hint) { hint.textContent = '已存在同名板块，请换一个名称'; hint.className = 'sm-hint sm-hint--err'; } return; }
        cfg.added = cfg.added || [];
        cfg.added.push({ id: 'sec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), section: name, fields: [] });
        S.saveProject(project, false);
        toast('已新增板块「' + name + '」', 'ok');
        $('#modal-body').innerHTML = bodyHtml();
        bind(); render();
      };
    }
    bind();
  }
  function field(name, label, type, val, opts) {    opts = opts || {}; val = val == null ? '' : val;
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
    if (!list.length) return '<div class="sz-empty">暂无查封物</div>';
    return list.map((s) => {
      const e = szCompute(s.type || '不动产', s.start);
      const end = s.end || e.end, rEnd = s.renewalEnd || e.renewalEnd;
      const head = `<div class="sz-item-head"><span class="sz-item-type">${esc(s.type || '')}</span>${s.name ? `<span class="sz-item-name">· ${esc(s.name)}</span>` : ''}</div>`;
      return `${head}
        <div class="kv kv-mod"><span class="kv-k">查封起算时间</span><span class="kv-v">${esc(s.start || '—')}</span></div>
        <div class="kv kv-mod"><span class="kv-k">截止时间</span><span class="kv-v">${esc(end || '—')}</span></div>
        <div class="kv kv-mod"><span class="kv-k">续封时间</span><span class="kv-v">${esc(rEnd || '—')}</span></div>`;
    }).join('');
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
      h.querySelectorAll('.cr-tf-row').forEach((r) => {
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
      else if (ev.target.closest('[data-cr-tf-del]')) { const r = ev.target.closest('.cr-tf-row'); const tf = r.closest('.cr-transfers'); if (r) r.remove(); if (!tf.querySelector('.cr-tf-row')) tf.insertAdjacentHTML('afterbegin', '<div class="cr-empty-sm">暂无流转记录，点击「+ 添加流转」录入。</div>'); }
    });
  }

  /* ===================== 工作台（合并：智能汇报 + 任务 + 提醒） ===================== */
  function viewDashboard() {
    // 任务提醒卡片：合并任务通道（任务截止）与日程通道（开庭/合同到期/查封到期/手动日程），日程项提示直接在此呈现
    const rem = S.reminders().slice(0, 6);
    return `
    <div class="dash-cols">
      <section class="panel">
        <div class="ph"><h3 class="tt">任务管理</h3><button class="link" data-act="task-new">+ 新建任务</button></div>
        ${taskTableHtml(S.listTasks().filter((t) => t.status !== '已完成'))}
      </section>
      <section class="panel">
        <div class="ph"><h3 class="tt">任务提醒</h3></div>
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
      return `<li class="card-pill is-task pri-${priorityClass(t.priority)}${isDone ? ' row-done' : ''}" data-act="task-open" data-id="${t.id}">
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
  function priorityClass(p) { return p === '高' ? 'high' : (p === '中' ? 'mid' : 'low'); }

  function remindersHtml(rem) {
    if (!rem.length) return '<p class="empty">未来 14 天无预警</p>';
    return `<ul class="rem-list">${rem.map((r) => `<li class="rem rem-${r.level === '高' ? 'hi' : 'mid'}"><span class="rem-type">${r.type}</span><span class="rem-proj" data-act="goto-proj" data-id="${r.projectId || ''}">${r.title ? esc(r.title) + (r.project && r.project !== r.title ? ' <i class="rem-projtag">@' + esc(r.project) + '</i>' : '') : esc(r.project)}</span><span class="rem-date">${fmtDate(r.date)} ${rel(r.date)}</span>${r.type !== '任务截止' ? `<button class="rem-done" type="button" data-act="evt-done" data-kind="${r.kind || ''}" data-ref="${r.projectId || ''}" data-case="${r.caseId || ''}" data-evt="${r.eventId || ''}" title="标记完成 / 取消" aria-label="标记完成">✓</button>` : ''}</li>`).join('')}</ul>`;
  }

  /* ===================== 日程管理（周/月视图 + 冲突检测 + 点击交互） ===================== */
  function viewCalendar() {
    const evts = S.deriveEvents();
    const conflicts = detectConflicts(evts);
    let body, label;
    if (state.calMode === 'month') { const r = monthView(state.calDate, evts); body = r.html; label = r.label; }
    else { const r = weekView(state.calDate, evts, conflicts); body = r.html; label = r.label; } /* 默认周视图 */
    const navBar = `<div class="cal-nav"><button class="btn" data-act="cal-prev">‹</button><button class="btn" data-act="cal-today">今天</button><button class="btn" data-act="cal-next">›</button><strong class="cal-label">${label}</strong></div>`;
    /* 点击某条日程展开详情：含所属项目选择、编辑/删除/完成；点击空白处新建已由 evt-empty 处理 */
    let detail = '';
    if (state.evtDetailId) {
      const e = evts.find((x) => x.id === state.evtDetailId);
      if (e) detail = evtDetailPanel(e); else state.evtDetailId = null;
    }
    return `
    <div class="toolbar cal-bar">
      ${navBar}
      <div class="seg"><button class="seg-btn ${state.calMode === 'week' ? 'on' : ''}" data-act="cal-week">周视图</button><button class="seg-btn ${state.calMode === 'month' ? 'on' : ''}" data-act="cal-month">月视图</button></div>
      <button class="btn primary" data-act="evt-new">+ 新建日程</button>
    </div>
    ${conflicts.length ? `<div class="conflict-banner">⚠ 检测到 ${conflicts.length} 处日程冲突：${conflicts.map((c) => esc(c.aTitle) + ' × ' + esc(c.bTitle)).join('；')}</div>` : ''}
    <div class="cal-body">${body}</div>
    ${detail ? `<div class="evt-detail-wrap">${detail}</div>` : `<p class="cal-hint hint">提示：点击任意日程可查看详情并编辑 / 删除；点击网格空白处可直接新建日程。</p>`}`;
  }
  /* 日程详情面板：展示所属项目（手动日程可改）、编辑 / 删除 / 完成等操作 */
  function evtDetailPanel(e) {
    const KIND = { task: '任务', hearing: '开庭', contract: '合同到期', renewal: '续费', manual: '手动' };
    const done = S.isScheduleDone({ eventId: e.kind === 'manual' ? e.id : null, projectId: e.projectId, caseId: e.caseId || null, kind: e.kind });
    const isManual = e.kind === 'manual';
    const projName = e.projectId ? (S.getProject(e.projectId) || {}).name || '' : '';
    let projField;
    if (isManual) {
      const opts = ['（不关联项目）'].concat(S.projectCaseOptions().map((o) => o.label));
      const cur = evtCurLabel(e);
      projField = `<div class="evt-detail-row"><label>所属项目</label><select data-act="evt-project" data-evt="${esc(e.id)}">${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    } else {
      projField = `<div class="evt-detail-row"><label>所属项目</label><span class="evt-detail-val">${esc(projName || '—')}</span></div>`;
    }
    let openBtn = '';
    if (!isManual) {
      if (e.kind === 'task') openBtn = `<button class="mini" data-act="evt-open" data-kind="task" data-ref="${esc(e.refId || '')}">打开任务</button>`;
      else openBtn = `<button class="mini" data-act="evt-open" data-kind="${esc(e.kind)}" data-ref="${esc(e.projectId || '')}">打开关联</button>`;
    }
    return `<div class="evt-detail">
      <div class="evt-detail-head"><span class="evt-kind evt-kind-${e.kind}">${KIND[e.kind] || e.kind}</span><span class="evt-detail-title">${esc(e.title)}</span><span class="evt-detail-time">${fmtDT(e.start)}${e.end ? ' — ' + fmtDT(e.end) : ''}</span></div>
      ${projField}
      <div class="evt-detail-ops">
        ${isManual ? `<button class="mini" data-act="evt-edit" data-evt="${esc(e.id)}">编辑</button>` : ''}
        ${openBtn}
        <button class="mini" data-act="evt-done" data-kind="${esc(e.kind)}" data-ref="${esc(e.projectId || e.refId || '')}" data-case="${esc(e.caseId || '')}" data-evt="${isManual ? esc(e.id) : ''}">${done ? '恢复' : '完成'}</button>
        ${isManual ? `<button class="mini danger" data-act="evt-del" data-evt="${esc(e.id)}">删除</button>` : ''}
        <button class="mini" data-act="evt-detail-close">关闭</button>
      </div>
    </div>`;
  }
  function evtChip(e, conf, small) {
    const doneCls = e.done ? ' done' : '';
    const confCls = conf ? ' conf' : '';
    const smCls = small ? ' sm' : '';
    const time = e.allDay ? '' : `<span class="evt-t">${String(new Date(e.start).getHours()).padStart(2, '0')}:${String(new Date(e.start).getMinutes()).padStart(2, '0')}</span>`;
    const projTag = (e.kind === 'manual' && e.projectId) ? (() => { const p = S.getProject(e.projectId); if (!p) return ''; if (e.caseId) { const c = (p.cases || []).find((x) => x.id === e.caseId); return c ? ` <span class="evt-proj">@${esc(p.name)} › ${esc(c.name)}</span>` : ` <span class="evt-proj">@${esc(p.name)}</span>`; } return ` <span class="evt-proj">@${esc(p.name)}</span>`; })() : '';
    const doneBtn = `<button class="evt-done" type="button" data-act="evt-done" data-kind="${e.kind}" data-ref="${e.refId || ''}" data-case="${e.caseId || ''}" data-evt="${e.kind === 'manual' ? e.id : ''}" title="标记完成 / 取消" aria-label="标记完成">✓</button>`;
    return `<div class="evt evt-${e.kind}${doneCls}${confCls}${smCls}" data-act="evt-select" data-id="${e.id}" data-kind="${e.kind}" data-ref="${e.refId || ''}" title="点击查看详情 / 编辑 / 删除">${time}${esc(e.title)}${projTag}${doneBtn}</div>`;
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
        const cd = new Date(d); cd.setHours(h, 0, 0, 0);
        return `<div class="wk-cell" data-act="evt-empty" data-date="${cd.toISOString()}">${items.map((e) => evtChip(e, isConf(e, conflicts), false)).join('')}</div>`;
      }).join('');
      grid += `<div class="wk-col"><div class="wk-allday">${allDay.map((e) => evtChip(e, false, false)).join('')}</div><div class="wk-hours">${cells}</div></div>`;
    });
    return { html: `<div class="wk-head-row"><div class="wk-corner"></div>${head}</div><div class="wk-scroll"><div class="wk-times"><div class="wk-spad"></div>${hours.map((h) => `<div class="wk-time">${String(h).padStart(2, '0')}:00</div>`).join('')}</div><div class="wk-grid">${grid}</div></div><div class="wk-legend">图例：<span class="lg"><i class="lg-task"></i>任务</span><span class="lg"><i class="lg-hearing"></i>开庭</span><span class="lg"><i class="lg-contract"></i>合同到期</span><span class="lg"><i class="lg-renewal"></i>续费</span><span class="lg"><i class="lg-manual"></i>手动日程</span>${conflicts.length ? '<span class="lg"><i class="lg-conf"></i>冲突</span>' : ''}</div>`, label };
  }
  function isConf(e, conflicts) { return conflicts.some((c) => c.a === e.id || c.b === e.id); }
  function monthView(ref, evts) {
    const y = ref.getFullYear(), m = ref.getMonth();
    const first = new Date(y, m, 1); const start = startOfWeek(first);
    const label = y + '年' + (m + 1) + '月';
    const dowHeader = ['一', '二', '三', '四', '五', '六', '日']
      .map((d) => `<div class="mc-dow">${d}</div>`).join('');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const inMonth = d.getMonth() === m; const today = new Date(); today.setHours(0, 0, 0, 0); const isT = d.getTime() === today.getTime();
      const dayEvents = evts.filter((e) => new Date(e.start).toDateString() === d.toDateString());
      const cd = new Date(d); cd.setHours(9, 0, 0, 0);
      cells += `<div class="mc ${inMonth ? '' : 'out'} ${isT ? 'istoday' : ''}" data-act="evt-empty" data-date="${cd.toISOString()}"><div class="mc-d">${d.getDate()}</div>${dayEvents.slice(0, 3).map((e) => evtChip(e, false, true)).join('')}${dayEvents.length > 3 ? '<div class="mc-more">+' + (dayEvents.length - 3) + '</div>' : ''}</div>`;
    }
    return { html: `<div class="mc-dow-row">${dowHeader}</div><div class="mc-grid">${cells}</div>`, label };
  }
  /* detectConflicts：O(n log n) — 先按开始时间排序，再用滑动窗口（同天、时间段重叠）逐对比对
   * 相比原来 O(n²) 全量两两比对，当事件数较多时性能显著提升；正确性不变（排序后仍覆盖所有冲突对）。 */
  function detectConflicts(evts) {
    const out = [];
    const timed = evts.filter((e) => !e.allDay && e.start)
      .sort((a, b) => new Date(a.start) - new Date(b.start)); // 排序：O(n log n)
    for (let i = 0; i < timed.length; i++) {
      const a = timed[i];
      const as = new Date(a.start);
      const ae = a.end ? new Date(a.end) : new Date(as.getTime() + 3600000);
      for (let j = i + 1; j < timed.length; j++) {
        const b = timed[j];
        const bs = new Date(b.start);
        // 排序后 b 的开始 >= a 的开始；若 b 的开始 >= a 的结束，则之后所有事件均不会与 a 冲突（剪枝）
        if (bs >= ae) break;
        if (as.toDateString() !== bs.toDateString()) continue; // 仅同天冲突
        const be = b.end ? new Date(b.end) : new Date(bs.getTime() + 3600000);
        if (as < be && bs < ae) out.push({ a: a.id, b: b.id, aTitle: a.title, bTitle: b.title });
      }
    }
    return out;
  }

  /* 手动日程的所属项目/子项目解析：选项标签 → {projectId, caseId}；以及反向回显当前标签。
   * 关键：子项目（关联案件）选项的 id 形如 "pid|cid"，含 projectId/caseId；选中子项目时必须同时保存
   * caseId，否则回显时会回落到大项目（此前子项目"选不上"的根因）。 */
  function evtOptByLabel(label) { return S.projectCaseOptions().find((o) => o.label === label) || null; }
  function evtCurLabel(base) {
    if (!base || !base.projectId) return '';
    const o = S.projectCaseOptions().find((x) => base.caseId
      ? (x.isCase && x.projectId === base.projectId && x.caseId === base.caseId)
      : (!x.isCase && x.id === base.projectId));
    return o ? o.label : '';
  }
  function evtResolve(label) {
    if (!label || label === '（不关联项目）') return { projectId: null, caseId: null };
    const o = evtOptByLabel(label);
    if (!o) return { projectId: null, caseId: null };
    return o.isCase ? { projectId: o.projectId, caseId: o.caseId } : { projectId: o.id, caseId: null };
  }

  /* 新建 / 编辑手动日程：所属项目下拉含子项目（需求 5），保存时按标签反查 projectId/caseId（需求 2 增改）
   * draft 可携带 start/end（点击网格空白处新建时预填时间）。 */
  function bindEvtForm(id, draft) {
    const e = id ? S.getManualEvent(id) : null;
    const base = Object.assign({}, e || {}, draft || {});
    const opts = ['（不关联项目）'].concat(S.projectCaseOptions().map((o) => o.label));
    const curLabel = evtCurLabel(base);
    openModal(id ? '编辑日程' : '新建日程',
      field('title', '标题', 'text', base.title || '') +
      field('project', '所属项目（含子项目）', 'select', curLabel, { options: opts }) +
      field('start', '开始时间', 'datetime', base.start ? ('' + base.start).slice(0, 16) : '') +
      field('end', '结束时间', 'datetime', base.end ? ('' + base.end).slice(0, 16) : ''),
      (v) => {
        const r = evtResolve(v.project);
        S.saveManualEvent({ id: id || undefined, title: v.title || '未命名日程', start: v.start ? new Date(v.start).toISOString() : new Date().toISOString(), end: v.end ? new Date(v.end).toISOString() : null, projectId: r.projectId, caseId: r.caseId }, !id);
        closeModal(); render();
      });
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
      { key: 'party', label: '当事人', type: 'text' },
      { key: 'opponent', label: '对方当事人', type: 'text' },
      { key: 'contact', label: '对接人', type: 'text' },
      { key: 'contactContact', label: '联系方式', type: 'text' }
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

  /* 核心字段集合：这些 key 的值仍直接存放在项目对象 p[key]（与 deriveEvents/exportCSV/检索等兼容），
   * 其余动态新增字段的值存放在 p.customValues[fieldId]。 */
  const CORE_KEYS = (function () {
    const s = new Set();
    PROJ_GENERIC_MODULES.forEach((m) => m.fields.forEach((f) => s.add(f.key)));
    Object.keys(PROJ_CATEGORY_TEMPLATES).forEach((k) => {
      (PROJ_CATEGORY_TEMPLATES[k].modules || []).forEach((m) => m.fields.forEach((f) => s.add(f.key)));
    });
    s.add('litigSubject'); // 诉讼类新增的「诉讼标的」
    return s;
  })();
  function isCoreField(f) { return CORE_KEYS.has(f.key); }
  /* 确保项目带有 sectionCfg 结构，避免后续访问 undefined */
  function ensureSectionCfg(p) {
    if (!p.sectionCfg) p.sectionCfg = { hidden: [], renamed: {}, added: [], addedFields: {}, removedFields: {}, sectionOrder: [], collapsed: [], deletedSections: [] };
    ['hidden', 'renamed', 'added', 'addedFields', 'removedFields', 'sectionOrder', 'collapsed', 'deletedSections'].forEach((k) => { if (p.sectionCfg[k] == null) p.sectionCfg[k] = (k === 'renamed' || k === 'addedFields' || k === 'removedFields') ? {} : []; });
    return p.sectionCfg;
  }
  /* 在 sectionCfg 中定位一个动态新增字段的定义（可能存于 addedFields[板块] 或 added 板块的 fields 中） */
  function findAddedFieldDef(cfg, sec, fid) {
    const inAdded = (cfg.addedFields[sec] || []).find((f) => f.id === fid);
    if (inAdded) return { field: inAdded, where: 'addedFields', sec: sec };
    for (const s of (cfg.added || [])) {
      if (s.section === sec) { const f = (s.fields || []).find((x) => x.id === fid); if (f) return { field: f, where: 'section', secObj: s }; }
    }
    return null;
  }
  /* 板块管理上下文解析：按钮 data-pid 存在 → 案件上下文（返回案件 + 所属项目）；
   * 否则 → 项目上下文（entity = project）。确保 entity 有 sectionCfg / customValues。 */
  function resolveSectionCtx(el) {
    const pid = el.dataset.pid;
    const id = el.dataset.id;
    if (pid) {
      const project = S.getProject(pid); if (!project) return null;
      const c = S.getCase(pid, id);
      if (c) { ensureSectionCfg(c); if (c.customValues == null) c.customValues = {}; return { entity: c, project: project, isCase: true }; }
      return { entity: project, project: project, isCase: false };
    }
    const p = S.getProject(id);
    if (p) { ensureSectionCfg(p); return { entity: p, project: p, isCase: false }; }
    return null;
  }

  /* 有效模块 = 默认模块 经 每项目 sectionCfg 覆盖（重命名/删除板块/增删字段）+ 类别扩展 + 诉讼类特例。
   * 返回的字段对象均为副本，渲染/收集阶段再决定取值来源（核心字段 p[key] / 新增字段 p.customValues[id]）。 */
  function projectModules(p) {
    const cat = (p && p.category) || '其他类';
    const tpl = PROJ_CATEGORY_TEMPLATES[cat] || PROJ_CATEGORY_TEMPLATES['其他类'];
    const cfg = (p && p.sectionCfg) || { hidden: [], renamed: {}, added: [], addedFields: {}, removedFields: {}, deletedSections: [] };
    const hidden = cfg.hidden || [];
    const renamed = cfg.renamed || {};
    const addedFields = cfg.addedFields || {};
    const removedFields = cfg.removedFields || {};
    let mods = PROJ_GENERIC_MODULES.concat(tpl.modules).map((m) => ({ section: m.section, fields: m.fields.map((f) => Object.assign({}, f)) }));
    // 板块重命名
    mods.forEach((m) => { if (renamed[m.section]) m.section = renamed[m.section]; });
    // 板块内字段删除
    mods.forEach((m) => { if (removedFields[m.section]) m.fields = m.fields.filter((f) => removedFields[m.section].indexOf(f.key) < 0); });
    // 板块删除
    mods = mods.filter((m) => hidden.indexOf(m.section) < 0);
    // 向标准/已有板块追加字段（规范化：动态新增字段以 id 作 key，便于渲染/编辑/删除处理器统一按 key 读写）
    Object.keys(addedFields).forEach((sec) => {
      const target = mods.find((m) => m.section === sec || renamed[m.section] === sec);
      if (target) target.fields = target.fields.concat((addedFields[sec] || []).map((f) => Object.assign({ type: 'text' }, f, { key: f.id })));
    });
    // 诉讼类：主案号→案号，并在基础信息增加「诉讼标的」
    if (cat === '诉讼类') {
      const base = mods.find((m) => m.section === '基础信息');
      if (base) {
        const cn = base.fields.find((f) => f.key === 'caseNo'); if (cn) cn.label = '案号';
        if (!base.fields.some((f) => f.key === 'litigSubject')) base.fields.push({ key: 'litigSubject', label: '诉讼标的', type: 'text', wide: true });
      }
    }
    // 追加用户新增的独立板块（已被软删除的自定义板块不渲染，可在「板块管理」中恢复）
    const deletedSecIds = cfg.deletedSections || [];
    (cfg.added || []).forEach((s) => { if (deletedSecIds.indexOf(s.id) < 0) mods.push({ section: s.section, fields: (s.fields || []).map((f) => Object.assign({ type: 'text' }, f, { key: f.id })), addedId: s.id }); });
    // 自定义板块顺序：按 sectionOrder 排序，未列出的板块排到末尾保持原序
    const order = cfg.sectionOrder || [];
    if (order.length) {
      mods.sort((a, b) => {
        const ia = order.indexOf(a.section), ib = order.indexOf(b.section);
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      });
    }
    return mods;
  }
  /* 渲染单个字段控件：核心字段取 p[key]，新增字段取 p.customValues[id]；控件 data-field 用字段 key/id 以便 collectForm 收集 */
  function projectField(f, p) {
    if (f.type === 'seizures') return szEditorHtml(p ? p.seizures : []);
    if (f.type === 'creditors') return creditorEditorHtml(p ? p.creditors : []);
    let val = '';
    if (p) val = isCoreField(f) ? (p[f.key] || '') : ((p.customValues || {})[f.key] || '');
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
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((p) => {
        const base = (p.name + (p.party || '') + (p.opponent || '') + (p.caseNo || '') + (p.cause || '') + (p.agentLawyer || '') + (p.category || '') + (p.litigSubject || '')).toLowerCase();
        if (base.indexOf(q) >= 0) return true;
        // 同时检索大项目下的子项目（关联案件）名称 / 案号 / 当事人等
        return (p.cases || []).some((c) => (c.name + (c.caseNo || '') + (c.party || '') + (c.opponent || '') + (c.cause || '')).toLowerCase().indexOf(q) >= 0);
      });
    }
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
      <input class="search" data-act="proj-q" placeholder="搜索项目/子项目/债权人/对方/案号…" value="${esc(f.q)}">
      <select data-act="proj-status">${['<option value="">全部状态</option>'].concat(['进行中', '已暂停', '已完成', '已结案'].map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`)).join('')}</select>
      <select data-act="proj-cause">${['<option value="">全部案由</option>'].concat(causes.map((c) => `<option ${f.cause === c ? 'selected' : ''}>${esc(c)}</option>`)).join('')}</select>
      <select data-act="proj-tag">${['<option value="">全部标签</option>'].concat(tags.map((t) => `<option ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`)).join('')}</select>
      <button class="btn primary" data-act="proj-new">+ 新建项目</button>
    </div>
    <ul class="card-list proj-list">${cards || `<li class="empty"><p>还没有匹配的项目，点击右上角「+ 新建项目」开始登记台账。</p></li>`}</ul>`;
  }
  function kv(label, val) { return `<div class="kv"><span class="kv-k">${label}</span><span class="kv-v">${esc(val) || '—'}</span></div>`; }
  /* 查封与保全：每个查封物的三个时间字段单独成行，与其它简单宽字段完全一致（kv-mod 三列网格），
   * 类型/名称作为上下文内嵌于「查封起算时间」行的值中，避免长 label 撑破 96px 列。 */
  function seizuresAsKvMod(seizures) {
    const list = Array.isArray(seizures) ? seizures : [];
    if (!list.length) return '<div class="kv kv-mod"><span class="kv-k">查封与保全</span><span class="kv-v">—</span></div>';
    return list.map((s) => {
      const e = szCompute(s.type || '不动产', s.start);
      const end = s.end || e.end, rEnd = s.renewalEnd || e.renewalEnd;
      const ctx = `${s.type || '不动产'}${s.name ? '·' + s.name : ''}`;
      return `<div class="kv kv-mod"><span class="kv-k">查封起算时间</span><span class="kv-v" title="${esc(ctx)}">${esc(ctx)}：${esc(s.start || '—')}</span></div>
        <div class="kv kv-mod"><span class="kv-k">截止时间</span><span class="kv-v">${esc(end || '—')}</span></div>
        <div class="kv kv-mod"><span class="kv-k">续封时间</span><span class="kv-v">${esc(rEnd || '—')}</span></div>`;
    }).join('');
  }
  /* 破产要素：每位债权持有人单行（kv-mod），value 内含流转次数与最新债权金额，与其它字段格式一致 */
  function creditorsAsKvMod(holders) {
    const list = Array.isArray(holders) ? holders : [];
    if (!list.length) return '<div class="kv kv-mod"><span class="kv-k">债权人</span><span class="kv-v">—</span></div>';
    return list.map((h) => {
      const tfs = Array.isArray(h.transfers) ? h.transfers : [];
      const last = tfs.length ? (tfs[tfs.length - 1].amount || '') : '';
      const summary = `${tfs.length} 次流转${last ? '，最新债权 ' + esc(last) : ''}`;
      return `<div class="kv kv-mod"><span class="kv-k">债权人（${esc(h.name || '未命名')}）</span><span class="kv-v" title="${esc(summary)}">${summary}</span></div>`;
    }).join('');
  }

  /* 自定义板块渲染：每个板块独立卡片，支持展开/折叠、字段增删 */
  /* 单个板块渲染为独立卡片：标题行含板块管理按钮，字段逐行展示并支持新增字段的编辑/删除 */
  function renderModuleBlock(p, m) {
    const isAddedSection = !!m.addedId;
    const secAttrs = isAddedSection ? ` data-secid="${esc(m.addedId)}"` : '';
    const fieldsHtml = m.fields.length ? m.fields.map((f) => {
      if (f.type === 'seizures') return seizuresAsKvMod(p.seizures);
      if (f.type === 'creditors') return creditorsAsKvMod(p.creditors);
      const val = isCoreField(f) ? formatFieldValue(p[f.key], f.type) : ((p.customValues || {})[f.key] || '—');
      const isAdded = !isCoreField(f);
      const editBtn = isAdded ? `<button class="mini" data-act="cm-edit-field" data-id="${p.id}" data-si="${esc(m.section)}" data-fid="${esc(f.key)}">编辑</button>` : '';
      const delBtn = `<button class="mini danger" data-act="cm-del-field" data-id="${p.id}" data-si="${esc(m.section)}" data-fid="${esc(f.key)}">删</button>`;
      return `<div class="kv kv-mod"><span class="kv-k">${esc(f.label)}</span><span class="kv-v" title="${esc(val)}">${esc(val) || '—'}</span><span class="kv-op">${editBtn}${delBtn}</span></div>`;
    }).join('') : '<div class="kv kv-mod"><span class="kv-k">提示</span><span class="kv-v">暂无字段，点击「+ 字段」添加</span></div>';
    const cfg = ensureSectionCfg(p);
    const collapsed = (cfg.collapsed || []).indexOf(m.section) >= 0;
    return `<div class="mod-block${collapsed ? ' is-collapsed' : ''}" data-section="${esc(m.section)}" draggable="true" data-sec-name="${esc(m.section)}">
      <div class="kv-sec mod-sec">
        <span class="mod-sec-left">
          <span class="mod-drag-handle" title="拖拽调整顺序">⠿</span>
          <button class="mod-collapse-btn" data-act="cm-toggle-collapse" data-id="${p.id}" data-si="${esc(m.section)}" title="${collapsed ? '展开' : '折叠'}">${collapsed ? '▶' : '▼'}</button>
          <span class="mod-sec-title">${esc(m.section)}</span>
        </span>
        <span class="mod-ops">
          <button class="mini" data-act="cm-edit-sec" data-id="${p.id}" data-si="${esc(m.section)}"${secAttrs} title="编辑本板块内容">编辑</button>
          <button class="mini" data-act="cm-add-field" data-id="${p.id}" data-si="${esc(m.section)}"${secAttrs} title="新增字段">+ 字段</button>
          <button class="mini danger" data-act="cm-del-sec" data-id="${p.id}" data-si="${esc(m.section)}"${secAttrs} title="删除整个板块">删除板块</button>
        </span>
      </div>
      <div class="mod-body"><div class="mod-body-inner">${fieldsHtml}</div></div>
    </div>`;
  }
  /* 关联案件的板块渲染：与项目板块完全同构（mod-block + kv-mod + 编辑/+字段/删除板块），
   * 数据取自案件 c；自定义字段值优先取 c.customValues，回退到 p.customValues（共享项目级配置）。
   * 配色使用 c-aud（紫调）与大项目区别，class 加 --case 修饰。 */
  function renderCaseModuleBlock(c, m, projectId) {
    const isAddedSection = !!m.addedId;
    const secAttrs = isAddedSection ? ` data-secid="${esc(m.addedId)}"` : '';
    /* 案件板块按钮：data-id=案件id, data-pid=项目id；处理器据此区分案件上下文 */
    const ctx = ` data-id="${esc(c.id)}" data-pid="${esc(projectId)}"`;
    const fieldsHtml = m.fields.length ? m.fields.map((f) => {
      if (f.type === 'seizures') return seizuresAsKvMod(c.seizures);
      if (f.type === 'creditors') return creditorsAsKvMod(c.creditors);
      let val;
      if (isCoreField(f)) val = formatFieldValue(c[f.key], f.type);
      else val = ((c.customValues || {})[f.key] || '—');
      const isAdded = !isCoreField(f);
      const editBtn = isAdded ? `<button class="mini" data-act="cm-edit-field"${ctx} data-si="${esc(m.section)}" data-fid="${esc(f.key)}">编辑</button>` : '';
      const delBtn = `<button class="mini danger" data-act="cm-del-field"${ctx} data-si="${esc(m.section)}" data-fid="${esc(f.key)}">删</button>`;
      return `<div class="kv kv-mod"><span class="kv-k">${esc(f.label)}</span><span class="kv-v" title="${esc(val)}">${esc(val) || '—'}</span><span class="kv-op">${editBtn}${delBtn}</span></div>`;
    }).join('') : '<div class="kv kv-mod"><span class="kv-k">提示</span><span class="kv-v">暂无字段，点击「+ 字段」添加</span></div>';
    const cfgC = ensureSectionCfg(c);
    const collapsed = (cfgC.collapsed || []).indexOf(m.section) >= 0;
    const collapseAttrs = ` data-id="${esc(c.id)}" data-pid="${esc(projectId)}"`;
    return `<div class="mod-block mod-block--case${collapsed ? ' is-collapsed' : ''}" data-section="${esc(m.section)}" draggable="true" data-sec-name="${esc(m.section)}">
      <div class="kv-sec mod-sec mod-sec--case">
        <span class="mod-sec-left">
          <span class="mod-drag-handle" title="拖拽调整顺序">⠿</span>
          <button class="mod-collapse-btn" data-act="cm-toggle-collapse"${collapseAttrs} data-si="${esc(m.section)}" title="${collapsed ? '展开' : '折叠'}">${collapsed ? '▶' : '▼'}</button>
          <span class="mod-sec-title">${esc(m.section)}</span>
        </span>
        <span class="mod-ops">
          <button class="mini" data-act="cm-edit-sec"${ctx} data-si="${esc(m.section)}"${secAttrs} title="编辑本板块内容">编辑</button>
          <button class="mini" data-act="cm-add-field"${ctx} data-si="${esc(m.section)}"${secAttrs} title="新增字段">+ 字段</button>
          <button class="mini danger" data-act="cm-del-sec"${ctx} data-si="${esc(m.section)}"${secAttrs} title="删除整个板块">删除板块</button>
        </span>
      </div>
      <div class="mod-body"><div class="mod-body-inner">${fieldsHtml}</div></div>
    </div>`;
  }

  function projDetailHtml(p) {
    const tasks = S.listTasks().filter((t) => t.projectId === p.id);
    const mods = projectModules(p);
    const secHtml = mods.map((m) => renderModuleBlock(p, m)).join('');
    const rc = (p.sectionCfg ? ((p.sectionCfg.hidden || []).length + (p.sectionCfg.deletedSections || []).length) : 0);
    const secBadge = rc ? ` <span class="sec-badge">${rc}</span>` : '';
    const notesHtml = (p.notes && p.notes.length) ? p.notes.map((d, i) => `<li><span class="prog-d">${esc(d.date || '')}</span><span class="prog-c">${esc(d.content || '')}</span><span class="prog-a">${esc(d.recipient ? ('接收人：' + d.recipient) : '')}${d.archiveLocation ? (' · 位置：' + d.archiveLocation) : ''}${d.archiveCabinet ? (' · 柜：' + d.archiveCabinet) : ''}${d.author ? (' · ' + d.author) : ''} <button class="mini danger" data-act="proj-delnote" data-id="${p.id}" data-doc="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无备注</li>';
    return `<div class="proj-detail">
      <div class="mod-area" data-pid="${esc(p.id)}">${secHtml}</div>
      <div class="ph" style="margin-top:14px"><button class="mini primary" data-act="cm-add-sec" data-id="${p.id}">+ 新增板块</button><button class="mini" data-act="cm-manage-sec" data-id="${p.id}">板块管理${secBadge}</button></div>
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
  /* 从表单值 v 收集实体字段，共享于项目表单 / 案件表单，避免重复约 60 行逻辑
   * base    — 编辑时的原始对象（新建传 {}）
   * v       — collectForm() 结果
   * returns — 处理好的 data 对象（不含 id/createdAt 等生命周期字段） */
  function collectEntityData(v, base) {
    const cat = v.category || '其他类';
    const tpl = PROJ_CATEGORY_TEMPLATES[cat] || PROJ_CATEGORY_TEMPLATES['其他类'];
    // 用当前项目的有效模块（含动态新增字段）来收集，确保 customValues 不丢失
    const baseMods = projectModules(base || {});
    const allFields = baseMods.reduce((a, m) => a.concat(m.fields), []);
    const data = {};
    const customValues = Object.assign({}, (base && base.customValues) || {});
    allFields.forEach((f) => {
      if (f.type === 'seizures' || f.type === 'creditors') return; // 单独处理
      if (isCoreField(f)) {
        let val = v[f.key];
        if (f.type === 'date' || f.type === 'datetime') val = val ? new Date(val).toISOString() : null;
        else val = (val == null ? '' : val);
        data[f.key] = val;
      } else {
        // 动态新增字段：值存入 customValues[fieldId]
        const fv = (v[f.key] == null ? '' : v[f.key]);
        customValues[f.key] = fv;
      }
    });
    // 查封与保全：从多项编辑器收集，并按最早查封截止日自动回填「查封到期提醒日」（提前 30 天，便于办理续封）
    data.seizures = collectSeizureItems();
    if (data.seizures.length) {
      const ends = data.seizures.map((s) => s.end).filter(Boolean).sort();
      if (ends.length) { const lead = szAddMonths(ends[0], -30); if (lead) data.renewalDate = new Date(lead + 'T00:00:00.000Z').toISOString(); }
    }
    // 破产要素：仅当类别为破产类时从编辑器收集多项债权持有人；否则保留既有数据
    data.creditors = (cat === '破产类') ? collectCreditorItems() : (base && base.creditors ? base.creditors.slice() : []);
    data.customValues = customValues;
    data.sectionCfg = (base && base.sectionCfg) ? base.sectionCfg : { hidden: [], renamed: {}, added: [], addedFields: {}, removedFields: {}, sectionOrder: [], collapsed: [], deletedSections: [] };
    data.tags = v.tags ? v.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : (base ? base.tags : []);
    data.notes = (base && base.notes) ? base.notes.slice() : [];
    data.progress = (base && base.progress) ? base.progress.slice() : [];
    return data;
  }

  /* 单板块编辑：弹窗仅渲染该板块的字段（文本字段走 form-grid；查封/破产走对应编辑器），
   * 保存时按字段类型归并到 p / p.customValues / p.seizures / p.creditors，不影响其他板块。 */
  function sectionFormHtml(p, m) {
    const complex = m.fields.filter((f) => f.type === 'seizures' || f.type === 'creditors');
    const normal = m.fields.filter((f) => f.type !== 'seizures' && f.type !== 'creditors');
    let html = '';
    complex.forEach((f) => {
      if (f.type === 'seizures') html += szEditorHtml(p.seizures);
      else if (f.type === 'creditors') html += creditorEditorHtml(p.creditors);
    });
    if (normal.length) html += '<div class="form-grid">' + normal.map((f) => projectField(f, p)).join('') + '</div>';
    return html || '<div class="hint">该板块暂无字段</div>';
  }
  function collectSectionData(v, base, m, project) {
    /* 就地修改 base（项目或案件），保存 saveTarget（案件时为所属项目） */
    const saveTarget = project || base;
    const customValues = Object.assign({}, base.customValues || {});
    m.fields.forEach((f) => {
      if (f.type === 'seizures') {
        base.seizures = collectSeizureItems();
        if (base.seizures.length) {
          const ends = base.seizures.map((s) => s.end).filter(Boolean).sort();
          if (ends.length) { const lead = szAddMonths(ends[0], -30); if (lead) base.renewalDate = new Date(lead + 'T00:00:00.000Z').toISOString(); }
        }
      } else if (f.type === 'creditors') {
        base.creditors = collectCreditorItems();
      } else if (isCoreField(f)) {
        let val = v[f.key];
        if (f.type === 'date' || f.type === 'datetime') val = val ? new Date(val).toISOString() : null;
        else val = (val == null ? '' : val);
        base[f.key] = val;
      } else {
        customValues[f.key] = (v[f.key] == null ? '' : v[f.key]);
      }
    });
    base.customValues = customValues;
    S.saveProject(saveTarget, false);
  }
  function openSectionEdit(entity, sectionName, project) {
    const isCase = !!(project && project !== entity);
    const mods = isCase ? caseModules(entity) : projectModules(entity);
    const m = mods.find((x) => x.section === sectionName); if (!m) return;
    openModal('编辑板块：' + sectionName, sectionFormHtml(entity, m), (v) => {
      collectSectionData(v, entity, m, project || entity);
      closeModal(); render();
    });
    bindSeizureEditor(); bindCreditorEditor();
  }

  function openProjForm(id, draft) {
    const base = id ? S.getProject(id) : {};
    const p = Object.assign({}, base, draft || {});
    if (!p.category) p.category = '其他类';
    const cat = p.category;
    openModal(id ? '编辑项目（' + cat + '）' : '新建项目（登记台账）', projForm(p), (v) => {
      const data = collectEntityData(v, base);
      data.name = data.name || (base && base.name) || '未命名项目';
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
    const secHtml = mods.map((m) => renderCaseModuleBlock(c, m, p.id)).join('');
    const crc = (c.sectionCfg ? ((c.sectionCfg.hidden || []).length + (c.sectionCfg.deletedSections || []).length) : 0);
    const csecBadge = crc ? ` <span class="sec-badge">${crc}</span>` : '';
    const notesHtml = (c.notes && c.notes.length) ? c.notes.map((d, i) => `<li><span class="prog-d">${esc(d.date || '')}</span><span class="prog-c">${esc(d.content || '')}</span><span class="prog-a">${esc(d.recipient ? ('接收人：' + d.recipient) : '')}${d.archiveLocation ? (' · 位置：' + d.archiveLocation) : ''}${d.archiveCabinet ? (' · 柜：' + d.archiveCabinet) : ''}${d.author ? (' · ' + d.author) : ''} <button class="mini danger" data-act="case-delnote" data-pid="${p.id}" data-cid="${c.id}" data-doc="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无备注</li>';
    const progHtml = (c.progress && c.progress.length) ? c.progress.map((x, i) => `<li><span class="prog-d">${esc(x.date)}</span><span class="prog-c">${esc(x.content)}</span><span class="prog-a"><button class="mini" data-act="case-editprog" data-pid="${p.id}" data-cid="${c.id}" data-idx="${i}">编辑</button> <button class="mini danger" data-act="case-delprog" data-pid="${p.id}" data-cid="${c.id}" data-idx="${i}">删</button></span></li>`).join('') : '<li class="empty">暂无进展</li>';
    return `<div class="case-detail">
      <div class="ph" style="margin-bottom:8px"><button class="mini" data-act="cm-manage-sec" data-pid="${esc(p.id)}" data-id="${esc(c.id)}">板块管理${csecBadge}</button></div>
      <div class="mod-area mod-area--case" data-pid="${esc(p.id)}" data-cid="${esc(c.id)}">${secHtml}</div>
      <div class="kv-sec kv-sec--case">其他备注</div>
      <ul class="prog">${notesHtml}</ul>
      <div class="kv-sec kv-sec--case">进展状态</div>
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
      const data = collectEntityData(v, base);
      data.name = data.name || (base && base.name) || '未命名案件';
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

  /* ===================== 对接人 / 经办人（拆分为两个独立界面） ===================== */
  function viewClients() {
    const q = (state.cliFilter.q || '').toLowerCase();
    const list = S.listClients().filter((c) => !q || (c.name + (c.project || '') + (c.company || '') + (c.contact || '')).toLowerCase().indexOf(q) >= 0);
    const cards = list.length ? `<ul class="card-list">${list.map((c) => `<li class="card-pill card-pill--personnel" data-act="cli-open" data-id="${c.id}">
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
    return `
    <div class="toolbar">
      <input class="search" data-act="cli-q" placeholder="检索对接人 / 项目 / 公司 / 联系方式…" value="${esc(state.cliFilter.q)}">
      <button class="btn primary" data-act="cli-new">+ 新建对接人</button>
    </div>
    <div class="tbl-scroll">
    <div class="card-list-head card-list-head--personnel">
      <span></span><span>姓名</span><span>所属项目</span><span>联系电话</span><span>地址</span><span></span>
    </div>
    ${cards}
    </div>`;
  }
  function viewJudges() {
    const q = (state.judFilter.q || '').toLowerCase();
    const list = S.listJudges().filter((j) => !q || (j.name + (j.case || '') + (j.court || '') + (j.contact || '') + (j.role || '')).toLowerCase().indexOf(q) >= 0);
    const cards = list.length ? `<ul class="card-list">${list.map((j) => `<li class="card-pill card-pill--personnel card-pill--judges" data-act="jud-open" data-id="${j.id}">
      <span class="drag-handle" data-drag-handle title="拖拽排序">⠿</span>
      <span class="cp-cell cp-name">${esc(j.name)}</span>
      <span class="cp-cell cp-role">${esc(j.role || '—')}</span>
      <span class="cp-cell cp-proj">${esc(j.case || '—')}${j.court ? '<span class="cp-sub">' + esc(j.court) + '</span>' : ''}</span>
      <span class="cp-cell cp-contact">${esc(j.contact || '—')}<span class="cp-sub">沟通 ${j.records ? j.records.length : 0} 条</span></span>
      <span class="cp-cell cp-addr">${esc(j.address || '—')}</span>
      <span class="cp-cell cp-act">
        <button class="mini" data-act="jud-edit" data-id="${j.id}">编辑</button>
        <button class="mini danger" data-act="jud-del" data-id="${j.id}">删</button>
      </span>
    </li>`).join('')}</ul>` : `<div class="empty"><p>暂无经办人</p></div>`;
    return `
    <div class="toolbar">
      <input class="search" data-act="jud-q" placeholder="检索经办人 / 案件 / 法院 / 职务…" value="${esc(state.judFilter.q)}">
      <button class="btn primary" data-act="jud-new">+ 新建经办人</button>
    </div>
    <div class="tbl-scroll">
    <div class="card-list-head card-list-head--judges">
      <span></span><span>经办人</span><span>职务</span><span>所属案件</span><span>联系方式</span><span>地址</span><span></span>
    </div>
    ${cards}
    </div>`;
  }
  function cliForm(c) { c = c || {}; const projOpts = S.projectCaseOptions().map((o) => o.label); return field('name', '对接人', 'text', c.name) + fieldCombo('project', '所属项目（含子项目）', c.project, projOpts, { wide: true }) + field('company', '所属公司', 'text', c.company) + field('contact', '联系方式', 'text', c.contact) + field('address', '地址', 'text', c.address, { wide: true }); }
  /* 同类别人员重名校验：去空格、忽略大小写；excludeId 用于编辑时排除自身 */
  function personNameDup(list, name, excludeId) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return false;
    return list.some((x) => x.id !== excludeId && (x.name || '').trim().toLowerCase() === n);
  }
  function bindCliForm(id) {
    const c = id ? S.getClient(id) : null;
    openModal(id ? '编辑对接人' : '新建对接人', cliForm(c), (v) => {
      const nm = (v.name || '').trim();
      if (!nm) { toast('请填写对接人姓名', 'err'); return; }
      if (personNameDup(S.listClients(), nm, id)) { toast('对接人「' + nm + '」已存在，请勿重复添加', 'err'); return; }
      const data = { name: v.name, project: v.project, company: v.company, contact: v.contact, address: v.address };
      if (id) { data.id = id; S.saveClient(data, false); } else S.saveClient(data, true);
      closeModal(); render();
    });
  }
  function cliDetail(id) {
    const c = S.getClient(id); if (!c) return;
    openModal(c.name + '（对接人）', `<div class="detail"><div class="dl"><div><b>所属项目</b>${esc(c.project || '—')}</div><div><b>所属公司</b>${esc(c.company || '—')}</div><div><b>联系方式</b>${esc(c.contact || '—')}</div><div><b>地址</b>${esc(c.address || '—')}</div></div>
      <h4>沟通情况</h4><ul class="prog">${(c.records || []).map((r) => `<li><span class="prog-d">${esc(r.date)}</span><span class="prog-c">${esc(r.content)}</span><span class="prog-a">${esc(r.by)}</span></li>`).join('') || '<li class="empty">暂无记录</li>'}</ul>
      <div class="ph"><button class="mini" data-act="cli-addrec" data-id="${c.id}">+ 沟通</button><button class="mini" data-act="cli-edit" data-id="${c.id}">编辑</button><button class="mini danger" data-act="cli-del" data-id="${c.id}">删除</button></div></div>`, null, { readonly: true });
  }
  function judForm(j) { j = j || {}; const projOpts = S.projectCaseOptions().map((o) => o.label); return field('name', '经办人', 'text', j.name) + fieldCombo('case', '所属案件（含子项目）', j.case, projOpts, { wide: true }) + field('role', '职务', 'select', j.role || '', { options: ['', '法官', '法官助理', '执行法官', '辅拍', '书记员'], wide: true }) + field('court', '法院', 'text', j.court) + field('contact', '联系方式', 'text', j.contact) + field('address', '地址', 'text', j.address, { wide: true }); }
  function bindJudForm(id) {
    const j = id ? S.getJudge(id) : null;
    openModal(id ? '编辑经办人' : '新建经办人', judForm(j), (v) => {
      const nm = (v.name || '').trim();
      if (!nm) { toast('请填写经办人姓名', 'err'); return; }
      if (personNameDup(S.listJudges(), nm, id)) { toast('经办人「' + nm + '」已存在，请勿重复添加', 'err'); return; }
      const data = { name: v.name, case: v.case, role: v.role, court: v.court, contact: v.contact, address: v.address };
      if (id) { data.id = id; S.saveJudge(data, false); } else S.saveJudge(data, true);
      closeModal(); render();
    });
  }
  function judDetail(id) {
    const j = S.getJudge(id); if (!j) return;
    openModal(j.name + '（经办人）', `<div class="detail"><div class="dl"><div><b>所属案件</b>${esc(j.case || '—')}</div><div><b>职务</b>${esc(j.role || '—')}</div><div><b>法院</b>${esc(j.court || '—')}</div><div><b>联系方式</b>${esc(j.contact || '—')}</div><div><b>地址</b>${esc(j.address || '—')}</div></div>
      <h4>沟通情况</h4><ul class="prog">${(j.records || []).map((r) => `<li><span class="prog-d">${esc(r.date)}</span><span class="prog-c">${esc(r.content)}</span><span class="prog-a">${esc(r.by)}</span></li>`).join('') || '<li class="empty">暂无记录</li>'}</ul>
      <div class="ph"><button class="mini" data-act="jud-addrec" data-id="${j.id}">+ 沟通</button><button class="mini" data-act="jud-edit" data-id="${j.id}">编辑</button><button class="mini danger" data-act="jud-del" data-id="${j.id}">删除</button></div></div>`, null, { readonly: true });
  }

  /* ===================== 数据导出 ===================== */
  function viewExport() {
    return `<div class="export-wrap">
      <section class="panel"><h3 class="tt">报表导出</h3><p class="hint">CSV 可用 Excel 打开，JSON 用于备份与多端恢复。</p>
        <div class="exp-btns"><button class="btn" data-act="exp" data-t="projects">导出案件台账(CSV)</button><button class="btn" data-act="exp" data-t="cases">导出关联案件(CSV)</button><button class="btn" data-act="exp" data-t="tasks">导出任务(CSV)</button><button class="btn" data-act="exp" data-t="clients">导出对接人(CSV)</button><button class="btn" data-act="exp" data-t="judges">导出经办人(CSV)</button><button class="btn primary" data-act="exp-json">导出全量备份(JSON)</button></div>
        <p class="sync-state">上次同步：${S.meta().lastSync ? fmtDT(S.meta().lastSync) : '—'}</p></section>
      <section class="panel"><h3 class="tt">数据恢复 / 多端同步</h3><p class="hint">导入 JSON 备份以恢复数据；同源多标签页通过 BroadcastChannel 实时同步。</p>
        <div class="exp-btns"><label class="btn">选择备份文件导入<input type="file" id="imp-file" accept="application/json" hidden></label><button class="btn danger" data-act="reset-clear">清空所有数据</button></div></section>
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
  /* 线上只读镜像（GitHub Pages 等静态托管）：非本地工作台一律只读，禁止一切编辑 */
  const READONLY = !REMOTE;

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
    if (V && V.enabled && !V.isUnlocked()) return false; // 锁定状态无密钥，跳过（避免拿到密文也无法解密）
    // 本地 / 8200 ：连本地同步服务
    if (REMOTE) {
      try {
        /* 加超时：服务端在云同步开启时可能同步 git pull 阻塞数秒；超时后放弃，不影响已渲染的本地数据 */
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(API_BASE + '/api/load', { signal: ctrl.signal });
        clearTimeout(timer);
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
              return true; // 拉到了更新的远端数据，需要重渲
            } else if (localTs && (!j.savedAt || localTs > j.savedAt)) {
              await S.persist(); // 本地较新 → 推回（密文）
            }
          }
        }
      } catch (e) {}
      return false;
    }
    // 线上（GitHub Pages 等静态托管）：同源拉取加密数据文件（只读镜像，无密码不可读）
    const IS_ONLINE = location.hostname.endsWith('github.io');
    if (IS_ONLINE) {
      try {
        const r = await fetch('data/workplat.enc.json', { cache: 'no-store' });
        if (!r.ok) return false;
        const sealed = await r.text();
        if (typeof sealed === 'string' && sealed.indexOf('v1:') === 0 && V && V.key) {
          const remoteDb = await V.unseal(sealed);
          if (remoteDb && remoteDb.projects) {
            // 线上为只读镜像：以线上最新为准（本地编辑已推送到此）
            S.importJSON(JSON.stringify(remoteDb));
            S.DB.meta = S.DB.meta || {}; S.DB.meta.syncedAt = new Date().toISOString();
            await S.persist();
            return true;
          }
        }
      } catch (e) {}
      return false;
    }
    // 其它未知宿主：不同步
    return false;
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
  /* 只读镜像模式下一律禁止的变更类动作（纯查看/检索/导航/导出不受影响） */
  const READONLY_BLOCK = new Set([
    'task-new', 'task-edit', 'task-del', 'task-toggle', 'task-status',
    'proj-new', 'proj-edit', 'proj-del', 'proj-addtask', 'proj-addprog', 'proj-editprog', 'proj-delprog', 'proj-delnote',
    'case-new', 'case-edit', 'case-del', 'case-addprog', 'case-editprog', 'case-delprog', 'case-delnote',
    'evt-new', 'evt-edit', 'evt-empty', 'evt-project', 'evt-done', 'evt-del',
    'cli-new', 'cli-edit', 'cli-del', 'cli-addrec',
    'jud-new', 'jud-edit', 'jud-del', 'jud-addrec',
    'cm-edit-sec', 'cm-add-sec', 'cm-manage-sec', 'cm-del-sec', 'cm-add-field', 'cm-edit-field', 'cm-del-field',
    'imp-file', 'report-apply', 'exp-sync'
  ]);
  function onAct(act, id, el) {
    if (READONLY && READONLY_BLOCK.has(act)) { toast('只读镜像模式：仅可查看，编辑功能已禁用', 'err'); return; }
    switch (act) {
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
      case 'evt-new': state.evtDetailId = null; bindEvtForm(null); break;
      case 'evt-edit': bindEvtForm(el.dataset.evt); break;
      case 'evt-select': state.evtDetailId = el.dataset.id; render(); break;
      case 'evt-detail-close': state.evtDetailId = null; render(); break;
      case 'evt-empty': { const dt = el.dataset.date; if (!dt) break; const start = new Date(dt); const end = new Date(start.getTime() + 3600000); state.evtDetailId = null; bindEvtForm(null, { start: start.toISOString(), end: end.toISOString() }); break; }
      case 'evt-project': { const eid = el.dataset.evt; const ev = S.getManualEvent(eid); if (!ev) break; const r = evtResolve(el.value); S.saveManualEvent(Object.assign({}, ev, { projectId: r.projectId, caseId: r.caseId }), false); render(); break; }
      case 'evt-open': { const k = el.dataset.kind, ref = el.dataset.ref; if ((k === 'task') && ref) { const t = S.getTask(ref); if (t) openModal('任务', `<div class="detail"><div class="dl"><div><b>任务</b>${esc(t.title)}</div><div><b>优先级</b>${t.priority}</div><div><b>截止</b>${fmtDT(t.dueDate)}</div><div><b>状态</b>${t.status}</div></div></div>`, null, { readonly: true }); } else if ((k === 'hearing' || k === 'contract' || k === 'renewal') && ref) { state.projOpenId = ref; navigate('projects'); } break; }
      case 'evt-done': { const r = { eventId: el.dataset.evt || null, projectId: el.dataset.ref, caseId: el.dataset.case || null, kind: el.dataset.kind }; S.setScheduleDone(r, !S.isScheduleDone(r)); render(); break; }
      case 'evt-del': {
        const eid = el.dataset.evt; if (!eid) break;
        const ev = S.getManualEvent(eid); if (!ev) break;
        confirmModal('确认删除日程「' + (ev.title || '') + '」？删除后不可恢复。', () => { S.deleteManualEvent(eid); render(); }, { okText: '删除日程' });
        break;
      }
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
      case 'jud-del': confirmModal('确认删除该经办人？', () => { S.deleteJudge(id); render(); }); break;
      case 'jud-addrec': openModal('添加沟通记录', field('content', '内容', 'textarea', ''), (v) => { S.addJudgeRecord(id, { content: v.content }); closeModal(); render(); }); break;
      case 'report-apply': applyReport(); break;
      case 'exp-sync': apiSync(); break;
      case 'exp-validate': apiValidate(); break;
      case 'exp-db-health': apiHealth(); break;
      case 'exp': download('WORK-Plat_' + el.dataset.t + '_' + LB.util.todayStr() + '.csv', '﻿' + S.exportCSV(el.dataset.t), 'text/csv;charset=utf-8'); break;
      case 'exp-json': download('WORK-Plat_backup_' + LB.util.todayStr() + '.json', S.exportJSON(), 'application/json'); break;
      case 'reset-clear': confirmModal('将清空当前所有数据且不可撤销，确认？', () => { S.resetDemo(); render(); }, { okText: '清空数据' }); break;

      /* ===================== 板块与字段动态管理（统一 sectionCfg，项目/案件通用） ===================== */
      case 'cm-toggle-collapse': {
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        const cfg = ensureSectionCfg(ctx0.entity);
        const sec = el.dataset.si;
        cfg.collapsed = cfg.collapsed || [];
        const i = cfg.collapsed.indexOf(sec);
        const nowCollapsed = i < 0;
        if (nowCollapsed) cfg.collapsed.push(sec); else cfg.collapsed.splice(i, 1);
        S.saveProject(ctx0.project, false);
        /* 就地切换折叠状态：仅切换 class，由 CSS 过渡平滑改变高度，
           避免整页重渲染（render）导致的闪烁与周边元素跳动 */
        const block = el.closest('.mod-block');
        if (block) {
          block.classList.toggle('is-collapsed', nowCollapsed);
          el.textContent = nowCollapsed ? '▶' : '▼';
          el.title = nowCollapsed ? '展开' : '折叠';
        }
        break;
      }
      case 'cm-edit-sec': { const ctx0 = resolveSectionCtx(el); if (ctx0) openSectionEdit(ctx0.entity, el.dataset.si, ctx0.project); break; }
      case 'cm-add-sec': {
        /* 新增独立板块：弹窗输入板块名 */
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        openModal('新增板块', field('secName', '板块名称', 'text', '', { ph: '如：项目进度、风险评估…', wide: true }), (v) => {
          if (!v.secName || !v.secName.trim()) return;
          const name = v.secName.trim();
          const cfg = ensureSectionCtx(ctx0.entity);
          if (projectModules(ctx0.entity).some((m) => m.section === name) || (cfg.added || []).some((s) => s.section === name)) { toast('已存在同名板块', 'err'); return; }
          cfg.added = cfg.added || [];
          cfg.added.push({ id: 'sec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), section: name, fields: [] });
          S.saveProject(ctx0.project, false);
          toast('已新增板块「' + name + '」', 'ok');
          closeModal(); render();
        });
        break;
      }
      case 'cm-manage-sec': {
        /* 打开板块管理弹窗：恢复已隐藏/已删除的板块、新增自定义板块 */
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        openSectionManager(ctx0);
        break;
      }
      case 'cm-del-sec': {
        /* 删除整个板块（含所有字段）：
       *  - 自定义（新增）板块 → 软删除（记入 deletedSections），保留其字段与数据，可在「板块管理」中恢复；
       *  - 标准（固定）板块 → 记入 hidden，同样可恢复。 */
        const sec = el.dataset.si; const secid = el.dataset.secid;
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        const cfg = ensureSectionCfg(ctx0.entity);
        const name = secid ? ((cfg.added || []).find((s) => s.id === secid) || {}).section : sec;
        confirmModal(
          '确认隐藏/删除板块「' + (name || '') + '」及其全部字段？删除后可在「板块管理」中恢复。',
          () => {
            const ctx2 = resolveSectionCtx(el); if (!ctx2) return;
            const c = ensureSectionCfg(ctx2.entity);
            if (secid) { c.deletedSections = c.deletedSections || []; if (c.deletedSections.indexOf(secid) < 0) c.deletedSections.push(secid); }
            else { c.hidden = c.hidden || []; if (c.hidden.indexOf(sec) < 0) c.hidden.push(sec); }
            if (c.addedFields) delete c.addedFields[sec];
            if (c.removedFields) delete c.removedFields[sec];
            S.saveProject(ctx2.project, false);
            render();
          },
          { okText: '删除板块' }
        );
        break;
      }
      case 'cm-add-field': {
        /* 新增字段：弹窗输入字段名与初始值；追加到该板块（新增板块写入其 fields，标准板块写入 addedFields） */
        const sec = el.dataset.si; const secid = el.dataset.secid;
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        openModal(
          '新增字段',
          field('fieldLabel', '字段名称', 'text', '', { ph: '如：负责律师、风险等级…', wide: true }) +
          field('fieldValue', '字段内容', 'textarea', '', { ph: '填写对应值', wide: true, rows: 3 }),
          (v) => {
            if (!v.fieldLabel || !v.fieldLabel.trim()) return;
            const ctx2 = resolveSectionCtx(el); if (!ctx2) return;
            const c = ensureSectionCfg(ctx2.entity);
            const fid = 'cf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const def = { id: fid, label: v.fieldLabel.trim(), type: 'text', value: v.fieldValue || '' };
            if (secid) {
              const s = (c.added || []).find((x) => x.id === secid); if (!s) return;
              s.fields = s.fields || []; s.fields.push(def);
            } else {
              c.addedFields = c.addedFields || {}; c.addedFields[sec] = c.addedFields[sec] || [];
              c.addedFields[sec].push(def);
            }
            ctx2.entity.customValues = ctx2.entity.customValues || {};
            ctx2.entity.customValues[fid] = v.fieldValue || '';
            S.saveProject(ctx2.project, false);
            closeModal(); render();
          }
        );
        break;
      }
      case 'cm-edit-field': {
        /* 编辑动态新增字段的名称与内容（核心字段不可改 label，仅可删） */
        const sec = el.dataset.si; const fid = el.dataset.fid;
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        const cfg = ensureSectionCfg(ctx0.entity);
        const found = findAddedFieldDef(cfg, sec, fid);
        if (!found) break;
        openModal(
          '编辑字段',
          field('fieldLabel', '字段名称', 'text', found.field.label, { wide: true }) +
          field('fieldValue', '字段内容', 'textarea', found.field.value || '', { wide: true, rows: 3 }),
          (v) => {
            if (!v.fieldLabel || !v.fieldLabel.trim()) return;
            const ctx2 = resolveSectionCtx(el); if (!ctx2) return;
            const c = ensureSectionCfg(ctx2.entity);
            const f2 = findAddedFieldDef(c, sec, fid);
            if (!f2) return;
            f2.field.label = v.fieldLabel.trim();
            f2.field.value = v.fieldValue || '';
            ctx2.entity.customValues = ctx2.entity.customValues || {};
            ctx2.entity.customValues[fid] = v.fieldValue || '';
            S.saveProject(ctx2.project, false);
            closeModal(); render();
          }
        );
        break;
      }
      case 'cm-del-field': {
        /* 删除单个字段：动态字段移除定义并清理值；核心字段记入 removedFields */
        const sec = el.dataset.si; const fid = el.dataset.fid;
        const ctx0 = resolveSectionCtx(el); if (!ctx0) break;
        const cfg = ensureSectionCfg(ctx0.entity);
        const addedDef = findAddedFieldDef(cfg, sec, fid);
        const name = addedDef ? addedDef.field.label : (isCoreField({ key: fid }) ? fid : '');
        confirmModal(
          '确认删除字段「' + (name || '') + '」？此操作不可撤销。',
          () => {
            const ctx2 = resolveSectionCtx(el); if (!ctx2) return;
            const c = ensureSectionCfg(ctx2.entity);
            if (addedDef) {
              if (addedDef.where === 'addedFields') c.addedFields[sec] = (c.addedFields[sec] || []).filter((f) => f.id !== fid);
              else if (addedDef.where === 'section') addedDef.secObj.fields = (addedDef.secObj.fields || []).filter((f) => f.id !== fid);
              if (ctx2.entity.customValues) delete ctx2.entity.customValues[fid];
            } else {
              c.removedFields = c.removedFields || {}; c.removedFields[sec] = c.removedFields[sec] || [];
              if (c.removedFields[sec].indexOf(fid) < 0) c.removedFields[sec].push(fid);
            }
            S.saveProject(ctx2.project, false);
            render();
          },
          { okText: '删除字段' }
        );
        break;
      }
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
    if (READONLY) return; /* 只读镜像：禁止拖拽重排（属数据编辑） */
    // 项目管理：仅在无筛选时启用（筛选态按更新时间排序，手动重排无意义）
    const f = state.projFilter;
    const hasFilter = !!(f.q || f.status || f.cause || f.tag);
    const pl = $('.proj-list');
    if (pl && !hasFilter) enableSortable(pl, { itemSelector: '.proj-row', getKey: (el) => el.dataset.id, onEnd: (ids) => S.reorderProjects(ids) });
    // 人员管理：对接人 / 经办人 两个列表分别独立重排
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
    /* 普通元素用 click 触发；<select> 用 change 触发（避免点击展开下拉时立即被 click 重渲染关闭） */
    $$('[data-act]').forEach((el) => {
      if (el.tagName === 'SELECT') el.onchange = () => onAct(el.dataset.act, el.dataset.id, el);
      else el.onclick = (e) => { onAct(el.dataset.act, el.dataset.id, el); e.stopPropagation(); };
    });
    const pq = $('[data-act="proj-q"]'); if (pq) pq.oninput = (e) => { state.projFilter.q = e.target.value; render(); };
    const cq = $('[data-act="cli-q"]'); if (cq) cq.oninput = (e) => { state.cliFilter.q = e.target.value; render(); };
    const jq = $('[data-act="jud-q"]'); if (jq) jq.oninput = (e) => { state.judFilter.q = e.target.value; render(); };
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
    bindModAreaDrag();
  }

  /* ===================== 板块拖拽排序（HTML5 DnD，适配双栏网格） =====================
   * 拖拽 mod-block 卡片调整板块顺序，拖到目标卡片前方插入；排序持久化到 sectionCfg.sectionOrder。 */
  let _dragSec = null;
  function bindModAreaDrag() {
    if (READONLY) return; /* 只读镜像：禁止板块拖拽排序 */
    const areas = $$('.mod-area');
    areas.forEach((area) => {
      area.addEventListener('dragstart', (e) => {
        const block = e.target.closest('.mod-block');
        if (!block) return;
        _dragSec = block.dataset.secName;
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragSec || ''); }
        block.classList.add('is-dragging');
      });
      area.addEventListener('dragend', () => {
        _dragSec = null;
        $$('.mod-block.is-dragging, .mod-block.drag-over').forEach((b) => b.classList.remove('is-dragging', 'drag-over'));
      });
      area.addEventListener('dragover', (e) => {
        if (!_dragSec) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const block = e.target.closest('.mod-block');
        if (block && block.dataset.secName !== _dragSec) {
          $$('.mod-block.drag-over', area).forEach((b) => b.classList.remove('drag-over'));
          block.classList.add('drag-over');
        }
      });
      area.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!_dragSec) return;
        const block = e.target.closest('.mod-block');
        if (!block || block.dataset.secName === _dragSec) return;
        const targetSec = block.dataset.secName;
        const pid = area.dataset.pid;
        const cid = area.dataset.cid;
        const project = S.getProject(pid); if (!project) return;
        let entity = project;
        if (cid) { entity = S.getCase(pid, cid) || project; }
        const cfg = ensureSectionCfg(entity);
        const order = cfg.sectionOrder || [];
        const names = projectModules(entity).map((m) => m.section);
        const curOrder = order.length ? order.filter((n) => names.indexOf(n) >= 0).concat(names.filter((n) => order.indexOf(n) < 0)) : names.slice();
        const fromIdx = curOrder.indexOf(_dragSec);
        const toIdx = curOrder.indexOf(targetSec);
        if (fromIdx < 0 || toIdx < 0) return;
        curOrder.splice(fromIdx, 1);
        curOrder.splice(toIdx, 0, _dragSec);
        cfg.sectionOrder = curOrder;
        S.saveProject(project, false);
        render();
      });
    });
  }

  LB.onSync = () => { if (state.view) render(); };

  /* ===================== 空闲自动锁定（安全层：保险库启用时，30 分钟无交互自动重载锁屏） =====================
   * 仅在 vault 启用且已解锁时生效；用户任意交互（click/keydown/scroll）重置倒计时。
   * 重载页面比主动调用 lock() 更彻底：确保内存中的明文密钥被清除。 */
  (function setupIdleLock() {
    const IDLE_MS = 30 * 60 * 1000; // 30 分钟
    let idleTimer = null;
    function resetIdleTimer() {
      if (!(LB.vault && LB.vault.enabled && LB.vault.isUnlocked())) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (LB.vault && LB.vault.lock) LB.vault.lock();
        location.reload();
      }, IDLE_MS);
    }
    ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach((ev) => {
      document.addEventListener(ev, resetIdleTimer, { passive: true, capture: true });
    });
  })();

  /* ===================== 启动 ===================== */
  function buildShell() {
    const V = LB.vault;
    if (READONLY) document.body.classList.add('app-readonly');
    const lockBtn = (V && V.enabled) ? '<button class="btn ghost vault-lockbtn" data-act="vault-lock" title="锁定并退出">🔒 锁定</button>' : '';
    const roBanner = READONLY ? '<div class="ro-banner">🔒 只读镜像模式：当前为线上加密快照，仅供查看，所有编辑功能已禁用</div>' : '';
    $('#app').innerHTML = `
      <aside class="sidebar"><div class="brand">WORK-Plat</div><nav id="nav"></nav></aside>
      <main class="main">${roBanner}<header class="topbar"><h2 id="view-title"></h2>${lockBtn}</header>
      <div class="view-scroll"><div id="view" class="view"></div></div></main>
      <div id="modal" class="modal"><div class="modal-mask" data-act="modal-mask"></div><div class="modal-card"><div class="modal-head"><h3 id="modal-title"></h3><button class="x" id="modal-x">×</button></div><div class="modal-body" id="modal-body"></div><div class="modal-foot"><button class="btn" id="modal-cancel">取消</button><button class="btn primary" id="modal-save">保存</button></div></div></div>`;
    $('#modal-x').onclick = closeModal;
    $('.modal-mask').onclick = closeModal;
  }
  function boot() {
    buildShell();
    /* 先用本地数据立即渲染，避免等待远端同步（/api/load 在云同步开启时会阻塞数秒）。
     * 远端同步改为后台进行：拉取成功且更新则二次渲染。 */
    render();
    /* 支持 ?view=xxx 直达视图（分享/书签/排查定位用） */
    try {
      const v = new URLSearchParams(location.search).get('view');
      if (v && NAV.some((n) => n.id === v)) navigate(v);
    } catch (e) {}
    remoteHydrate().then((hydrated) => { if (hydrated) render(); }).catch(() => {});
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
          <p class="vault-hint">数据在本地以 AES-GCM 256 位密码加密存储；忘记密码将无法恢复。</p>
          <p class="vault-hint" style="margin-top:6px;font-size:11px;color:var(--muted)">⏱ 30 分钟无操作将自动锁屏</p>
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
