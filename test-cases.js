/* 回归测试：关联案件（cases）数据层 CRUD / 导出 / 派生 / 兼容
 * 用 Node + localStorage 垫片加载真实 assets/store.js，验证：
 *  1) 项目迁移：导入的 15 项目（无 cases 字段）兼容，cases 默认为空数组
 *  2) 新建/读取/更新/删除关联案件
 *  3) 案件备注 / 进展 CRUD
 *  4) cases 进入 exportCSV('cases')
 *  5) deriveEvents / reminders 包含案件节点
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// —— 垫片 ——
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.BroadcastChannel = undefined; // 触发 store 内 try/catch 降级
global.location = { port: '0' };       // 不触发后端网络
global.window = global;

// 预置真实导入的 15 项目台账（含 Request 8 产物），验证迁移兼容性
const DB_KEY = 'legal_workbench_db_v1';
const importPath = path.join(__dirname, 'workbench-import-2026-08-16.json');
if (fs.existsSync(importPath)) {
  const imported = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  mem[DB_KEY] = JSON.stringify(imported);
} else {
  console.log('（未找到导入台账，将回退到种子数据）');
}

// 载入真实 store.js
const storeJs = path.join(__dirname, 'assets', 'store.js');
require(storeJs);
const S = global.LB.store;

console.log('\n[1] 项目迁移与基础兼容');
const projects = S.listProjects();
ok('载入项目数 = 15', projects.length === 15);
ok('全部项目 cases 为数组（迁移生效）', projects.every((p) => Array.isArray(p.cases)));
ok('导入项目 notes 为数组（docs→notes 迁移生效）', projects.every((p) => Array.isArray(p.notes)));
ok('导入项目 fee 为合并后的字符串（旧 feeUpfront/feeLater 已并入）', projects.every((p) => typeof p.fee === 'string' && !('feeUpfront' in p)));
ok('导入项目 seizures 为数组（旧 collateral/seizedItem 已并入多项）', projects.every((p) => Array.isArray(p.seizures) && !('seizedItem' in p)));
ok('导入项目 cases 默认空', projects.every((p) => p.cases.length === 0));

console.log('\n[2] 关联案件 CRUD');
const pid = projects[0].id;
const nearHearing = new Date(Date.now() + 5 * 86400000).toISOString(); // 5 天后开庭，落在 14 天提醒窗口内
const created = S.saveCase(pid, { name: '变更执行人执行案', category: '执行类', status: '进行中', cause: '变更执行人', caseNo: '(2026)粤03执异1号', hearingDate: nearHearing, execCourt: '深圳市中级人民法院', execStatus: '立案' }, true);
ok('新建案件返回带 id', !!(created && created.id));
const cid = created.id;
ok('案件进入项目 cases', S.listCases(pid).length === 1);
ok('getCase 可读', S.getCase(pid, cid).name === '变更执行人执行案');
ok('案件携带类别专属字段', S.getCase(pid, cid).execCourt === '深圳市中级人民法院');

// 更新
S.saveCase(pid, Object.assign({}, S.getCase(pid, cid), { status: '已结案', feeUpfront: '执行到位 50万' }), false);
ok('更新案件字段', S.getCase(pid, cid).status === '已结案' && S.getCase(pid, cid).feeUpfront === '执行到位 50万');

console.log('\n[3] 案件备注 / 进展');
S.addCaseProgress(pid, cid, { content: '提交变更执行人申请书', author: '我' });
S.addCaseNote(pid, cid, { recipient: '杜总', content: '执行裁定书：首封', archiveLocation: '档案室A', archiveCabinet: '3号柜' });
ok('案件进展 +1', S.getCase(pid, cid).progress.length === 1);
ok('案件备注 +1', S.getCase(pid, cid).notes.length === 1);
S.deleteCaseNote(pid, cid, 0);
ok('案件备注删除', S.getCase(pid, cid).notes.length === 0);

console.log('\n[4] 多案件独立 & 删除');
S.saveCase(pid, { name: '另案', category: '其他类', status: '进行中' }, true);
const cid2 = S.listCases(pid)[1].id;
ok('项目现含 2 个案件', S.listCases(pid).length === 2);
S.deleteCase(pid, cid2);
ok('删除一个后剩 1 个', S.listCases(pid).length === 1);

console.log('\n[5] 导出 / 派生 / 提醒');
const csv = S.exportCSV('cases');
ok('exportCSV("cases") 含表头', csv.split('\n')[0].indexOf('案件名称') >= 0);
ok('exportCSV("cases") 含本案数据', csv.indexOf('变更执行人执行案') >= 0);
const evts = S.deriveEvents();
ok('deriveEvents 含案件开庭', evts.some((e) => e.kind === 'hearing' && e.title.indexOf('变更执行人执行案') >= 0));
const rems = S.reminders();
ok('reminders 含案件节点（开庭/合同/续费）', rems.some((r) => (r.project || '').indexOf('变更执行人执行案') >= 0));
const st = S.stats();
ok('stats.totalCases 计入', st.totalCases >= 1);

console.log('\n[6] 删除项目级联不影响其他（仅本项目 cases 清除）');
S.deleteCase(pid, cid);
ok('项目案件清空', S.listCases(pid).length === 0);

console.log('\n[7] importJSON 迁移归一化');
if (fs.existsSync(importPath)) {
  const pristine = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  ok('导入源（原始台账）不含 cases 字段', pristine.projects.every((p) => !Array.isArray(p.cases)));
  S.importJSON(JSON.stringify(pristine)); // 模拟用户“从备份恢复”原始台账
  ok('导入后所有项目 cases 归一化为数组', S.listProjects().every((p) => Array.isArray(p.cases)));
  ok('导入后所有项目 notes 归一化为数组（旧 docs 已迁移清除）', S.listProjects().every((p) => Array.isArray(p.notes) && !('docs' in p)));
  ok('导入后所有项目 fee 为字符串（旧 feeUpfront/feeLater 已清除）', S.listProjects().every((p) => typeof p.fee === 'string' && !('feeUpfront' in p) && !('feeLater' in p)));
  ok('导入后所有项目 seizures 为数组（旧 collateral/seizedItem 已清除）', S.listProjects().every((p) => Array.isArray(p.seizures) && !('seizedItem' in p) && !('collateral' in p)));
  ok('导入后案件可正常新建', (() => { const t = S.listProjects()[0].id; const c = S.saveCase(t, { name: '导入后案件', category: '其他类', status: '进行中' }, true); return !!(c && c.id); })());
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
