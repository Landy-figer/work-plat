/* =====================================================================
 * WORK-Plat — 后端服务（真实 SQLite 数据库）
 * 提供：同步全量数据快照 + 导出前二次校验
 * 依赖：Node 22 内置 node:sqlite（无需 npm install）
 * 启动：node server/index.js   （端口 8200，可用 PORT 环境变量覆盖）
 * ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8200;
const DB_PATH = path.join(__dirname, 'workplat.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );
`);

/* ---------- 工具 ---------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v.length <= 10 ? v + 'T00:00:00' : v);
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- 二次校验规则 ---------- */
const PROJ_STATUS = ['进行中', '已暂停', '已完成', '已结案'];
const TASK_STATUS = ['待办', '待审阅', '已完成'];
const PRIORITY = ['高', '中', '低'];

function validate(payload, canonicalProjects) {
  const issues = [];
  const projects = payload.projects || [];
  const tasks = payload.tasks || [];
  const clients = payload.clients || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const canonIds = new Set((canonicalProjects || []).map((p) => p.id));
  const payloadIds = new Set(projects.map((p) => p.id));
  const seenNames = {};

  projects.forEach((p, i) => {
    const ref = '项目#' + (i + 1) + (p.name ? '「' + p.name + '」' : '');
    if (!p.name || !('' + p.name).trim()) issues.push({ level: 'error', msg: ref + '：缺少项目名称' });
    if (p.status && !PROJ_STATUS.includes(p.status)) issues.push({ level: 'warn', msg: ref + '：状态「' + p.status + '」不在标准枚举内' });
    const s = parseDate(p.seizureStart), e = parseDate(p.seizureEnd);
    if (s && e && e < s) issues.push({ level: 'error', msg: ref + '：查封截止日(' + p.seizureEnd + ')早于起算日(' + p.seizureStart + ')' });
    const ce = parseDate(p.contractExpiryDate);
    if (ce && ce < today) issues.push({ level: 'warn', msg: ref + '：合同到期日(' + p.contractExpiryDate + ')已过去' });
    const nm = ('' + (p.name || '')).trim();
    if (nm) { if (seenNames[nm]) issues.push({ level: 'warn', msg: '重复项目名称：「' + nm + '」' }); seenNames[nm] = true; }
  });

  tasks.forEach((t, i) => {
    const ref = '任务#' + (i + 1) + (t.title ? '「' + t.title + '」' : '');
    if (!t.title || !('' + t.title).trim()) issues.push({ level: 'error', msg: ref + '：缺少任务标题' });
    if (t.status && !TASK_STATUS.includes(t.status)) issues.push({ level: 'warn', msg: ref + '：状态「' + t.status + '」不在标准枚举内' });
    if (t.priority && !PRIORITY.includes(t.priority)) issues.push({ level: 'warn', msg: ref + '：优先级「' + t.priority + '」不在标准枚举内' });
    if (t.dueDate && !parseDate(t.dueDate)) issues.push({ level: 'warn', msg: ref + '：截止日期格式无法解析(' + t.dueDate + ')' });
    if (t.projectId) {
      if (!payloadIds.has(t.projectId) && !canonIds.has(t.projectId))
        issues.push({ level: 'error', msg: ref + '：关联项目不存在（孤儿任务，projectId=' + t.projectId + '）' });
    } else if (t.title && ('' + t.title).trim()) {
      issues.push({ level: 'info', msg: ref + '：未关联任何项目' });
    }
  });

  clients.forEach((c, i) => {
    const ref = '客户#' + (i + 1);
    if (!c.name || !('' + c.name).trim()) issues.push({ level: 'error', msg: ref + '：缺少客户名称' });
  });

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    counts: { projects: projects.length, tasks: tasks.length, clients: clients.length },
    issues
  };
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const row = db.prepare('SELECT COUNT(*) AS c FROM snapshots').get();
      return send(res, 200, { ok: true, db: 'sqlite', snapshots: row ? row.c : 0 });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync') {
      const body = await readBody(req);
      const at = new Date().toISOString();
      db.prepare('INSERT INTO snapshots (kind, payload, saved_at) VALUES (?, ?, ?)').run('full', JSON.stringify(body.db || body), at);
      const dbObj = body.db || {};
      return send(res, 200, {
        ok: true, savedAt: at,
        counts: {
          projects: (dbObj.projects || []).length,
          tasks: (dbObj.tasks || []).length,
          clients: (dbObj.clients || []).length
        }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const body = await readBody(req);
      const last = db.prepare('SELECT payload FROM snapshots ORDER BY id DESC LIMIT 1').get();
      let canonicalProjects = [];
      if (last && last.payload) { try { canonicalProjects = (JSON.parse(last.payload).projects) || []; } catch (e) {} }
      const result = validate(body, canonicalProjects);
      if (result.issues.some((x) => x.level === 'error')) result.ok = false;
      return send(res, 200, result);
    }
    send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log('[WORK-Plat backend] SQLite @ ' + DB_PATH);
  console.log('[WORK-Plat backend] listening on http://localhost:' + PORT);
});
