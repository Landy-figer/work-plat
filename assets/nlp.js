/* =====================================================================
 * Legal Workbench — 智能汇报自然语言解析 (nlp.js)
 * 轻量中文启发式解析：识别日期、归属项目/建项目、进展、任务、关键节点
 * ===================================================================== */
(function (global) {
  'use strict';
  const LB = (global.LB = global.LB || {});

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  // ---- 日期解析 ----
  function parseDate(text, base) {
    base = base ? startOfDay(base) : startOfDay(new Date());
    const y = base.getFullYear();
    let m;

    // 今天/明天/后天/大后天/昨天
    if (/(今\s*天)/.test(text)) return base;
    if (/(明\s*天)/.test(text)) { const d = new Date(base); d.setDate(d.getDate() + 1); return d; }
    if (/(后\s*天)/.test(text)) { const d = new Date(base); d.setDate(d.getDate() + 2); return d; }
    if (/(大\s*后\s*天)/.test(text)) { const d = new Date(base); d.setDate(d.getDate() + 3); return d; }
    if (/(昨\s*天)/.test(text)) { const d = new Date(base); d.setDate(d.getDate() - 1); return d; }

    // YYYY-MM-DD / YYYY/MM/DD
    let mm = text.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (mm) return new Date(+mm[1], +mm[2] - 1, +mm[3]);

    // M月D日 / M月D
    mm = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (mm) { const d = new Date(y, +mm[1] - 1, +mm[2]); if (d < base) d.setFullYear(y + 1); return d; }

    // M/D
    mm = text.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/);
    if (mm) { const d = new Date(y, +mm[1] - 1, +mm[2]); if (d < base) d.setFullYear(y + 1); return d; }

    // 下周一..日 / 周X / 星期X
    const wmap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    let wm = text.match(/下\s*周\s*([一二三四五六日天])/) || text.match(/下\s*星期\s*([一二三四五六日天])/);
    let target = wm ? wmap[wm[1]] : null;
    if (target == null) {
      wm = text.match(/周\s*([一二三四五六日天])/) || text.match(/星期\s*([一二三四五六日天])/);
      target = wm ? wmap[wm[1]] : null;
    }
    if (target != null) {
      const cur = base.getDay();
      let diff = (target - cur + 7) % 7;
      if (wm && /下/.test(text)) diff += 7;
      if (diff === 0) diff = 7;
      const d = new Date(base); d.setDate(d.getDate() + diff); return d;
    }
    return null;
  }

  // ---- 主解析 ----
  function parse(text) {
    const store = LB.store;
    const base = new Date();
    const result = { raw: text, date: parseDate(text, base), matchedProject: null, createProject: null, progress: null, tasks: [], nodes: [], completedTask: null, summary: [] };

    // 1) 创建新项目触发（优先于归属已有项目）
    const createTrig = /(新建|创建|新立|立项|新增项目|开[个一]?新?项目)/;
    if (createTrig.test(text)) {
      let name = text.replace(createTrig, '').replace(/[，。；;.\n].*$/s, '').trim();
      name = name.replace(/^(项目|案件|的)/, '').trim() || ('新建项目 ' + new Date().toLocaleDateString());
      // 从正文中抽取台账关键字段
      const ex = (kw) => { const inner = kw.replace(/[()]/g, ''); const m = text.match(new RegExp('(?:' + inner + ')([^，。；；]+)')); return m ? m[1].trim() : null; };
      result.createProject = {
        name, status: '进行中', tags: [],
        creditor: ex('(债权持有人|委托人|客户)'),
        opponent: ex('(对方当事人|对方)'),
        cause: ex('案由')
      };
      result.summary.push('将创建新项目：' + name + (result.createProject.creditor ? '（债权人 ' + result.createProject.creditor + '）' : ''));
    } else {
      // 2) 归属已有项目（全称包含 或 输入为项目名片段，取最长匹配）
      const projects = store.listProjects();
      const q = text.replace(/\s/g, '');
      let best = null;
      projects.forEach((p) => {
        if (!p.name) return;
        const hit = text.indexOf(p.name) >= 0 || (p.name.indexOf(q) >= 0 && q.length >= 3);
        if (hit && (!best || p.name.length > best.name.length)) best = p;
      });
      if (best) { result.matchedProject = best.id; result.summary.push('关联到项目：' + best.name); }
    }
    const best = result.matchedProject ? store.getProject(result.matchedProject) : null;

    // 3) 关键节点（开庭 / 合同到期 / 续费）
    if (/开庭/.test(text) && result.date) { result.nodes.push({ field: 'hearingDate', label: '开庭日期', date: result.date }); result.summary.push('设置开庭日期：' + fmt(result.date)); }
    if (/(合同到期|到期)/.test(text) && result.date) { result.nodes.push({ field: 'contractExpiryDate', label: '合同到期', date: result.date }); result.summary.push('设置合同到期：' + fmt(result.date)); }
    if (/(续费|续展|缴费)/.test(text) && result.date) { result.nodes.push({ field: 'renewalDate', label: '续费提醒', date: result.date }); result.summary.push('设置续费提醒：' + fmt(result.date)); }

    // 4) 进展记录（需为动词性用法：后接冒号/逗号/了，避免误伤“进展报告”等名词）
    const progTrig = /(进展|进度|汇报|沟通|情况|补充|说明|备注)[：:，了]/;
    let progressText = null, progressAlready = false;
    if (progTrig.test(text)) {
      // 整句作为进展备注，仅当项目名为句首时去掉该前缀，保留用户原话（避免误切到“沟通”等触发词）
      progressText = (best && best.name && text.indexOf(best.name) === 0)
        ? text.slice(best.name.length).trim()
        : text.trim();
    }
    // 4.5) 已完成事件 / 周期性进展（本周已…本月已…上周已…已提交/已收到/已立案…）
    const DONE = /(本周已|本月已|上周已|已提交|已收到|已立案|已签署|已签订|已缴费|已付款|已开庭|已判决|已裁决|已送达|已寄送|已邮寄|已沟通|已联系|已回复|已处理|已交接|已归档|已结案|已划转)/;
    if (DONE.test(text)) {
      const period = /本周已/.test(text) ? '本周' : /本月已/.test(text) ? '本月' : /上周已/.test(text) ? '上周' : '';
      if (!progressText) progressText = text.trim();
      result.summary.push('记录进展' + (period ? '（' + period + '）' : '') + '：' + text.trim().slice(0, 20) + (text.trim().length > 20 ? '…' : ''));
      progressAlready = true;
    }

    // 5) 完成任务
    if (/(完成|已结|结案|搞定)/.test(text)) {
      const open = store.listTasks().filter((t) => t.status !== '已完成');
      let hit = open.find((t) => text.indexOf(t.title) >= 0);
      if (!hit) { // 取首个开放任务匹配关键词片段
        const frag = text.replace(/(完成|已结|结案|搞定|了|的|今日|今天|明天)/g, '');
        hit = open.find((t) => t.title && (frag.indexOf(t.title.slice(0, 4)) >= 0 || t.title.indexOf(frag.slice(0, 4)) >= 0));
      }
      if (hit) { result.completedTask = hit.id; result.summary.push('标记任务完成：' + hit.title); }
    }

    // 5.5) 待办 / 法院事项（待法院…待提交…待执行…）
    const pendingTrig = /待(法院|提交|立案|开庭|缴费|付款|签署|签订|寄送|送达|沟通|联系|回复|质证|执行|裁决|判决|复核|审核|审批|处理|跟进)/;
    if (pendingTrig.test(text) && !result.completedTask && !result.createProject) {
      const pm = text.match(pendingTrig);
      const idx = text.indexOf(pm[0]);
      let pt = text.slice(idx + pm[0].length);                       // 仅取触发词之后的动作片段
      pt = cleanTask(pt, best && best.name).replace(/^[，,、的\s]+/, '').replace(/(前|后)$/, '').trim();
      const isCourt = pm[0].indexOf('法院') >= 0;
      const verb = pm[0].slice(1);                                   // 提交 / 法院 / 立案 …
      const title = (isCourt ? '法院' : verb) + (pt || '办事项');
      result.tasks.push({ title, dueDate: result.date ? result.date.toISOString() : null, priority: (isCourt || /紧急|重要|高/.test(text)) ? '高' : '中', kind: isCourt ? 'court' : 'pending' });
      result.summary.push('创建待办：' + title + (result.date ? '（截止 ' + fmt(result.date) + '）' : ''));
    }
    // 6) 待办任务（需含任务动词，且存在日期或明确的"待办/任务/提醒我"标签，避免把纯进展误判为任务）
    const hasTaskLabel = /(待办|任务|提醒我)/.test(text);
    if (!result.completedTask && !progressText && !result.tasks.length && TASK_VERBS.test(text) && (result.date || hasTaskLabel)) {
      const title = cleanTask(text, best && best.name);
      if (title && title.length >= 2) {
        result.tasks.push({ title, dueDate: result.date ? result.date.toISOString() : null, priority: /紧急|重要|高/.test(text) ? '高' : '中' });
        result.summary.push('创建任务：' + title + (result.date ? '（截止 ' + fmt(result.date) + '）' : ''));
      }
    }

    // 7) 进展正文兜底（新建项目时不再重复记录为进展）
    if (!progressText && !result.tasks.length && !result.nodes.length && !result.completedTask && !result.createProject) {
      progressText = text.trim();
    }
    if (progressText) { result.progress = progressText; if (!progressAlready) result.summary.push('记录进展：' + progressText.slice(0, 22) + (progressText.length > 22 ? '…' : '')); }

    if (!result.summary.length) result.summary.push('未识别到可执行操作，已作为进展备注记录。');
    return result;
  }

  function fmt(d) { if (!(d instanceof Date)) d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function stripDate(s) {
    return s
      .replace(/(今\s*天|明\s*天|后\s*天|大\s*后\s*天|昨\s*天)/g, '')
      .replace(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/g, '')
      .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, '')
      .replace(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g, '')
      .replace(/(下?\s*周\s*[一二三四五六日天]|下?\s*星期\s*[一二三四五六日天])/g, '');
  }
  const TASK_LABELS = '待办|任务|提醒我|安排|需要|拟写|撰写|起草|进度|进展|汇报|沟通|情况|补充|说明|备注';
  const TASK_VERBS = /(待办|任务|提醒我|安排|需要|拟写|拟定|拟|撰写|准备|提交|起草|计划|预计|跟进)/;
  function cleanTask(text, projName) {
    let s = text;
    s = s.replace(new RegExp('(' + TASK_LABELS + ')[：:，]?', 'g'), '');
    s = stripDate(s);
    s = s.replace(/(开庭|合同到期|到期|续费|续展|缴费)[：:，]?/g, '');
    s = s.replace(/[，。；;、]/g, ' ');
    if (projName && s.indexOf(projName) === 0) s = s.slice(projName.length);
    s = s.replace(/^(今天|今日|明天|后天)[的]?/, '').trim();
    s = s.split(/\s+/).filter(Boolean).join(' ').trim();
    return s.slice(0, 30);
  }

  // ---- 应用解析结果到数据层 ----
  function apply(parsed) {
    const store = LB.store;
    let pid = parsed.matchedProject;
    if (!pid && parsed.createProject) {
      const p = store.saveProject(Object.assign({ manager: store.meta().currentUser, progress: [] }, parsed.createProject), true);
      pid = p.id;
    }
    if (pid) {
      parsed.nodes.forEach((n) => { const p = store.getProject(pid); if (p) { p[n.field] = (n.date instanceof Date ? n.date : new Date(n.date)).toISOString(); store.saveProject(p, false); } });
      if (parsed.progress) store.addProgress(pid, { content: parsed.progress });
    }
    parsed.tasks.forEach((t) => store.saveTask({ title: t.title, dueDate: t.dueDate, priority: t.priority, projectId: pid, status: '待办' }, true));
    if (parsed.completedTask) store.setTaskStatus(parsed.completedTask, '已完成');
    return parsed;
  }

  LB.nlp = { parse, apply, parseDate, fmt };
})(window);
