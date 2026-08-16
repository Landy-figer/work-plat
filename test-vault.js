/* 冒烟 + 集成测试：vault.js 与 store.js 在保险库启用下的行为
 * 场景 A：烧录校验值 / 解锁 / 加解密往返
 * 场景 B：旧明文数据 → 解锁 → unsealLoad 还原 → persist 落盘为密文 → 再次解密一致
 * 密码取部署时生成值（node test-vault.js <密码> 可覆盖）。 */
const assert = require('assert');

const mem = {};
global.window = global;
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.BroadcastChannel = undefined;
global.location = { port: '0' };

const PW = process.argv[2] || '66SgtDuCtmPYyb4F';

require('./assets/vault.js');
require('./assets/store.js');
const V = global.LB.vault;
const S = global.LB.store;

(async () => {
  // —— 场景 A ——
  assert.ok(V.enabled, '保险库应启用（烧录校验值存在）');
  assert.ok(V.locked, '初始应锁定');
  assert.strictEqual(V.isUnlocked(), false, '初始未解锁');
  await V.unlock(PW);
  assert.ok(V.isUnlocked(), '正确密码应解锁');
  V.lock();
  let threw = false;
  try { await V.unlock('wrong-pass'); } catch (e) { threw = true; }
  assert.ok(threw, '错误密码应被拒绝');
  await V.unlock(PW);
  const db = { projects: [{ id: 'p1', name: '测试项目', cases: [], notes: [] }], tasks: [], clients: [], judges: [], lawItems: [], audit: [], meta: { currentUser: '我' } };
  const sealed = await V.seal(db);
  assert.ok(('' + sealed).indexOf('v1:') === 0, '密文以 v1: 前缀');
  assert.deepStrictEqual(await V.unseal(sealed), db, '解密往返一致');

  // —— 场景 B：旧明文迁移为密文 ——
  const plain = { projects: [{ id: 'old', name: '旧数据', cases: [], notes: [], creditors: [] }], tasks: [], clients: [], judges: [], lawItems: [], audit: [], meta: { currentUser: '我' } };
  mem['legal_workbench_db_v1'] = JSON.stringify(plain);
  await V.unlock(PW);
  const restored = await S.unsealLoad();
  assert.strictEqual(restored.projects[0].name, '旧数据', 'unsealLoad 还原旧明文');
  await S.persist();
  const stored = mem['legal_workbench_db_v1'];
  assert.ok(('' + stored).indexOf('v1:') === 0, 'persist 后 localStorage 变为密文');
  const back = await V.unseal(stored);
  assert.strictEqual(back.projects[0].name, '旧数据', '密文再次解密一致');

  console.log('  ✓ vault.js 烧录校验值 / 解锁 / 加解密往返 / 旧明文迁移加密 全部通过');
})().catch((e) => { console.error('VAULT FAIL:', e && e.message); process.exit(1); });
