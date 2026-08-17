/* =====================================================================
 * Legal Workbench — Data Layer (store.js)
 * 个人工作台 · 数据模型、持久化、CRUD、派生提醒、导出导入、跨标签页同步
 * 纯前端实现，使用 localStorage 持久化；多标签页通过 BroadcastChannel 实时同步
 * ===================================================================== */
(function (global) {
  'use strict';

  const LB = (global.LB = global.LB || {});
  const DB_KEY = 'legal_workbench_db_v1';
  const SYNC_CHANNEL = 'legal_workbench_sync';

  /* ---------- 工具 ---------- */
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date();
  const iso = (d) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
  const todayStr = () => new Date().toISOString().slice(0, 10);

  /* ---------- 默认（种子）数据 ---------- */
  function seed() {
    const t = now();
    const d = (offsetDays, h, m) => {
      const x = new Date(t);
      x.setDate(x.getDate() + offsetDays);
      if (h != null) { x.setHours(h, m || 0, 0, 0); }
      return x.toISOString();
    };
    const projects = [
      {
        id: 'prj_seed1', name: '百高项目债权处置', category: '破产类',
        agentLawyer: '《委托代理合同》/我',
        party: '百高资产管理有限公司', caseNo: '(2026)粤03破申112号',
        opponent: '', handlerContact: '我 13800001111', seizures: [{ type: '不动产', name: '盈基大厦（不动产抵押+股权质押）', start: '2026-04-29', end: '2028-04-28', renewalEnd: '2030-10-29' }],
        contractName: '综合法律服务合同', contractNo: 'HT-2026-0102', cause: '债权处置/破产重整', signDate: '2026-01-08',
        fee: '前期固定 80万 / 后期按回款 8%', feePayment: '已付首期 40万', feeExtraction: '待回款后提取', transferTime: '2026-06-30', transferAmount: '转付杜总 12万',
        hearingDate: d(5, 9, 30), contractExpiryDate: d(60), renewalDate: '2028-03-29',
        tags: ['破产', '债权处置'], status: '进行中',
        manager: '我', managerContact: '13800001111', contact: '杜总', contactContact: '13900008888',
        todo: '提前45日寄出续封文件并联系经办核对', handover: '卷宗移交本人，同步电子目录',
        creditors: [{ id: 'cr_seed1', name: '百高资产管理有限公司', transfers: [{ id: 'tf_seed1', date: '2021-07', from: '某信托有限公司', to: '百高资产管理有限公司', amount: '本金 1.2 亿元', applicant: '百高资产管理有限公司' }] }], debtor: '债务人某实业公司', admin: '盈基清算组', claimAmount: '—', bankruptcyStage: '重整',
        progress: [
          { date: '2026-01-12', content: '完成债权尽调，制定处置方案。', author: '我' },
          { date: '2026-04-29', content: '办理盈基大厦查封，注意到期续封。', author: '我' },
          { date: '2026-06-30', content: '完成首笔回款并转付杜总。', author: '我' }
        ],
        createdAt: d(-120), updatedAt: d(-2)
      },
      {
        id: 'prj_seed2', name: '明月地产建设工程合同审查', category: '其他类',
        agentLawyer: '《法律顾问合同》/我',
        party: '明月地产集团', caseNo: '—',
        opponent: '—', handlerContact: '我 13800003333', seizures: [],
        contractName: '建设工程施工合同', contractNo: 'HT-2026-0205', cause: '合同审查', signDate: '2026-05-20',
        fee: '年顾问费 30万', feePayment: '已付', feeExtraction: '—', transferTime: null, transferAmount: null,
        hearingDate: null, contractExpiryDate: d(20), renewalDate: null,
        tags: ['非诉', '建设工程'], status: '进行中',
        manager: '我', managerContact: '13800003333', contact: '陈经理', contactContact: '13900004444',
        todo: '二次审阅后出具正式审查意见', handover: '—',
        progress: [
          { date: '2026-05-22', content: '完成主合同风险审查，反馈12处修改建议。', author: '我' }
        ],
        createdAt: d(-80), updatedAt: d(-5)
      },
      {
        id: 'prj_seed3', name: '星河生物劳动仲裁代理', category: '诉讼类',
        agentLawyer: '《委托代理协议》/我',
        party: '星河生物股份有限公司', caseNo: '(2026)京0108劳仲0123号',
        opponent: '前员工李某', handlerContact: '我 13800001111', seizures: [],
        contractName: '委托代理协议', contractNo: 'HT-2026-0170', cause: '劳动争议', signDate: '2026-02-10',
        fee: '基础代理费 5万', feePayment: '已付', feeExtraction: '—', transferTime: null, transferAmount: null,
        hearingDate: d(2, 14, 0), contractExpiryDate: null, renewalDate: d(10),
        tags: ['仲裁', '劳动法'], status: '进行中',
        manager: '我', managerContact: '13800001111', contact: '赵主管', contactContact: '13900005555',
todo: '开庭前完成证据原件核对', handover: '—',
        court: '北京市海淀区劳动人事争议仲裁委员会', claim: '确认劳动关系并支付经济补偿', stage: '仲裁', limitation: null, evidence: '',
        progress: [{ date: '2026-02-15', content: '收集劳动关系证据，撰写仲裁申请书。', author: '我' }],
        doneEvents: [],
        createdAt: d(-150), updatedAt: d(-1)
      }
    ];
    projects.forEach((p) => { if (!Array.isArray(p.cases)) p.cases = []; if (!Array.isArray(p.notes)) p.notes = []; if (!Array.isArray(p.doneEvents)) p.doneEvents = []; (p.cases || []).forEach((c) => { if (!Array.isArray(c.doneEvents)) c.doneEvents = []; }); });
    const tasks = [
      { id: 'tsk_seed1', title: '提交百高项目处置进展报告', dueDate: d(3, 18, 0), projectId: 'prj_seed1', status: '待办', createdAt: d(-4), completedAt: null, history: [{ date: d(-4), from: '—', to: '待办', by: '我' }] },
      { id: 'tsk_seed2', title: '明月地产合同二次审阅', dueDate: d(8, 18, 0), projectId: 'prj_seed2', status: '待办', createdAt: d(-3), completedAt: null, history: [{ date: d(-3), from: '—', to: '待办', by: '我' }] },
      { id: 'tsk_seed3', title: '准备星河生物开庭材料', dueDate: d(1, 18, 0), projectId: 'prj_seed3', status: '待审阅', createdAt: d(-6), completedAt: null, history: [{ date: d(-6), from: '—', to: '待办', by: '我' }, { date: d(-2), from: '待办', to: '待审阅', by: '我' }] },
      { id: 'tsk_seed4', title: '归档百高项目立案卷宗', dueDate: d(-2, 18, 0), projectId: 'prj_seed1', status: '已完成', createdAt: d(-12), completedAt: d(-1), history: [{ date: d(-12), from: '—', to: '待办', by: '我' }, { date: d(-1), from: '待办', to: '已完成', by: '我' }] }
    ];
    const clients = [
      { id: 'cli_seed1', name: '张总', project: '百高项目债权处置', company: '恒泰科技有限公司', contact: '13900002222', address: '深圳市福田区', records: [{ date: '2026-03-12', content: '签约股权转让纠纷代理，确认处置方案。', by: '我' }] },
      { id: 'cli_seed2', name: '陈经理', project: '明月地产建设工程合同审查', company: '明月地产集团', contact: '13900004444', address: '广州市天河区', records: [{ date: '2026-05-20', content: '建设工程合同审查委托，对接二次审阅。', by: '我' }] },
      { id: 'cli_seed3', name: '赵主管', project: '星河生物劳动仲裁代理', company: '星河生物股份有限公司', contact: '13900005555', address: '北京市海淀区', records: [{ date: '2026-02-10', content: '劳动仲裁代理委托，对接证据收集。', by: '我' }] }
    ];
    const judges = [
      { id: 'jud_seed1', name: '李法官', case: '百高系列债权处置（重整）', court: '深圳市中级人民法院', contact: '0755-12345678', address: '深圳市福田区', records: [{ date: '2026-04-30', content: '沟通盈基大厦查封续封排期。', by: '我' }] },
      { id: 'jud_seed2', name: '王法官', case: '星河生物劳动争议仲裁', court: '北京市海淀区劳动人事争议仲裁委员会', contact: '010-87654321', address: '北京市海淀区', records: [{ date: '2026-08-10', content: '确认开庭证据清单提交时限。', by: '我' }] }
    ];
    const lawItems = [
      { id: 'law_seed1', title: '《中华人民共和国民法典》第577条', category: '合同法', content: '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。' },
      { id: 'law_seed2', title: '《中华人民共和国公司法》第71条', category: '公司法', content: '有限责任公司的股东之间可以相互转让其全部或者部分股权。股东向股东以外的人转让股权，应当经其他股东过半数同意。' },
      { id: 'law_seed3', title: '《中华人民共和国劳动合同法》第47条', category: '劳动法', content: '经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。六个月以上不满一年的，按一年计算；不满六个月的，向劳动者支付半个月工资的经济补偿。' },
      { id: 'law_seed4', title: '《中华人民共和国民事诉讼法》第65条', category: '诉讼法', content: '当事人对自己提出的主张应当及时提供证据。人民法院根据当事人的主张和案件审理情况，确定当事人应当提供的证据及其期限。' }
    ];
    return {
      projects, tasks, clients, judges, lawItems, events: [],
      audit: [{ id: uid('aud'), ts: d(-1), user: '系统', action: '初始化', detail: '载入示范数据' }],
      meta: { lastSync: null, currentUser: '我' }
    };
  }

  /* 保险库锁定时使用的空壳，避免用种子数据覆盖未解密的原文 */
  function emptyDb() {
    return { projects: [], tasks: [], clients: [], judges: [], lawItems: [], events: [], audit: [], meta: { lastSync: null, currentUser: '我' } };
  }

  /* ---------- 持久化 ---------- */
  let DB;
  let channel = null;
  try { channel = ('BroadcastChannel' in global) ? new BroadcastChannel(SYNC_CHANNEL) : null; } catch (e) { channel = null; }

  function load() {
    const vaultOn = !!(LB.vault && LB.vault.enabled);
    try {
      const raw = global.localStorage.getItem(DB_KEY);
      if (raw) {
        if (vaultOn) {
          // 保险库启用且锁定：延迟解密，先缓存原文，返回空壳避免覆盖
          if (LB.vault) LB.vault.pendingRaw = raw;
          return emptyDb();
        }
        const parsed = JSON.parse(raw);
        if (parsed && parsed.projects) {
          parsed.clients = parsed.clients || []; parsed.judges = parsed.judges || [];
          parsed.events = Array.isArray(parsed.events) ? parsed.events : []; parsed.events.forEach((e) => { if (e.done === undefined) e.done = false; });
          const cur = (parsed.meta && parsed.meta.currentUser) || '我';
          parsed.projects.forEach((p) => { if (!Array.isArray(p.cases)) p.cases = []; if (!Array.isArray(p.doneEvents)) p.doneEvents = []; migrateNotes(p, cur); migrateFee(p); migrateSeizures(p); migrateCreditors(p); migrateAgent(p); (p.cases || []).forEach((c) => { migrateNotes(c, cur); migrateFee(c); migrateSeizures(c); migrateCreditors(c); migrateAgent(c); if (!Array.isArray(c.doneEvents)) c.doneEvents = []; }); });
          return parsed;
        }
      }
    } catch (e) { /* ignore */ }
    if (vaultOn) return emptyDb();
    const s = seed();
    persist(s, true);
    return s;
  }

  async function persist(db, silent) {
    DB = db || DB;
    let raw;
    // 保险库启用且已解锁：用密码派生密钥加密后写入（密文即使被读取也无法还原）
    if (LB.vault && LB.vault.enabled && LB.vault.isUnlocked() && LB.vault.key) {
      try { raw = await LB.vault.seal(DB); } catch (e) { raw = JSON.stringify(DB); }
    } else {
      raw = JSON.stringify(DB);
    }
    try { global.localStorage.setItem(DB_KEY, raw); } catch (e) { console.error('save failed', e); }
    if (!silent && channel) {
      try { channel.postMessage({ type: 'db', ts: Date.now() }); } catch (e) {}
    }
    // 本地同步服务钩子（仅浏览器 + localhost:8200，避免 Node 测试环境触发网络请求）
    // 保险库启用时发送密文字符串，服务端原样存储；否则发送明文 DB 对象
    if (typeof location !== 'undefined' && location.port === '8200' && typeof fetch === 'function' && typeof LB.onPersist === 'function') {
      try { LB.onPersist(raw); } catch (e) {}
    }
  }

  if (channel) {
    channel.onmessage = async (ev) => {
      if (ev.data && ev.data.type === 'db') {
        try {
          const raw = global.localStorage.getItem(DB_KEY);
          if (raw) {
            if ((LB.vault && LB.vault.enabled) && ('' + raw).indexOf('v1:') === 0) {
              // 密文：仅当本标签页已解锁时才解密同步
              if (LB.vault.isUnlocked() && LB.vault.key) { DB = await LB.vault.unseal(raw); DB.meta.lastSync = new Date().toISOString(); if (LB.onSync) LB.onSync(); }
            } else {
              DB = JSON.parse(raw); DB.meta.lastSync = new Date().toISOString(); if (LB.onSync) LB.onSync();
            }
          }
        } catch (e) {}
      }
    };
  }

  /* DB 在文件末尾（所有 const 与迁移辅助函数声明完成后）统一初始化，避免 SEIZURE_PERIODS 等常量在 TDZ 中被提前引用 */

  /* ---------- 审计日志 ---------- */
  function audit(action, detail, user) {
    DB.audit.unshift({ id: uid('aud'), ts: new Date().toISOString(), user: user || DB.meta.currentUser, action, detail });
    if (DB.audit.length > 500) DB.audit.length = 500;
    persist();
  }

  /* ---------- 通用 CRUD ---------- */
  function find(arr, id) { return arr.find((x) => x.id === id); }

  /* 旧版「文书材料」(docs) 迁移为「其他备注」(notes)：保留信息、删除 docs 字段。
   * note：{ recipient 接收人, content 备注, archiveLocation 纸质档案位置, archiveCabinet 档案柜, author, date } */
  function migrateNotes(o, curUser) {
    if (!o) return;
    if (!Array.isArray(o.notes)) {
      if (Array.isArray(o.docs)) {
        o.notes = o.docs.map((d) => ({ recipient: d.by || '', content: [d.name, d.note].filter(Boolean).join('：'), archiveLocation: '', archiveCabinet: '', author: d.by || curUser || '我', date: d.date || todayStr() }));
      } else {
        o.notes = [];
      }
    }
    delete o.docs;
  }

  /* 旧版「律师费(前期/固定)」+「律师费(后期)」合并为单一「律师费」 */
  function migrateFee(o) {
    if (!o) return;
    if (o.fee == null || o.fee === '') {
      const parts = [o.feeUpfront, o.feeLater].map((x) => (x == null ? '' : ('' + x).trim())).filter(Boolean);
      o.fee = parts.length ? parts.join(' / ') : ''; // 归一化为字符串，避免 undefined
    }
    delete o.feeUpfront; delete o.feeLater;
  }
  /* 旧版 抵质押物/查封物/查封起算日/查封截止日（标量）→ 多项 seizures 数组（按类型自动计算期限） */
  function migrateSeizures(o) {
    if (!o) return;
    if (!Array.isArray(o.seizures)) {
      const name = [o.seizedItem, o.collateral].map((x) => (x == null ? '' : ('' + x).trim())).filter(Boolean).join('、');
      const start = o.seizureStart || '';
      const end = o.seizureEnd || '';
      if (name || start || end) {
        const item = { type: '不动产', name: name, start: start, end: end, renewalEnd: '' };
        if (start) { const c = computeSeizureEnd(item.type, start); item.end = c.end; item.renewalEnd = c.renewalEnd; }
        o.seizures = [item];
      } else {
        o.seizures = [];
      }
    }
    delete o.seizedItem; delete o.collateral; delete o.seizureStart; delete o.seizureEnd;
  }
  /* 旧版「代理合同及代理律师」(contractLawyer) → 单一「代理律师」(agentLawyer) */
  function migrateAgent(o) {
    if (!o) return;
    if ((o.agentLawyer == null || o.agentLawyer === '') && o.contractLawyer != null) {
      o.agentLawyer = ('' + o.contractLawyer).trim();
    }
    delete o.contractLawyer;
  }
  /* 旧版单一「债权持有人」(creditor) → 多项 creditors 数组（每项含债权流转明细 transfers） */
  function migrateCreditors(o) {
    if (!o) return;
    if (!Array.isArray(o.creditors)) {
      if (o.creditor) {
        o.creditors = [{ id: uid('cr'), name: ('' + o.creditor).trim(), transfers: [] }];
      } else {
        o.creditors = [];
      }
    }
    delete o.creditor;
  }

  /* 查封 / 冻结期限：按财产类型确定上限；续封期限 ≤ 原期限 1/2（法源：查封规定 2020修正 第1条） */
  const SEIZURE_PERIODS = { '资金/银行存款': 12, '动产': 24, '不动产': 36, '其他财产权': 36 }; // 单位：月
  function addMonthsISO(s, n) {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
  }
  function computeSeizureEnd(type, start) {
    const p = SEIZURE_PERIODS[type] || 36;
    return { end: addMonthsISO(start, p), renewalEnd: addMonthsISO(start, Math.round(p * 1.5)) };
  }
  function seizureSummary(arr) {
    if (!Array.isArray(arr) || !arr.length) return '—';
    return arr.map((s) => {
      const e = computeSeizureEnd(s.type || '不动产', s.start);
      const end = s.end || e.end, rEnd = s.renewalEnd || e.renewalEnd;
      return [s.type, s.name].filter(Boolean).join(':') + '（' + (s.start || '?') + '→' + (end || '?') + (rEnd ? ' / 续封最迟' + rEnd : '') + '）';
    }).join(' | ');
  }
  function seizureEarliest(arr) {
    if (!Array.isArray(arr)) return '';
    const ends = arr.map((s) => s.end || computeSeizureEnd(s.type || '不动产', s.start).end).filter(Boolean).sort();
    return ends.length ? ends[0] : '';
  }
  /* 债权持有人多项汇总（用于导出）：名称 + 流转链（原始债权人→受让方(时间)） */
  function creditorSummary(arr) {
    if (!Array.isArray(arr) || !arr.length) return '—';
    return arr.map((h) => {
      const chain = (h.transfers || []).map((x) => [x.from, x.to].filter(Boolean).join('→') + (x.date ? '(' + x.date + ')' : '')).join('、');
      return [h.name, chain].filter(Boolean).join('：');
    }).join(' | ');
  }

  /* 至此所有 const（SEIZURE_PERIODS 等）与迁移/计算辅助函数均已声明完成，可安全调用 load() 触发迁移 */
  DB = load();

  /* 拖拽重排：把 ids 指定的子集按新顺序排好，未参与项保持原有相对顺序；整块插入到首个参与项的原位置 */
  function applyOrder(arr, ids) {
    const set = new Set(ids);
    const map = {};
    arr.forEach((x) => { map[x.id] = x; });
    const ordered = ids.map((id) => map[id]).filter(Boolean);
    const result = [];
    let inserted = false;
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      if (set.has(x.id)) { if (!inserted) { result.push.apply(result, ordered); inserted = true; } }
      else result.push(x);
    }
    if (!inserted) result.push.apply(result, ordered);
    return result;
  }

  const store = {
    get DB() { return DB; },
    meta() { return DB.meta; },
    setCurrentUser(u) { DB.meta.currentUser = u; persist(); },
    persist, // 暴露持久化（保险库解锁时落盘为密文）

    /* == 项目 == */
    listProjects() { return DB.projects.slice(); },
    getProject(id) { return find(DB.projects, id); },
    saveProject(p, isNew) {
      p.cases = Array.isArray(p.cases) ? p.cases : [];
      if (isNew) { p.id = uid('prj'); p.createdAt = new Date().toISOString(); p.progress = p.progress || []; p.notes = p.notes || []; DB.projects.push(p); audit('新建项目', p.name); }
      else { const o = find(DB.projects, p.id); if (!o) return; Object.assign(o, p); DB.projects[DB.projects.indexOf(o)] = o; audit('更新项目', p.name); }
      p.updatedAt = new Date().toISOString();
      persist();
      return p;
    },
    deleteProject(id) {
      const o = find(DB.projects, id); if (!o) return;
      DB.projects = DB.projects.filter((x) => x.id !== id);
      DB.tasks = DB.tasks.filter((x) => x.projectId !== id);
      audit('删除项目', o.name);
      persist();
    },

    /* == 排序：拖拽重排持久化（子集安全，保留未参与项的相对顺序） == */
    reorderProjects(ids) { DB.projects = applyOrder(DB.projects, ids); audit('排序项目', '拖动调整顺序'); persist(); },
    reorderClients(ids) { DB.clients = applyOrder(DB.clients, ids); audit('排序对接人', '拖动调整顺序'); persist(); },
    reorderJudges(ids) { DB.judges = applyOrder(DB.judges, ids); audit('排序经办法官', '拖动调整顺序'); persist(); },
    reorderTasks(ids) { DB.tasks = applyOrder(DB.tasks, ids); audit('排序任务', '拖动调整顺序'); persist(); },
    addProgress(id, note) {
      const o = find(DB.projects, id); if (!o) return;
      o.progress.unshift({ date: note.date || todayStr(), content: note.content, author: note.author || DB.meta.currentUser });
      o.updatedAt = new Date().toISOString();
      audit('新增进展', o.name + '：' + note.content.slice(0, 20));
      persist();
    },
    deleteProgress(id, idx) {
      const o = find(DB.projects, id); if (!o || !o.progress) return;
      const d = o.progress[idx]; if (!d) return;
      o.progress.splice(idx, 1);
      o.updatedAt = new Date().toISOString();
      audit('删除进展', o.name + '：' + (d.content || '').slice(0, 20));
      persist();
    },
    updateProgress(id, idx, note) {
      const o = find(DB.projects, id); if (!o || !o.progress) return;
      const d = o.progress[idx]; if (!d) return;
      if (note.content != null) d.content = note.content;
      if (note.date) d.date = note.date;
      o.updatedAt = new Date().toISOString();
      audit('更新进展', o.name + '：' + (note.content || '').slice(0, 20));
      persist();
    },
    addNote(id, note) {
      const o = find(DB.projects, id); if (!o) return;
      o.notes = o.notes || [];
      o.notes.unshift({ recipient: note.recipient || '', content: note.content || '', archiveLocation: note.archiveLocation || '', archiveCabinet: note.archiveCabinet || '', author: note.author || DB.meta.currentUser, date: note.date || todayStr() });
      o.updatedAt = new Date().toISOString();
      audit('新增备注', o.name + '：' + (note.content || '').slice(0, 20));
      persist();
    },
    deleteNote(id, idx) {
      const o = find(DB.projects, id); if (!o || !o.notes) return;
      const d = o.notes[idx]; if (!d) return;
      o.notes.splice(idx, 1);
      o.updatedAt = new Date().toISOString();
      audit('删除备注', o.name + '：' + (d.content || '').slice(0, 20));
      persist();
    },

    /* == 关联案件（每个案件携带与项目相同维度的完整字段集） == */
    listCases(projectId) { const p = find(DB.projects, projectId); return (p && Array.isArray(p.cases)) ? p.cases.slice() : []; },
    getCase(projectId, caseId) { const p = find(DB.projects, projectId); return (p && p.cases) ? p.cases.find((x) => x.id === caseId) : null; },
    saveCase(projectId, c, isNew) {
      const p = find(DB.projects, projectId); if (!p) return null;
      if (!Array.isArray(p.cases)) p.cases = [];
      if (isNew) { c.id = uid('cse'); c.createdAt = new Date().toISOString(); c.progress = c.progress || []; c.notes = c.notes || []; p.cases.push(c); audit('新建关联案件', p.name + ' / ' + (c.name || '未命名案件')); }
      else { const o = p.cases.find((x) => x.id === c.id); if (!o) return null; Object.assign(o, c); p.cases[p.cases.indexOf(o)] = o; audit('更新关联案件', p.name + ' / ' + (c.name || '未命名案件')); }
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString(); persist();
      return c;
    },
    deleteCase(projectId, caseId) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c) return;
      p.cases = p.cases.filter((x) => x.id !== caseId);
      p.updatedAt = new Date().toISOString();
      audit('删除关联案件', p.name + ' / ' + (c.name || '未命名案件'));
      persist();
    },
    addCaseProgress(projectId, caseId, note) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c) return;
      c.progress = c.progress || [];
      c.progress.unshift({ date: note.date || todayStr(), content: note.content, author: note.author || DB.meta.currentUser });
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString();
      audit('新增案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + note.content.slice(0, 20));
      persist();
    },
    deleteCaseProgress(projectId, caseId, idx) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.progress) return;
      const d = c.progress[idx]; if (!d) return;
      c.progress.splice(idx, 1);
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString();
      audit('删除案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + (d.content || '').slice(0, 20));
      persist();
    },
    updateCaseProgress(projectId, caseId, idx, note) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.progress) return;
      const d = c.progress[idx]; if (!d) return;
      if (note.content != null) d.content = note.content;
      if (note.date) d.date = note.date;
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString();
      audit('更新案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + (note.content || '').slice(0, 20));
      persist();
    },
    addCaseNote(projectId, caseId, note) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c) return;
      c.notes = c.notes || [];
      c.notes.unshift({ recipient: note.recipient || '', content: note.content || '', archiveLocation: note.archiveLocation || '', archiveCabinet: note.archiveCabinet || '', author: note.author || DB.meta.currentUser, date: note.date || todayStr() });
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString();
      audit('新增案件备注', p.name + ' / ' + (c.name || '未命名案件'));
      persist();
    },
    deleteCaseNote(projectId, caseId, idx) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.notes) return;
      const d = c.notes[idx]; if (!d) return;
      c.notes.splice(idx, 1);
      c.updatedAt = new Date().toISOString(); p.updatedAt = new Date().toISOString();
      audit('删除案件备注', p.name + ' / ' + (c.name || '未命名案件'));
      persist();
    },

    /* == 任务 == */
    listTasks() { return DB.tasks.slice(); },
    getTask(id) { return find(DB.tasks, id); },
    saveTask(t, isNew) {
      if (isNew) { t.id = uid('tsk'); t.createdAt = new Date().toISOString(); t.history = [{ date: new Date().toISOString(), from: '—', to: t.status || '待办', by: DB.meta.currentUser }]; DB.tasks.push(t); audit('新建任务', t.title); }
      else { const o = find(DB.tasks, t.id); if (!o) return; Object.assign(o, t); audit('更新任务', t.title); }
      persist();
      return t;
    },
    setTaskStatus(id, status) {
      const o = find(DB.tasks, id); if (!o || o.status === status) return;
      const from = o.status;
      o.status = status;
      o.history.unshift({ date: new Date().toISOString(), from, to: status, by: DB.meta.currentUser });
      if (status === '已完成') {
        o.completedAt = new Date().toISOString();
        // 自动归档到关联项目：以「年月日，完成了什么工作」形式写入项目进展
        const p = find(DB.projects, o.projectId);
        if (p) {
          const d = new Date();
          const ds = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
          p.progress.unshift({ date: todayStr(), content: ds + '，完成「' + (o.title || '工作') + '」', author: DB.meta.currentUser });
          p.updatedAt = new Date().toISOString();
          audit('自动归档', p.name + '：' + (o.title || '工作'));
        }
      }
      audit('任务状态变更', o.title + '：' + from + '→' + status);
      persist();
    },
    deleteTask(id) { const o = find(DB.tasks, id); if (!o) return; DB.tasks = DB.tasks.filter((x) => x.id !== id); audit('删除任务', o.title); persist(); },

    /* == 客户 == */
    listClients() { return DB.clients.slice(); },
    getClient(id) { return find(DB.clients, id); },
    saveClient(c, isNew) {
      if (isNew) { c.id = uid('cli'); c.records = c.records || []; DB.clients.push(c); audit('新建客户', c.name); }
      else { const o = find(DB.clients, c.id); if (!o) return; Object.assign(o, c); audit('更新客户', c.name); }
      persist(); return c;
    },
    addClientRecord(id, rec) {
      const o = find(DB.clients, id); if (!o) return;
      o.records.unshift({ date: rec.date || todayStr(), content: rec.content, by: rec.by || DB.meta.currentUser });
      audit('客户沟通记录', o.name);
      persist();
    },
    deleteClient(id) { const o = find(DB.clients, id); if (!o) return; DB.clients = DB.clients.filter((x) => x.id !== id); audit('删除客户', o.name); persist(); },

    /* == 经办法官 == */
    listJudges() { return DB.judges.slice(); },
    getJudge(id) { return find(DB.judges, id); },
    saveJudge(j, isNew) {
      if (isNew) { j.id = uid('jud'); j.records = j.records || []; DB.judges.push(j); audit('新建经办法官', j.name); }
      else { const o = find(DB.judges, j.id); if (!o) return; Object.assign(o, j); audit('更新经办法官', j.name); }
      persist(); return j;
    },
    addJudgeRecord(id, rec) {
      const o = find(DB.judges, id); if (!o) return;
      o.records.unshift({ date: rec.date || todayStr(), content: rec.content, by: rec.by || DB.meta.currentUser });
      audit('法官沟通记录', o.name);
      persist();
    },
    deleteJudge(id) { const o = find(DB.judges, id); if (!o) return; DB.judges = DB.judges.filter((x) => x.id !== id); audit('删除经办法官', o.name); persist(); },

    /* == 法规 == */
    listLaw() { return DB.lawItems.slice(); },
    saveLaw(l, isNew) { if (isNew) { l.id = uid('law'); DB.lawItems.push(l); } else { const o = find(DB.lawItems, l.id); if (!o) return; Object.assign(o, l); } persist(); audit(isNew ? '新增法规' : '更新法规', l.title); },
    deleteLaw(id) { DB.lawItems = DB.lawItems.filter((x) => x.id !== id); audit('删除法规', id); persist(); },

    /* == 审计（仅保留数据层，UI 入口已移除） == */

    /* == 日程事件（手动事件存入 DB.events，与项目/案件日期派生的日程共用"已完成"语义） == */
    listManualEvents() { return DB.events; },
    saveManualEvent(e, isNew) { if (isNew) e.id = uid('evt'); if (e.done === undefined) e.done = false; DB.events.push(e); audit('新增日程', e.title); persist(); return e; },
    deleteManualEvent(id) { DB.events = DB.events.filter((x) => x.id !== id); audit('删除日程', id); persist(); },

    /* == 派生日程：把任务截止、开庭、合同到期、查封到期映射为事件 == */
    deriveEvents() {
      const evts = [];
      DB.tasks.forEach((t) => {
        if (t.status === '已完成') return;
        evts.push({ id: 'evt_task_' + t.id, kind: 'task', refId: t.id, title: '✅ 任务：' + t.title, start: t.dueDate, end: t.dueDate, projectId: t.projectId, allDay: true });
      });
      DB.projects.forEach((p) => {
        const de = p.doneEvents || [];
        if (p.hearingDate) evts.push({ id: 'evt_hearing_' + p.id, kind: 'hearing', refId: p.id, title: '⚖️ 开庭：' + p.name, start: p.hearingDate, end: p.hearingDate, projectId: p.id, allDay: false, done: de.includes('hearing') });
        if (p.contractExpiryDate) evts.push({ id: 'evt_cexp_' + p.id, kind: 'contract', refId: p.id, title: '📄 合同到期：' + p.name, start: p.contractExpiryDate, end: p.contractExpiryDate, projectId: p.id, allDay: true, done: de.includes('contract') });
        if (p.renewalDate) evts.push({ id: 'evt_ren_' + p.id, kind: 'renewal', refId: p.id, title: '🔔 查封到期提醒：' + p.name, start: p.renewalDate, end: p.renewalDate, projectId: p.id, allDay: true, done: de.includes('renewal') });
        (p.cases || []).forEach((c) => {
          const cid = p.id + '_' + c.id;
          const cde = c.doneEvents || [];
          if (c.hearingDate) evts.push({ id: 'evt_hearing_' + cid, kind: 'hearing', refId: p.id, caseId: c.id, title: '⚖️ 开庭：' + (c.name || '关联案件'), start: c.hearingDate, end: c.hearingDate, projectId: p.id, allDay: false, done: cde.includes('hearing') });
          if (c.contractExpiryDate) evts.push({ id: 'evt_cexp_' + cid, kind: 'contract', refId: p.id, caseId: c.id, title: '📄 合同到期：' + (c.name || '关联案件'), start: c.contractExpiryDate, end: c.contractExpiryDate, projectId: p.id, allDay: true, done: cde.includes('contract') });
          if (c.renewalDate) evts.push({ id: 'evt_ren_' + cid, kind: 'renewal', refId: p.id, caseId: c.id, title: '🔔 查封到期提醒：' + (c.name || '关联案件'), start: c.renewalDate, end: c.renewalDate, projectId: p.id, allDay: true, done: cde.includes('renewal') });
        });
      });
      DB.events.forEach((e) => evts.push(Object.assign({ kind: 'manual', done: !!e.done }, e)));
      return evts;
    },

    /* == 提醒拆分：日程提醒 / 任务提醒 双通道 ==
       设计约束：日程数据仅存在于「日程管理」模块（项目/案件日期字段 + 手动日程事件），
       不展示、也不同步到任务管理界面；任务管理界面只负责任务相关的提醒与展示。 */

    /* 日程提醒：仅来源于日程管理模块（开庭/合同到期/查封到期 + 手动日程事件），不含任何任务 */
    scheduleReminders(days) {
      const win = (typeof days === 'number') ? days : 14;
      const out = [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const within = (isoStr, d) => { if (!isoStr) return false; const x = new Date(isoStr); x.setHours(0, 0, 0, 0); const diff = (x - today) / 86400000; return diff >= 0 && diff <= d; };
      DB.projects.forEach((p) => {
        if (within(p.hearingDate, win)) out.push({ level: '高', type: '开庭日期', kind: 'hearing', project: p.name, date: p.hearingDate, projectId: p.id });
        if (within(p.contractExpiryDate, win)) out.push({ level: '高', type: '合同到期', kind: 'contract', project: p.name, date: p.contractExpiryDate, projectId: p.id });
        if (within(p.renewalDate, win)) out.push({ level: '中', type: '查封到期提醒', kind: 'renewal', project: p.name, date: p.renewalDate, projectId: p.id });
        (p.cases || []).forEach((c) => {
          const nm = p.name + ' / ' + (c.name || '关联案件');
          if (within(c.hearingDate, win)) out.push({ level: '高', type: '开庭日期', kind: 'hearing', caseId: c.id, project: nm, date: c.hearingDate, projectId: p.id });
          if (within(c.contractExpiryDate, win)) out.push({ level: '高', type: '合同到期', kind: 'contract', caseId: c.id, project: nm, date: c.contractExpiryDate, projectId: p.id });
          if (within(c.renewalDate, win)) out.push({ level: '中', type: '查封到期提醒', kind: 'renewal', caseId: c.id, project: nm, date: c.renewalDate, projectId: p.id });
        });
      });
      // 手动日程事件仅来自日程管理模块，纳入日程提醒
      DB.events.forEach((e) => {
        if (within(e.start, win)) out.push({ level: within(e.start, 3) ? '高' : '中', type: '手动日程', kind: 'manual', title: e.title, project: (e.projectId ? ((find(DB.projects, e.projectId) || {}).name || '') : '') || e.title, date: e.start, eventId: e.id, projectId: e.projectId || null });
      });
      // 已完成的日程在任务提醒界面消失
      const live = out.filter((r) => !this.isScheduleDone(r));
      live.sort((a, b) => new Date(a.date) - new Date(b.date));
      return live;
    },

    /* 任务提醒：仅来源于任务截止，不含任何日程项 */
    taskReminders() {
      const out = [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const within = (isoStr, d) => { if (!isoStr) return false; const x = new Date(isoStr); x.setHours(0, 0, 0, 0); const diff = (x - today) / 86400000; return diff >= 0 && diff <= d; };
      DB.tasks.forEach((t) => {
        if (t.status === '已完成') return;
        if (within(t.dueDate, 3)) out.push({ level: t.status === '待审阅' ? '高' : '中', type: '任务截止', project: (store.getProject(t.projectId) || {}).name || '—', date: t.dueDate, taskId: t.id });
      });
      out.sort((a, b) => new Date(a.date) - new Date(b.date));
      return out;
    },

    /* 兼容旧调用：合并双通道（用于不需要区分来源的历史入口） */
    reminders() {
      const out = this.scheduleReminders().concat(this.taskReminders());
      out.sort((a, b) => new Date(a.date) - new Date(b.date));
      return out;
    },

    /* 判断某条日程提醒是否已"完成"（手动事件看 e.done；项目/案件派生看 doneEvents 集合） */
    isScheduleDone(r) {
      if (!r) return false;
      if (r.eventId) { const e = DB.events.find((x) => x.id === r.eventId); return !!(e && e.done); }
      const p = find(DB.projects, r.projectId); if (!p) return false;
      if (r.caseId) { const c = (p.cases || []).find((x) => x.id === r.caseId); return !!(c && c.doneEvents && c.doneEvents.includes(r.kind)); }
      return !!(p.doneEvents && p.doneEvents.includes(r.kind));
    },
    /* 切换日程"完成"状态：完成则自动归档到所属项目"进展"，并写入审计 */
    setScheduleDone(r, val) {
      if (!r) return;
      if (r.eventId) {
        const e = DB.events.find((x) => x.id === r.eventId); if (!e) return;
        e.done = val; audit(val ? '完成日程' : '恢复日程', e.title);
        if (val) this.addProgress(r.projectId, { content: '日程已完成：' + e.title + (e.start ? '（' + e.start.slice(0, 10) + '）' : '') });
        persist(); return;
      }
      const p = find(DB.projects, r.projectId); if (!p) return;
      let arr = null;
      if (r.caseId) { const c = (p.cases || []).find((x) => x.id === r.caseId); if (!c) return; c.doneEvents = c.doneEvents || []; arr = c.doneEvents; }
      else { p.doneEvents = p.doneEvents || []; arr = p.doneEvents; }
      const i = arr.indexOf(r.kind);
      if (val && i < 0) arr.push(r.kind);
      if (!val && i >= 0) arr.splice(i, 1);
      audit(val ? '完成日程' : '恢复日程', r.project || p.name);
      if (val) this.addProgress(p.id, { content: '日程已完成：' + (r.project || p.name) + '（' + (r.type || '') + (r.date ? '，' + r.date.slice(0, 10) : '') + '）' });
      persist();
    },

    /* == 统计 == */
    stats() {
      const ps = DB.projects, ts = DB.tasks;
      const byStatus = {}, byCause = {};
      let totalCases = 0;
      ps.forEach((p) => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; byCause[p.cause] = (byCause[p.cause] || 0) + 1; totalCases += (Array.isArray(p.cases) ? p.cases.length : 0); });
      const taskPri = { 高: 0, 中: 0, 低: 0 }; const taskStatus = { 待办: 0, 待审阅: 0, 已完成: 0 };
      ts.forEach((t) => { taskPri[t.priority] = (taskPri[t.priority] || 0) + 1; taskStatus[t.status] = (taskStatus[t.status] || 0) + 1; });
      return {
        totalProjects: ps.length, activeProjects: ps.filter((p) => p.status === '进行中').length, totalCases,
        totalTasks: ts.length, openTasks: ts.filter((t) => t.status !== '已完成').length,
        byStatus, byCause, taskPri, taskStatus
      };
    },

    /* == 导出 / 导入 == */
    exportJSON() { return JSON.stringify(DB, null, 2); },
    exportCSV(table) {
      const esc = (v) => { const s = v == null ? '' : ('' + v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      let rows, headers;
      if (table === 'projects') { headers = ['项目名称', '项目类别', '状态', '委托方(当事人)', '对方当事人', '案号', '代理律师', '债权持有人(多项)', '合同名称', '合同编号', '案由', '签约时间', '律师费', '付款情况', '提取情况', '转付时间', '转付金额', '查封与保全(多项:类型/名称/起算→截止/续封最迟)', '查封最早截止日', '开庭日期', '合同到期日', '查封到期提醒日', '标签']; rows = DB.projects.map((p) => [p.name, p.category || '其他类', p.status, p.party, p.opponent, p.caseNo, p.agentLawyer || '', creditorSummary(p.creditors), p.contractName, p.contractNo, p.cause, p.signDate, p.fee || '', p.feePayment, p.feeExtraction, p.transferTime, p.transferAmount, seizureSummary(p.seizures), seizureEarliest(p.seizures), (p.hearingDate || '').slice(0, 10), (p.contractExpiryDate || '').slice(0, 10), (p.renewalDate || '').slice(0, 10), (p.tags || []).join('|')]); }
      else if (table === 'tasks') { headers = ['标题', '截止日期', '关联项目', '状态']; rows = DB.tasks.map((t) => [t.title, (t.dueDate || '').slice(0, 10), (store.getProject(t.projectId) || {}).name || '', t.status]); }
      else if (table === 'cases') { headers = ['所属项目', '案件名称', '案件类别', '状态', '当事人', '对方当事人', '案号', '代理律师', '债权持有人(多项)', '合同名称', '合同编号', '案由', '签约时间', '律师费', '付款情况', '提取情况', '转付时间', '转付金额', '查封与保全(多项:类型/名称/起算→截止/续封最迟)', '查封最早截止日', '开庭日期', '合同到期日', '查封到期提醒日', '标签']; rows = DB.projects.flatMap((p) => (p.cases || []).map((c) => [p.name, c.name, c.category || '其他类', c.status, c.party, c.opponent, c.caseNo, c.agentLawyer || '', creditorSummary(c.creditors), c.contractName, c.contractNo, c.cause, c.signDate, c.fee || '', c.feePayment, c.feeExtraction, c.transferTime, c.transferAmount, seizureSummary(c.seizures), seizureEarliest(c.seizures), (c.hearingDate || '').slice(0, 10), (c.contractExpiryDate || '').slice(0, 10), (c.renewalDate || '').slice(0, 10), (c.tags || []).join('|')])); }
      else if (table === 'clients') { headers = ['对接人', '所属项目', '所属公司', '联系方式', '地址', '沟通记录数']; rows = DB.clients.map((c) => [c.name, c.project, c.company, c.contact, c.address, (c.records || []).length]); }
      else if (table === 'judges') { headers = ['经办人', '所属案件', '法院', '联系方式', '地址', '沟通记录数']; rows = DB.judges.map((j) => [j.name, j.case, j.court, j.contact, j.address, (j.records || []).length]); }
      else { return ''; }
      return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed.projects) throw new Error('无效的数据文件');
      parsed.clients = parsed.clients || []; parsed.judges = parsed.judges || [];
      parsed.events = Array.isArray(parsed.events) ? parsed.events : []; parsed.events.forEach((e) => { if (e.done === undefined) e.done = false; });
      const cur = (parsed.meta && parsed.meta.currentUser) || '我';
      parsed.projects.forEach((p) => { if (!Array.isArray(p.cases)) p.cases = []; if (!Array.isArray(p.doneEvents)) p.doneEvents = []; migrateNotes(p, cur); migrateFee(p); migrateSeizures(p); migrateCreditors(p); migrateAgent(p); (p.cases || []).forEach((c) => { migrateNotes(c, cur); migrateFee(c); migrateSeizures(c); migrateCreditors(c); migrateAgent(c); if (!Array.isArray(c.doneEvents)) c.doneEvents = []; }); });
      DB = parsed; persist();
      audit('导入数据', '从备份恢复');
      return true;
    },
    resetDemo() { DB = seed(); persist(); audit('重置', '恢复示范数据'); },
    /* 解锁后：把缓存的原文（密文 v1: / 旧明文 / 空）还原为 DB 并跑迁移；空则种入示范数据 */
    unsealLoad: async function () {
      const V = LB.vault;
      if (!V || !V.key) return DB;
      const raw = (V.pendingRaw != null) ? V.pendingRaw : global.localStorage.getItem(DB_KEY);
      let db;
      if (raw && ('' + raw).indexOf('v1:') === 0) db = await V.unseal(raw);
      else if (raw && ('' + raw).charAt(0) === '{') db = JSON.parse(raw); // 旧明文（加密前）迁移
      else db = seed();
      db.clients = db.clients || []; db.judges = db.judges || [];
      db.events = Array.isArray(db.events) ? db.events : []; db.events.forEach((e) => { if (e.done === undefined) e.done = false; });
      const cur = (db.meta && db.meta.currentUser) || '我';
      (db.projects || []).forEach((p) => { if (!Array.isArray(p.cases)) p.cases = []; if (!Array.isArray(p.doneEvents)) p.doneEvents = []; migrateNotes(p, cur); migrateFee(p); migrateSeizures(p); migrateCreditors(p); migrateAgent(p); (p.cases || []).forEach((c) => { migrateNotes(c, cur); migrateFee(c); migrateSeizures(c); migrateCreditors(c); migrateAgent(c); if (!Array.isArray(c.doneEvents)) c.doneEvents = []; }); });
      DB = db;
      return DB;
    },
    /* 当前 DB 的密文字符串（用于推送后端）；未解锁返回 null */
    sealedRaw: async function () {
      if (LB.vault && LB.vault.enabled && LB.vault.isUnlocked() && LB.vault.key) return await LB.vault.seal(DB);
      return null;
    }
  };

  LB.store = store;
  LB.util = Object.assign(LB.util || {}, { uid, now, iso, todayStr, computeSeizureEnd, addMonthsISO, SEIZURE_PERIODS, SEIZURE_TYPES: Object.keys(SEIZURE_PERIODS) });
})(window);
