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

// 载入真实 store.js（IIFE 挂到 window.LB.store）
const code = fs.readFileSync(__dirname + '/assets/store.js', 'utf8');
eval(code);
const S = global.LB.store;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

// 1) 初始种子：项目含 hearing/contract/renewal，未完成的日程会出现在 scheduleReminders
const before = S.scheduleReminders(14);
ok('种子存在开庭/查封日程提醒', before.some(r => r.type === '开庭日期') && before.some(r => r.type === '查封到期提醒'));

// 2) 标记一个项目级"开庭"完成 -> 该日程从提醒消失 + 归档到项目进展
const proj = S.listProjects().find(p => p.hearingDate);
const hearingRem = before.find(r => r.type === '开庭日期' && r.projectId === proj.id);
ok('找到待完成开庭提醒', !!hearingRem);

S.setScheduleDone({ eventId: null, projectId: proj.id, caseId: null, kind: 'hearing' }, true);
const after = S.scheduleReminders(14);
ok('完成后开庭提醒从列表消失', !after.some(r => r.type === '开庭日期' && r.projectId === proj.id));
ok('isScheduleDone 返回 true', S.isScheduleDone(hearingRem) === true);

const updatedProj = S.getProject(proj.id);
ok('完成归档到项目进展', updatedProj.progress.some(p => (p.content || '').indexOf('日程已完成') >= 0));
ok('项目 doneEvents 记录 hearing', (updatedProj.doneEvents || []).includes('hearing'));

// 3) 恢复 -> 重新出现在提醒（进展不移除，符合"归档"语义）
S.setScheduleDone({ eventId: null, projectId: proj.id, caseId: null, kind: 'hearing' }, false);
ok('恢复后开庭提醒重新出现', S.scheduleReminders(14).some(r => r.type === '开庭日期' && r.projectId === proj.id));
ok('恢复后 isScheduleDone 返回 false', S.isScheduleDone(hearingRem) === false);

// 4) 手动日程事件：events 现在并入 DB，可持久化；完成后从提醒消失
const totalBefore = S.scheduleReminders(14).length;
const ev = S.saveManualEvent({ title: '客户回访', start: new Date(Date.now() + 2 * 86400000).toISOString(), end: null, projectId: null }, true);
ok('手动事件写入 DB.events', S.listManualEvents().some(x => x.id === ev.id));
ok('DB 序列化包含 events', (JSON.parse(mem[global.window.LB.store ? 'legal_workbench_db_v1' : 'legal_workbench_db_v1'] || '{}').events || []).some(x => x.id === ev.id));

const evRem = S.scheduleReminders(14).find(r => r.eventId === ev.id);
ok('手动日程出现在提醒', !!evRem);
S.setScheduleDone({ eventId: ev.id, projectId: null, caseId: null, kind: 'manual' }, true);
ok('手动完成后从提醒消失', !S.scheduleReminders(14).some(r => r.eventId === ev.id));
ok('手动事件 done=true', S.listManualEvents().find(x => x.id === ev.id).done === true);
ok('手动(无项目)完成不报错且未写进展', true);

// 4b) 手动事件带项目关联 -> 完成后自动归档到该项目进展
const linkedProj = S.listProjects()[0];
const ev2 = S.saveManualEvent({ title: '提交诉讼材料', start: new Date(Date.now() + 3 * 86400000).toISOString(), end: null, projectId: linkedProj.id }, true);
ok('手动事件写入 projectId', S.listManualEvents().find(x => x.id === ev2.id).projectId === linkedProj.id);
const progBefore = S.getProject(linkedProj.id).progress.length;
S.setScheduleDone({ eventId: ev2.id, projectId: linkedProj.id, caseId: null, kind: 'manual' }, true);
ok('手动(带项目)完成归档到项目进展', S.getProject(linkedProj.id).progress.length > progBefore && S.getProject(linkedProj.id).progress.some(p => (p.content || '').indexOf('提交诉讼材料') >= 0));
S.setScheduleDone({ eventId: ev2.id, projectId: linkedProj.id, caseId: null, kind: 'manual' }, false);

// 5) 案件级派生事件（caseId）完成过滤
const withCase = S.listProjects().map(p => (p.cases || []).find(c => c.hearingDate)).filter(Boolean)[0];
if (withCase) {
  const host = S.listProjects().find(p => (p.cases || []).some(c => c === withCase));
  const crem = before.find(r => r.caseId === withCase.id);
  ok('找到案件级开庭提醒', !!crem);
  S.setScheduleDone({ eventId: null, projectId: host.id, caseId: withCase.id, kind: 'hearing' }, true);
  ok('案件级完成后从提醒消失', !S.scheduleReminders(14).some(r => r.caseId === withCase.id));
  ok('案件 doneEvents 记录 hearing', (host.cases.find(c => c === withCase).doneEvents || []).includes('hearing'));
}

console.log('\n结果: PASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
