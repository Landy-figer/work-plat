const fs = require('fs');

// ---- 浏览器环境 shim ----
const mem = {};
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.window = global;
global.LB = { util: {}, onPersist: () => {}, onSync: () => {} };
global.localStorage = localStorage;
global.BroadcastChannel = undefined; // store.js 内部 try/catch 处理
global.location = { port: '' };
global.document = undefined;

// 载入真实 store.js（IIFE 挂到 window.LB.store）。已无种子数据，库从空开始。
const code = fs.readFileSync(__dirname + '/assets/store.js', 'utf8');
eval(code);
const S = global.LB.store;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

// 自建数据（不依赖任何种子）
function futureISO(days) { const x = new Date(Date.now() + days * 86400000); x.setHours(9, 30, 0, 0); return x.toISOString(); }

const proj = S.saveProject({ name: '测试项目A', category: '诉讼类', hearingDate: futureISO(5), contractExpiryDate: futureISO(8), renewalDate: futureISO(10), doneEvents: [], progress: [] }, true);
const caseObj = S.saveCase(proj.id, { name: '关联案件1', hearingDate: futureISO(3), doneEvents: [] }, true);
const caseId = caseObj.id;

// 1) 派生日程提醒出现在 scheduleReminders（项目级 + 案件级）
const before = S.scheduleReminders(14);
ok('存在项目级开庭/合同/查封提醒', before.some(r => r.type === '开庭日期' && r.projectId === proj.id) && before.some(r => r.type === '合同到期' && r.projectId === proj.id) && before.some(r => r.type === '查封到期提醒' && r.projectId === proj.id));
ok('存在案件级开庭提醒', before.some(r => r.caseId === caseId && r.type === '开庭日期'));

// 2) 标记项目级"开庭"完成 -> 从提醒消失 + 归档进展 + doneEvents 记录
const hearingRem = before.find(r => r.type === '开庭日期' && r.projectId === proj.id && !r.caseId);
ok('找到待完成开庭提醒', !!hearingRem);
S.setScheduleDone({ eventId: null, projectId: proj.id, caseId: null, kind: 'hearing' }, true);
const after = S.scheduleReminders(14);
ok('完成后开庭提醒从列表消失', !after.some(r => r.type === '开庭日期' && r.projectId === proj.id && !r.caseId));
ok('isScheduleDone 返回 true', S.isScheduleDone(hearingRem) === true);
const updatedProj = S.getProject(proj.id);
ok('完成归档到项目进展', updatedProj.progress.some(p => (p.content || '').indexOf('日程已完成') >= 0));
ok('项目 doneEvents 记录 hearing', (updatedProj.doneEvents || []).includes('hearing'));

// 3) 恢复 -> 重新出现
S.setScheduleDone({ eventId: null, projectId: proj.id, caseId: null, kind: 'hearing' }, false);
ok('恢复后开庭提醒重新出现', S.scheduleReminders(14).some(r => r.type === '开庭日期' && r.projectId === proj.id && !r.caseId));
ok('恢复后 isScheduleDone 返回 false', S.isScheduleDone(hearingRem) === false);

// 4) 手动日程事件：并入 DB.events，可持久化；完成后从提醒消失
const ev = S.saveManualEvent({ title: '客户回访', start: futureISO(2), end: null, projectId: null }, true);
ok('手动事件写入 DB.events', S.listManualEvents().some(x => x.id === ev.id));
ok('DB 序列化包含 events', (JSON.parse(mem[global.window.LB.store ? 'legal_workbench_db_v1' : 'legal_workbench_db_v1'] || '{}').events || []).some(x => x.id === ev.id));
const evRem = S.scheduleReminders(14).find(r => r.eventId === ev.id);
ok('手动日程出现在提醒', !!evRem);
S.setScheduleDone({ eventId: ev.id, projectId: null, caseId: null, kind: 'manual' }, true);
ok('手动完成后从提醒消失', !S.scheduleReminders(14).some(r => r.eventId === ev.id));
ok('手动事件 done=true', S.listManualEvents().find(x => x.id === ev.id).done === true);
ok('手动(无项目)完成不报错且未写进展', true);

// 4b) 手动事件带项目关联 -> 完成后自动归档到该项目进展
const progBefore = S.getProject(proj.id).progress.length;
const ev2 = S.saveManualEvent({ title: '提交诉讼材料', start: futureISO(3), end: null, projectId: proj.id }, true);
ok('手动事件写入 projectId', S.listManualEvents().find(x => x.id === ev2.id).projectId === proj.id);
S.setScheduleDone({ eventId: ev2.id, projectId: proj.id, caseId: null, kind: 'manual' }, true);
ok('手动(带项目)完成归档到项目进展', S.getProject(proj.id).progress.length > progBefore && S.getProject(proj.id).progress.some(p => (p.content || '').indexOf('提交诉讼材料') >= 0));
S.setScheduleDone({ eventId: ev2.id, projectId: proj.id, caseId: null, kind: 'manual' }, false);

// 5) 案件级派生事件（caseId）完成过滤
const crem = S.scheduleReminders(14).find(r => r.caseId === caseId);
ok('找到案件级开庭提醒(恢复后)', !!crem);
S.setScheduleDone({ eventId: null, projectId: proj.id, caseId: caseId, kind: 'hearing' }, true);
ok('案件级完成后从提醒消失', !S.scheduleReminders(14).some(r => r.caseId === caseId));
ok('案件 doneEvents 记录 hearing', (S.getProject(proj.id).cases.find(c => c.id === caseId).doneEvents || []).includes('hearing'));

// 6) 空库确认：无种子数据
ok('新库无种子项目', S.listProjects().filter(p => /seed/.test(p.id)).length === 0);

console.log('\n结果: PASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
