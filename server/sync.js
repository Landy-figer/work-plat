/* =====================================================================
 * WORK-Plat — 本地同步服务（一体化）
 * 1) 托管前端 SPA（http://localhost:8200）
 * 2) /api/load  /api/save ：把 DB 镜像到 D:\workbuddy\workplat数据存储\workplat.db.json
 *    并在保存时加密推送至私有云仓库（双向同步，最后写入者胜出）
 * 3) /api/validate ：复用既有二次校验规则
 * 依赖：Node 22 内置 node:sqlite + crypto + child_process（无需 npm install）
 * 启动：node server/sync.js   （端口可用 PORT 环境变量覆盖）
 * ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = 'D:\\workbuddy\\workplat数据存储';
const DATA_FILE = path.join(DATA_DIR, 'workplat.db.json');
const CONFIG_PATH = path.join(__dirname, '.sync-config.json');
const PORT = process.env.PORT || 8200;
const DB_PATH = path.join(__dirname, 'workplat.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL
  );
`);

let CFG = null;
try { CFG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { CFG = null; }
const CLOUD_ON = !!(CFG && CFG.passphrase && CFG.cloudRepo);
const cloud = require('./cloud-sync');

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
function localLoad() { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return null; } }
function localSave(db) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

/* ---------- 线上只读镜像：把加密密文推到 GitHub Pages 仓库 ----------
 * 本地每次保存（已加密的 v1: 密文）除本地镜像外，另写 data/workplat.enc.json 到
 * 项目仓库并 git push origin main，触发 Pages 重建。线上链接拉取该文件解密后即
 * 与本地内容一致。密文公开但无密码不可读，故安全。仅当 db 为 v1: 字符串才镜像。 */
const PAGES_DATA = path.join(ROOT, 'data', 'workplat.enc.json');
let _mirrorBusy = false;
let _mirrorPending = null;
// 带重试的 git 命令（应对 GitHub 网络偶发超时）；commit 的「无变化」是确定性结果，不重试
function gitRun(args, timeoutMs, retries, cb) {
  const tryOnce = (attempt) => {
    exec('git ' + args, { cwd: ROOT, timeout: timeoutMs }, (e) => {
      if (!e || retries <= 0) return cb(e);
      console.error('[pages mirror] git ' + args.split(' ')[0] + ' 失败，重试(' + (attempt + 1) + ')');
      setTimeout(() => tryOnce(attempt + 1), 1500);
    });
  };
  tryOnce(0);
}
function mirrorToPages(sealed) {
  if (typeof sealed !== 'string' || sealed.indexOf('v1:') !== 0) return;
  if (_mirrorBusy) { _mirrorPending = sealed; return; }
  _mirrorBusy = true;
  const run = (payload) => {
    try {
      fs.mkdirSync(path.dirname(PAGES_DATA), { recursive: true });
      fs.writeFileSync(PAGES_DATA, payload);
    } catch (e) { console.error('[pages mirror] write', e.message); _mirrorBusy = false; return; }
    gitRun('pull --rebase -q origin main', 15000, 2, () => {
      gitRun('add data/workplat.enc.json', 5000, 0, () => {
        gitRun('commit -q -m "mirror: 加密数据同步到线上"', 5000, 0, (e3) => {
          if (e3) console.error('[pages mirror] commit (可能无变化)', e3.message);
          gitRun('push -q origin main', 30000, 3, (e4) => {
            if (e4) console.error('[pages mirror] push', e4.message);
            else console.log('[pages mirror] pushed encrypted data ->', new Date().toISOString());
            _mirrorBusy = false;
            if (_mirrorPending && _mirrorPending !== payload) { const n = _mirrorPending; _mirrorPending = null; mirrorToPages(n); }
          });
        });
      });
    });
  };
  run(sealed);
}

/* ---------- 二次校验规则（与既有 server/index.js 一致） ---------- */
const PROJ_STATUS = ['进行中', '已暂停', '已完成', '已结案'];
const TASK_STATUS = ['待办', '待审阅', '已完成'];
const PRIORITY = ['高', '中', '低'];
function parseDate(v) { if (!v) return null; const d = new Date(v.length <= 10 ? v + 'T00:00:00' : v); return isNaN(d.getTime()) ? null : d; }
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
    if (t.projectId) { if (!payloadIds.has(t.projectId) && !canonIds.has(t.projectId)) issues.push({ level: 'error', msg: ref + '：关联项目不存在（孤儿任务，projectId=' + t.projectId + '）' }); }
    else if (t.title && ('' + t.title).trim()) issues.push({ level: 'info', msg: ref + '：未关联任何项目' });
  });
  clients.forEach((c, i) => { if (!c.name || !('' + c.name).trim()) issues.push({ level: 'error', msg: '客户#' + (i + 1) + '：缺少客户名称' }); });
  return { ok: true, checkedAt: new Date().toISOString(), counts: { projects: projects.length, tasks: tasks.length, clients: clients.length }, issues };
}

/* ---------- 静态文件 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const row = db.prepare('SELECT COUNT(*) AS c FROM snapshots').get();
      return send(res, 200, { ok: true, db: 'sqlite', snapshots: row ? row.c : 0, cloud: CLOUD_ON, dataFile: DATA_FILE });
    }
    if (req.method === 'GET' && url.pathname === '/api/load') {
      let dbObj = localLoad();
      let savedAt = null;
      if (dbObj && typeof dbObj === 'string') {
        // 客户端加密密文（v1: 前缀）：无 meta，用文件修改时间作为 savedAt 代理
        try { savedAt = fs.statSync(DATA_FILE).mtime.toISOString(); } catch (e) {}
      } else if (dbObj && dbObj.meta) {
        savedAt = dbObj.meta.syncedAt || null;
      }
      if (CLOUD_ON) {
        try {
          const cloudDb = cloud.pullCloud(CFG);
          // 密文无法比较时间戳：仅当本地文件缺失时才用云端恢复
          if (cloudDb && !dbObj) { dbObj = cloudDb; savedAt = cloud.tsOf(cloudDb); }
        } catch (e) { console.error('[cloud pull]', e.message); }
      }
      return send(res, 200, { ok: true, db: dbObj, savedAt: savedAt || null });
    }
    if (req.method === 'POST' && (url.pathname === '/api/save' || url.pathname === '/api/sync')) {
      const body = await readBody(req);
      const dbObj = body.db || body;
      const now = new Date().toISOString();
      // 客户端加密后的密文（v1: 前缀字符串）：原样存储，不解析对象、不上 meta
      if (typeof dbObj === 'string') {
        if (dbObj.indexOf('v1:') !== 0) return send(res, 400, { ok: false, error: 'invalid payload' });
        localSave(dbObj);
        db.prepare('INSERT INTO snapshots (kind, payload, saved_at) VALUES (?, ?, ?)').run('sealed', dbObj, now);
        if (CLOUD_ON) { try { cloud.pushCloud(dbObj, CFG); } catch (e) { console.error('[cloud push]', e.message); } }
        mirrorToPages(dbObj); // 异步推到 GitHub Pages（线上只读镜像）
        return send(res, 200, { ok: true, savedAt: now, sealed: true });
      }
      if (!dbObj || typeof dbObj !== 'object') return send(res, 400, { ok: false, error: 'invalid body' });
      dbObj.meta = dbObj.meta || {};
      dbObj.meta.syncedAt = now;
      localSave(dbObj);
      db.prepare('INSERT INTO snapshots (kind, payload, saved_at) VALUES (?, ?, ?)').run('full', JSON.stringify(dbObj), now);
      if (CLOUD_ON) { try { cloud.pushCloud(dbObj, CFG); } catch (e) { console.error('[cloud push]', e.message); } }
      return send(res, 200, { ok: true, savedAt: now, counts: { projects: (dbObj.projects || []).length, tasks: (dbObj.tasks || []).length, clients: (dbObj.clients || []).length } });
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
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log('[WORK-Plat sync] SPA + 本地存储 @ ' + DATA_FILE);
  console.log('[WORK-Plat sync] 云端同步 ' + (CFG ? '已启用 → ' + CFG.cloudRepo : '未配置（见 .sync-config.json）'));
  console.log('[WORK-Plat sync] listening on http://localhost:' + PORT);
});
