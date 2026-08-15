/* =====================================================================
 * WORK-Plat — 加密云端同步模块
 * 将本地 DB 以 AES-256-GCM 加密后，推送到私有 GitHub 数据仓库（双向同步）。
 * 依赖：Node 22 内置 crypto / child_process（无需 npm install）
 * 配置：同目录 .sync-config.json（不进仓库），含 passphrase / cloudRepo / token
 * ===================================================================== */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function encrypt(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

function decrypt(text, passphrase) {
  const parts = ('' + text).split(':');
  if (parts.length !== 4) throw new Error('加密格式无效');
  const [s, b, t, c] = parts.map((x) => Buffer.from(x, 'base64'));
  const key = crypto.scryptSync(passphrase, s, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, b);
  decipher.setAuthTag(t);
  const dec = Buffer.concat([decipher.update(c), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

function remoteUrl(cfg) {
  const base = 'https://github.com/' + cfg.cloudRepo + '.git';
  if (cfg.token) return base.replace('https://', 'https://x-access-token:' + cfg.token + '@');
  return base;
}

function ensureClone(cfg) {
  if (fs.existsSync(cfg.cloneDir)) {
    execSync('git remote set-url origin ' + remoteUrl(cfg), { cwd: cfg.cloneDir, stdio: 'ignore' });
    return;
  }
  fs.mkdirSync(path.dirname(cfg.cloneDir), { recursive: true });
  execSync('git clone --quiet ' + remoteUrl(cfg) + ' "' + cfg.cloneDir + '"', { stdio: 'ignore' });
}

function tsOf(db) {
  return db && db.meta && db.meta.syncedAt ? db.meta.syncedAt : null;
}

function pushCloud(db, cfg) {
  ensureClone(cfg);
  const file = path.join(cfg.cloneDir, 'workplat.enc');
  fs.writeFileSync(file, encrypt(db, cfg.passphrase));
  const msg = 'sync ' + new Date().toISOString();
  execSync('git add -A && git commit -q -m "' + msg + '" && git push -q origin ' + (cfg.cloudBranch || 'main'), { cwd: cfg.cloneDir, stdio: 'ignore' });
}

function pullCloud(cfg) {
  ensureClone(cfg);
  execSync('git pull -q origin ' + (cfg.cloudBranch || 'main'), { cwd: cfg.cloneDir, stdio: 'ignore' });
  const file = path.join(cfg.cloneDir, 'workplat.enc');
  if (!fs.existsSync(file)) return null;
  return decrypt(fs.readFileSync(file, 'utf8'), cfg.passphrase);
}

function newer(a, b) {
  const ta = tsOf(a), tb = tsOf(b);
  if (!ta) return false;
  if (!tb) return true;
  return ta > tb;
}

module.exports = { encrypt, decrypt, pushCloud, pullCloud, tsOf, newer };
