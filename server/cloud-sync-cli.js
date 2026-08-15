/* =====================================================================
 * WORK-Plat — 云端双向同步命令行（供 Windows 任务计划程序定期调用）
 * 读取 D:\ 本地文件 → 拉取云端(解密) → 最后写入者胜出合并 → 写回本地并推送
 * 用法：node server/cloud-sync-cli.js
 * 依赖：.sync-config.json（含 passphrase / cloudRepo / token）
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const cloud = require('./cloud-sync');

const DATA_FILE = path.join('D:\\workbuddy\\workplat数据存储', 'workplat.db.json');
const CONFIG_PATH = path.join(__dirname, '.sync-config.json');

function main() {
  let CFG;
  try { CFG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { console.log('[skip] 未找到 .sync-config.json，跳过云端同步'); return; }
  if (!CFG.passphrase) { console.log('[skip] 未配置 passphrase，跳过云端同步'); return; }

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  let local = null;
  try { local = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { local = null; }
  let cloudDb = null;
  try { cloudDb = cloud.pullCloud(CFG); } catch (e) { console.error('[warn] 云端拉取失败：', e.message); }

  // 合并：取较新一方为基准
  let merged;
  if (!local && !cloudDb) { console.log('[ok] 无本地亦无云端数据'); return; }
  if (!cloudDb) merged = local;
  else if (!local) merged = cloudDb;
  else merged = cloud.newer(local, cloudDb) ? local : cloudDb;

  const localTs = cloud.tsOf(local), cloudTs = cloud.tsOf(cloudDb);
  if (localTs && cloudTs && localTs === cloudTs) { console.log('[ok] 本地与云端一致，无需同步'); return; }

  // 写回本地（若云端较新）
  if (cloudDb && cloud.newer(cloudDb, local)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2));
    console.log('[ok] 已用云端版本更新本地文件');
  }
  // 推送（本地较新或存在分歧）
  try { cloud.pushCloud(merged, CFG); console.log('[ok] 已推送至云端'); }
  catch (e) { console.error('[error] 云端推送失败：', e.message); process.exitCode = 1; }
}

main();
