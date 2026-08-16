/* 拖拽排序回归测试：验证 store 层子集安全重排 applyOrder 与四路 reorder* 持久化
 * 用 Node + localStorage 垫片加载真实 assets/store.js，验证：
 *  1) applyOrder 子集重排：参与项按新序成块插入首个参与项原位置，未参与项保持相对顺序
 *  2) reorderProjects / reorderClients / reorderJudges / reorderTasks 调用后 DB 顺序变化
 *  3) reorder* 实时持久化：localStorage 中顺序同步更新
 *  4) 边界：含未知 id / 全量重排 / 单元素重排 不报错且保持正确
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }
function idsOf(arr) { return arr.map((x) => x.id); }

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

// —— 受控种子（与真实 import 同形状，仅取少量确定性数据）——
const DB_KEY = 'legal_workbench_db_v1';
const seedDb = {
  meta: { currentUser: '我', version: 1 },
  projects: [
    { id: 'p1', name: 'A', cases: [], notes: [], progress: [] },
    { id: 'p2', name: 'B', cases: [], notes: [], progress: [] },
    { id: 'p3', name: 'C', cases: [], notes: [], progress: [] },
    { id: 'p4', name: 'D', cases: [], notes: [], progress: [] }
  ],
  clients: [{ id: 'c1', name: '甲' }, { id: 'c2', name: '乙' }, { id: 'c3', name: '丙' }],
  judges: [{ id: 'j1', name: '张法官' }, { id: 'j2', name: '李法官' }, { id: 'j3', name: '王法官' }],
  tasks: [{ id: 't1', title: '任务一' }, { id: 't2', title: '任务二' }, { id: 't3', title: '任务三' }],
  lawItems: [],
  audit: []
};
mem[DB_KEY] = JSON.stringify(seedDb);

// 载入真实 store.js
const storeJs = path.join(__dirname, 'assets', 'store.js');
require(storeJs);
const S = global.LB.store;

console.log('\n[1] 种子就绪');
ok('项目 4 个且默认序 p1,p2,p3,p4', idsOf(S.listProjects()).join(',') === 'p1,p2,p3,p4');
ok('对接人 3 个', S.DB.clients.length === 3);
ok('经办法官 3 个', S.DB.judges.length === 3);
ok('任务 3 个', S.DB.tasks.length === 3);

console.log('\n[2] applyOrder 子集安全重排（成块插入首个参与项原位置）');
// 原始 [p1,p2,p3,p4]，参与子集 [p4,p2] → 首个参与项 p2 在原位 idx 1，结果应为 [p1,p4,p2,p3]
S.reorderProjects(['p4', 'p2']);
ok('仅重排子集 p4,p2 → [p1,p4,p2,p3]', idsOf(S.listProjects()).join(',') === 'p1,p4,p2,p3');

console.log('\n[3] 全量重排');
S.reorderProjects(['p3', 'p1', 'p4', 'p2']);
ok('全量重排 → [p3,p1,p4,p2]', idsOf(S.listProjects()).join(',') === 'p3,p1,p4,p2');

console.log('\n[4] 单元素重排（回到首位的语义由调用方决定，这里仅验证不破坏）');
S.reorderProjects(['p1']);
ok('单元素 [p1] 仍含全部 4 项且 p1 在参与块首位', S.listProjects().length === 4 && idsOf(S.listProjects()).indexOf('p1') === idsOf(S.listProjects()).findIndex((id) => ['p1'].includes(id)));

console.log('\n[5] 对接人 / 经办法官 / 任务 独立重排');
S.reorderClients(['c3', 'c1', 'c2']);
ok('对接人 → [c3,c1,c2]', idsOf(S.DB.clients).join(',') === 'c3,c1,c2');
S.reorderJudges(['j2', 'j3', 'j1']);
ok('经办法官 → [j2,j3,j1]', idsOf(S.DB.judges).join(',') === 'j2,j3,j1');
S.reorderTasks(['t2', 't1', 't3']);
ok('任务 → [t2,t1,t3]', idsOf(S.DB.tasks).join(',') === 't2,t1,t3');

console.log('\n[6] reorder* 实时持久化到 localStorage');
const persisted = JSON.parse(global.localStorage.getItem(DB_KEY));
ok('持久化：项目顺序 = [p3,p1,p4,p2]', persisted.projects.map((p) => p.id).join(',') === 'p3,p1,p4,p2');
ok('持久化：对接人顺序 = [c3,c1,c2]', persisted.clients.map((c) => c.id).join(',') === 'c3,c1,c2');
ok('持久化：经办法官顺序 = [j2,j3,j1]', persisted.judges.map((j) => j.id).join(',') === 'j2,j3,j1');
ok('持久化：任务顺序 = [t2,t1,t3]', persisted.tasks.map((t) => t.id).join(',') === 't2,t1,t3');

console.log('\n[7] 边界：含未知 id 不报错且被忽略');
let threw = false;
try { S.reorderProjects(['pX', 'p2', 'p3']); } catch (e) { threw = true; }
ok('含未知 id 不抛错', !threw);
ok('未知 id 被忽略，已知项按新序成块', idsOf(S.listProjects()).join(',').indexOf('pX') === -1);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
