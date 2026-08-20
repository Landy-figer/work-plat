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

  /* 判断 isoStr 是否在 today 起 d 天内（含今天，不含过去），用于提醒窗口计算
   * 提取为共享函数，避免 scheduleReminders / taskReminders 中各自内联一份重复实现 */
  function within(isoStr, d) {
    if (!isoStr) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const x = new Date(isoStr); x.setHours(0, 0, 0, 0);
    const diff = (x - today) / 86400000;
    return diff >= 0 && diff <= d;
  }

  /* 保险库锁定时使用的空壳，避免用任何数据覆盖未解密的原文 */
  function emptyDb() {
    return { projects: [], tasks: [], clients: [], judges: [], events: [], audit: [], meta: { lastSync: null, currentUser: '我' } };
  }

  /* 防御性归一化：统一在 load / importJSON / unsealLoad 中调用，确保数组字段完整 */
  function normalizeProjects(projects) {
    (projects || []).forEach((p) => {
      ['cases', 'notes', 'seizures', 'doneEvents'].forEach((k) => { if (!Array.isArray(p[k])) p[k] = []; });
      if (p.customValues == null) p.customValues = {};
      if (p.sectionCfg == null) p.sectionCfg = { hidden: [], renamed: {}, added: [], addedFields: {}, removedFields: {} };
      // 兼容旧版 customModules：迁移进新的 sectionCfg.added（动态板块体系）
      if (!Array.isArray(p.customModules)) p.customModules = [];
      if (p.customModules.length && !p.sectionCfg._migrated) {
        p.sectionCfg.added = p.sectionCfg.added || [];
        p.customValues = p.customValues || {};
        p.customModules.forEach((m) => {
          const secId = 'sec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          const fields = (m.fields || []).map((f) => {
            const fid = f.id || ('cf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
            p.customValues[fid] = f.value || '';
            return { id: fid, label: f.label, type: f.type || 'text' };
          });
          p.sectionCfg.added.push({ id: secId, section: m.section, fields });
        });
        p.customModules = [];
        p.sectionCfg._migrated = true;
      }
      (p.cases || []).forEach((c) => {
        ['notes', 'doneEvents', 'seizures', 'progress'].forEach((k) => { if (!Array.isArray(c[k])) c[k] = []; });
        if (c.customValues == null) c.customValues = {};
        if (c.sectionCfg == null) c.sectionCfg = { hidden: [], renamed: {}, added: [], addedFields: {}, removedFields: {} };
      });
    });
  }

  /* 防御性归一化：统一在 load / importJSON / unsealLoad 中调用，确保 events 数组完整 */
  function normalizeEvents(events) {
    (Array.isArray(events) ? events : []).forEach((e) => { if (e.done === undefined) e.done = false; });
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
          parsed.clients = parsed.clients || [];
          parsed.judges = parsed.judges || [];
          parsed.events = Array.isArray(parsed.events) ? parsed.events : [];
          delete parsed.lawItems;
          normalizeEvents(parsed.events);
          normalizeProjects(parsed.projects);
          return parsed;
        }
      }
    } catch (e) { /* ignore */ }
    if (vaultOn) return emptyDb();
    const s = emptyDb();
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
              if (LB.vault.isUnlocked() && LB.vault.key) {
                DB = await LB.vault.unseal(raw);
                DB.meta.lastSync = new Date().toISOString();
                if (LB.onSync) LB.onSync();
              }
            } else {
              DB = JSON.parse(raw);
              DB.meta.lastSync = new Date().toISOString();
              if (LB.onSync) LB.onSync();
            }
          }
        } catch (e) {}
      }
    };
  }

  /* DB 在文件末尾（所有 const 与辅助函数声明完成后）统一初始化，避免 SEIZURE_PERIODS 等常量在 TDZ 中被提前引用 */

  /* ---------- 审计日志 ---------- */
  function audit(action, detail, user) {
    DB.audit.unshift({ id: uid('aud'), ts: new Date().toISOString(), user: user || DB.meta.currentUser, action, detail });
    if (DB.audit.length > 500) DB.audit.length = 500;
    persist();
  }

  /* ---------- 通用 CRUD ---------- */
  function find(arr, id) { return arr.find((x) => x.id === id); }


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

  /* 至此计算辅助函数均已声明完成，可安全调用 load() */
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
    /* 下拉选项：大项目 + 「大项目 › 子项目」(关联案件)，value 统一为可读标签字符串，
     * 与现有保存"所属项目/所属案件"为自由文本的做法保持一致；子项目用 › 分隔可识别层级。 */
    projectCaseOptions() {
      const out = [];
      DB.projects.forEach((p) => {
        out.push({ id: p.id, label: p.name || '未命名项目', isCase: false });
        (p.cases || []).forEach((c) => {
          out.push({ id: p.id + '|' + c.id, label: (p.name || '未命名项目') + ' › ' + (c.name || '未命名案件'), isCase: true, projectId: p.id, caseId: c.id });
        });
      });
      return out;
    },
    saveProject(p, isNew) {
      p.cases = Array.isArray(p.cases) ? p.cases : [];
      if (isNew) {
        p.id = uid('prj'); p.createdAt = new Date().toISOString();
        p.progress = p.progress || []; p.notes = p.notes || [];
        DB.projects.push(p); audit('新建项目', p.name);
      } else {
        const o = find(DB.projects, p.id); if (!o) return;
        Object.assign(o, p); DB.projects[DB.projects.indexOf(o)] = o; audit('更新项目', p.name);
      }
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
      if (isNew) {
        c.id = uid('cse'); c.createdAt = new Date().toISOString();
        c.progress = c.progress || []; c.notes = c.notes || [];
        p.cases.push(c); audit('新建关联案件', p.name + ' / ' + (c.name || '未命名案件'));
      } else {
        const o = p.cases.find((x) => x.id === c.id); if (!o) return null;
        Object.assign(o, c); p.cases[p.cases.indexOf(o)] = o;
        audit('更新关联案件', p.name + ' / ' + (c.name || '未命名案件'));
      }
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      persist();
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
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      audit('新增案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + note.content.slice(0, 20));
      persist();
    },
    deleteCaseProgress(projectId, caseId, idx) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.progress) return;
      const d = c.progress[idx]; if (!d) return;
      c.progress.splice(idx, 1);
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      audit('删除案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + (d.content || '').slice(0, 20));
      persist();
    },
    updateCaseProgress(projectId, caseId, idx, note) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.progress) return;
      const d = c.progress[idx]; if (!d) return;
      if (note.content != null) d.content = note.content;
      if (note.date) d.date = note.date;
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      audit('更新案件进展', p.name + ' / ' + (c.name || '未命名案件') + '：' + (note.content || '').slice(0, 20));
      persist();
    },
    addCaseNote(projectId, caseId, note) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c) return;
      c.notes = c.notes || [];
      c.notes.unshift({ recipient: note.recipient || '', content: note.content || '', archiveLocation: note.archiveLocation || '', archiveCabinet: note.archiveCabinet || '', author: note.author || DB.meta.currentUser, date: note.date || todayStr() });
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      audit('新增案件备注', p.name + ' / ' + (c.name || '未命名案件'));
      persist();
    },
    deleteCaseNote(projectId, caseId, idx) {
      const p = find(DB.projects, projectId); if (!p || !p.cases) return;
      const c = p.cases.find((x) => x.id === caseId); if (!c || !c.notes) return;
      const d = c.notes[idx]; if (!d) return;
      c.notes.splice(idx, 1);
      c.updatedAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      audit('删除案件备注', p.name + ' / ' + (c.name || '未命名案件'));
      persist();
    },

    /* == 任务 == */
    listTasks() { return DB.tasks.slice(); },
    getTask(id) { return find(DB.tasks, id); },
    saveTask(t, isNew) {
      if (isNew) {
        t.id = uid('tsk'); t.createdAt = new Date().toISOString();
        t.history = [{ date: new Date().toISOString(), from: '—', to: t.status || '待办', by: DB.meta.currentUser }];
        DB.tasks.push(t); audit('新建任务', t.title);
      } else {
        const o = find(DB.tasks, t.id); if (!o) return;
        Object.assign(o, t); audit('更新任务', t.title);
      }
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
    deleteTask(id) {
      const o = find(DB.tasks, id); if (!o) return;
      DB.tasks = DB.tasks.filter((x) => x.id !== id);
      audit('删除任务', o.title);
      persist();
    },

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
      o.records.unshift({ date: rec.date || todayStr(), content: rec.content, note: rec.note || '', by: rec.by || DB.meta.currentUser });
      audit('客户沟通记录', o.name);
      persist();
    },
    deleteClient(id) {
      const o = find(DB.clients, id); if (!o) return;
      DB.clients = DB.clients.filter((x) => x.id !== id);
      audit('删除客户', o.name);
      persist();
    },

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
      o.records.unshift({ date: rec.date || todayStr(), content: rec.content, note: rec.note || '', by: rec.by || DB.meta.currentUser });
      audit('法官沟通记录', o.name);
      persist();
    },
    deleteJudge(id) {
      const o = find(DB.judges, id); if (!o) return;
      DB.judges = DB.judges.filter((x) => x.id !== id);
      audit('删除经办法官', o.name);
      persist();
    },

    /* == 审计（仅保留数据层，UI 入口已移除） == */

    /* == 日程事件（手动事件存入 DB.events，与项目/案件日期派生的日程共用"已完成"语义） == */
    listManualEvents() { return DB.events; },
    getManualEvent(id) { return DB.events.find((x) => x.id === id) || null; },
    saveManualEvent(e, isNew) {
      // 编辑：传入已存在 id 时按 id 原地更新（保留创建时间等历史字段）
      if (e.id) {
        const idx = DB.events.findIndex((x) => x.id === e.id);
        if (idx >= 0) { DB.events[idx] = Object.assign({}, DB.events[idx], e); audit('更新日程', e.title); persist(); return DB.events[idx]; }
      }
      if (isNew) e.id = uid('evt');
      if (e.done === undefined) e.done = false;
      DB.events.push(e);
      audit('新增日程', e.title);
      persist();
      return e;
    },
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
      const live = out.filter((r) => !this.isScheduleDone(r));
      live.sort((a, b) => new Date(a.date) - new Date(b.date));
      return live;
    },

    /* 任务提醒：仅来源于任务截止（3 天内），不含任何日程项 */
    taskReminders() {
      const out = [];
      DB.tasks.forEach((t) => {
        if (t.status === '已完成') return;
        if (within(t.dueDate, 3)) {
          out.push({ level: t.status === '待审阅' ? '高' : '中', type: '任务截止', project: (store.getProject(t.projectId) || {}).name || '—', date: t.dueDate, taskId: t.id });
        }
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
      ps.forEach((p) => {
        byStatus[p.status] = (byStatus[p.status] || 0) + 1;
        byCause[p.cause] = (byCause[p.cause] || 0) + 1;
        totalCases += (Array.isArray(p.cases) ? p.cases.length : 0);
      });
      const taskPri = { 高: 0, 中: 0, 低: 0 };
      const taskStatus = { 待办: 0, 待审阅: 0, 已完成: 0 };
      ts.forEach((t) => {
        taskPri[t.priority] = (taskPri[t.priority] || 0) + 1;
        taskStatus[t.status] = (taskStatus[t.status] || 0) + 1;
      });
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
      if (table === 'projects') {
        headers = ['项目名称', '项目类别', '状态', '委托方(当事人)', '对方当事人', '案号', '诉讼标的', '代理律师', '债权持有人(多项)', '合同名称', '合同编号', '案由', '签约时间', '律师费', '付款情况', '提取情况', '转付时间', '转付金额', '查封与保全(多项:类型/名称/起算→截止/续封最迟)', '查封最早截止日', '开庭日期', '合同到期日', '查封到期提醒日', '标签'];
        rows = DB.projects.map((p) => [p.name, p.category || '其他类', p.status, p.party, p.opponent, p.caseNo, p.litigSubject || '', p.agentLawyer || '', creditorSummary(p.creditors), p.contractName, p.contractNo, p.cause, p.signDate, p.fee || '', p.feePayment, p.feeExtraction, p.transferTime, p.transferAmount, seizureSummary(p.seizures), seizureEarliest(p.seizures), (p.hearingDate || '').slice(0, 10), (p.contractExpiryDate || '').slice(0, 10), (p.renewalDate || '').slice(0, 10), (p.tags || []).join('|')]);
      } else if (table === 'tasks') {
        headers = ['标题', '截止日期', '关联项目', '状态'];
        rows = DB.tasks.map((t) => [t.title, (t.dueDate || '').slice(0, 10), (store.getProject(t.projectId) || {}).name || '', t.status]);
      } else if (table === 'cases') {
        headers = ['所属项目', '案件名称', '案件类别', '状态', '当事人', '对方当事人', '案号', '代理律师', '债权持有人(多项)', '合同名称', '合同编号', '案由', '签约时间', '律师费', '付款情况', '提取情况', '转付时间', '转付金额', '查封与保全(多项:类型/名称/起算→截止/续封最迟)', '查封最早截止日', '开庭日期', '合同到期日', '查封到期提醒日', '标签'];
        rows = DB.projects.flatMap((p) => (p.cases || []).map((c) => [p.name, c.name, c.category || '其他类', c.status, c.party, c.opponent, c.caseNo, c.agentLawyer || '', creditorSummary(c.creditors), c.contractName, c.contractNo, c.cause, c.signDate, c.fee || '', c.feePayment, c.feeExtraction, c.transferTime, c.transferAmount, seizureSummary(c.seizures), seizureEarliest(c.seizures), (c.hearingDate || '').slice(0, 10), (c.contractExpiryDate || '').slice(0, 10), (c.renewalDate || '').slice(0, 10), (c.tags || []).join('|')]));
      } else if (table === 'clients') {
        headers = ['对接人', '所属项目', '所属公司', '联系方式', '地址', '沟通记录数'];
        rows = DB.clients.map((c) => [c.name, c.project, c.company, c.contact, c.address, (c.records || []).length]);
      } else if (table === 'judges') {
        headers = ['经办人', '职务', '所属案件', '法院', '联系方式', '地址', '沟通记录数'];
        rows = DB.judges.map((j) => [j.name, j.role || '', j.case, j.court, j.contact, j.address, (j.records || []).length]);
      } else {
        return '';
      }
      return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed.projects) throw new Error('无效的数据文件');
      parsed.clients = parsed.clients || [];
      parsed.judges = parsed.judges || [];
      parsed.events = Array.isArray(parsed.events) ? parsed.events : [];
      delete parsed.lawItems;
      normalizeEvents(parsed.events);
      normalizeProjects(parsed.projects);
      DB = parsed;
      persist();
      audit('导入数据', '从备份恢复');
      return true;
    },
    resetDemo() { DB = emptyDb(); persist(); audit('重置', '清空数据'); },
    /* 解锁后：把缓存的原文（密文 v1: / 旧明文 / 空）还原为 DB 并跑归一化；空则建立空库 */
    unsealLoad: async function () {
      const V = LB.vault;
      if (!V || !V.key) return DB;
      const raw = (V.pendingRaw != null) ? V.pendingRaw : global.localStorage.getItem(DB_KEY);
      let db;
      if (raw && ('' + raw).indexOf('v1:') === 0) db = await V.unseal(raw);
      else if (raw && ('' + raw).charAt(0) === '{') db = JSON.parse(raw); // 旧明文（加密前）迁移
      else db = emptyDb();
      db.clients = db.clients || [];
      db.judges = db.judges || [];
      db.events = Array.isArray(db.events) ? db.events : [];
      normalizeEvents(db.events);
      normalizeProjects(db.projects || []);
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
  LB.util = Object.assign(LB.util || {}, { uid, now, iso, todayStr, within, computeSeizureEnd, addMonthsISO, SEIZURE_PERIODS, SEIZURE_TYPES: Object.keys(SEIZURE_PERIODS) });
})(window);
