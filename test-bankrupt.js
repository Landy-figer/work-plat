/* 回归测试：破产要素多项债权持有人 + 费用字段改名 + 进展编辑/删除
 * 用 Node + localStorage 垫片加载真实 assets/store.js，验证：
 *  1) 种子：破产类项目 creditors 为多项数组，且带头人的债权流转明细
 *  2) 种子：合同信息改用 agentLawyer（无 contractLawyer），案由/主案号在基础信息
 *  3) 进展：deleteProgress / updateProgress 工作（在种子上，早于导入覆盖）
 *  4) 迁移：旧 creditor 字符串 → creditors 多项数组
 *  5) 迁移：旧 contractLawyer → agentLawyer
 *  6) 导出：projects 含「代理律师」「债权持有人(多项)」列
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// —— 垫片（不预载导入台账，强制走种子）——
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.BroadcastChannel = undefined;
global.location = { port: '0' };
global.window = global;

const storeJs = path.join(__dirname, 'assets', 'store.js');
require(storeJs);
const S = global.LB.store;

console.log('\n[1] 种子：破产类多项债权持有人');
const seedBank = S.listProjects().find((p) => p.category === '破产类');
ok('破产类项目存在', !!seedBank);
ok('creditors 为数组', Array.isArray(seedBank.creditors));
ok('creditors 含 ≥1 持有人', seedBank.creditors.length >= 1);
ok('持有人含 name', seedBank.creditors[0] && typeof seedBank.creditors[0].name === 'string');
ok('持有人含 transfers 数组', seedBank.creditors[0] && Array.isArray(seedBank.creditors[0].transfers));
ok('transfers 含流转记录（原始债权人/金额）', seedBank.creditors[0].transfers.length >= 1 && seedBank.creditors[0].transfers[0].from && seedBank.creditors[0].transfers[0].amount);

console.log('\n[2] 种子：合同信息字段改名');
const seed1 = S.getProject(seedBank.id);
ok('agentLawyer 为字符串（合同信息）', typeof seed1.agentLawyer === 'string');
ok('无 contractLawyer 旧键', !('contractLawyer' in seed1));
ok('基础信息含案由(cause)', 'cause' in seed1);
ok('基础信息含主案号(caseNo)', 'caseNo' in seed1);
const seed2 = S.listProjects().find((p) => p.category !== '破产类');
ok('其余项目也无 contractLawyer 旧键', !('contractLawyer' in seed2));

console.log('\n[3] 进展编辑 / 删除（种子，早于导入覆盖）');
const pid = seedBank.id;
const before = S.getProject(pid).progress.length;
S.addProgress(pid, { content: '校验进展编辑/删除' });
ok('addProgress +1', S.getProject(pid).progress.length === before + 1);
const idx = S.getProject(pid).progress.findIndex((x) => x.content === '校验进展编辑/删除');
ok('定位新增进展索引', idx >= 0);
S.updateProgress(pid, idx, { content: '已编辑进展', date: '2026-08-16' });
ok('updateProgress 改写内容', S.getProject(pid).progress[idx].content === '已编辑进展');
ok('updateProgress 改写日期', (S.getProject(pid).progress[idx].date || '').indexOf('2026-08-16') === 0);
S.deleteProgress(pid, idx);
ok('deleteProgress -1', S.getProject(pid).progress.length === before);

console.log('\n[4] 迁移：旧 creditor 字符串 → creditors 多项数组');
S.importJSON(JSON.stringify({ projects: [{ id: 'old_x', name: '旧格式项目', category: '破产类', creditor: '老债权人A', contractLawyer: '旧委托合同/我', relatedCases: '旧备注', caseNo: '—' }], clients: [], judges: [], lawItems: [], tasks: [], audit: [], meta: { lastSync: null, currentUser: '我' } }));
const ox = S.getProject('old_x');
ok('旧 creditor 字符串 → creditors 数组(1 项)', Array.isArray(ox.creditors) && ox.creditors.length === 1 && ox.creditors[0].name === '老债权人A');
ok('旧 creditor 键已清除', !('creditor' in ox));

console.log('\n[5] 迁移：旧 contractLawyer → agentLawyer');
ok('旧 contractLawyer → agentLawyer', ox.agentLawyer === '旧委托合同/我' && !('contractLawyer' in ox));

console.log('\n[6] 导出：代理律师 / 债权持有人列');
const csv = S.exportCSV('projects');
const header = csv.split('\n')[0];
ok('projects 导出含「代理律师」列', header.indexOf('代理律师') >= 0);
ok('projects 导出含「债权持有人(多项)」列', header.indexOf('债权持有人(多项)') >= 0);
ok('projects 导出不含旧「代理合同及律师」列', header.indexOf('代理合同及律师') < 0);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
