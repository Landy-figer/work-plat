/* =====================================================================
 * WORK-Plat — 密码保险库（vault.js）
 * 客户端密码锁：访问密码用于派生密钥，本地数据以 AES-256-GCM 加密存储。
 * 校验值(VAULT_VERIFIER)在部署时由服务器端生成并烧录，所有人共用同一访问密码；
 * 没有密码既看不到界面、也解不开本地密文。GitHub Pages 为纯静态托管，
 * 无法做服务端校验，故采用客户端锁 + 数据加密（密码校验逻辑在网页代码内，
 * 建议使用高强度密码；数据本身为密文，无密码无法读取）。
 *
 * 派生参数（须与部署时生成器一致）：
 *   PBKDF2 · SHA-256 · 200000 迭代 · 16 字节 salt → AES-GCM 256 · 12 字节 iv
 *   校验明文常量：WORKPLAT-OK
 * ===================================================================== */
(function (global) {
  'use strict';
  const LB = (global.LB = global.LB || {});

  /* 共享校验值（部署时生成，非密码本身，仅供校验是否输入正确） */
  const VAULT_VERIFIER = {
    v: 1,
    salt: 'y8HaL69GPuwL+AEvf0vMxQ==',
    iv: 'whwRovHoqFMsTCkz',
    verifier: 'BE0y173tB3XlpzTuAu3ivYICfgQ1PUtCEvGO'
  };

  const SUBTLE = (global.crypto && global.crypto.subtle) ? global.crypto.subtle : null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const VA = 'v1:';            // 密文前缀
  const TOKEN = 'WORKPLAT-OK'; // 校验明文
  const ITER = 200000;

  function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64d(s) { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }

  async function deriveKey(password, saltBuf) {
    const base = await SUBTLE.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return SUBTLE.deriveKey(
      { name: 'PBKDF2', salt: saltBuf, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  const vault = {
    enabled: false, locked: true, hasVault: false, key: null, pendingRaw: null, _verifier: null,
    init() {
      if (!SUBTLE) { this.enabled = false; this.locked = true; this.hasVault = false; return; }
      if (VAULT_VERIFIER && VAULT_VERIFIER.verifier) {
        this.enabled = true; this.hasVault = true; this.locked = true; this._verifier = VAULT_VERIFIER;
      } else { this.enabled = false; this.hasVault = false; this.locked = true; }
    },
    /* 校验访问密码；正确则保存派生密钥并解锁 */
    async unlock(password) {
      if (!this._verifier) throw new Error('保险库未初始化');
      const key = await deriveKey(password, b64d(this._verifier.salt));
      const iv = b64d(this._verifier.iv);
      try {
        const pt = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, key, b64d(this._verifier.verifier));
        if (dec.decode(pt) !== TOKEN) throw new Error('密码错误');
      } catch (e) { throw new Error('密码错误'); }
      this.key = key; this.locked = false; return key;
    },
    isUnlocked() { return !this.locked && !!this.key; },
    /* 用派生密钥加密整个 DB */
    async seal(db) {
      if (!this.key) throw new Error('保险库未解锁');
      const iv = global.crypto.getRandomValues(new Uint8Array(12));
      const data = enc.encode(JSON.stringify(db));
      const ct = await SUBTLE.encrypt({ name: 'AES-GCM', iv }, this.key, data);
      return VA + b64(iv) + '.' + b64(ct);
    },
    /* 用派生密钥解密整个 DB */
    async unseal(stored) {
      if (!this.key) throw new Error('保险库未解锁');
      const s = ('' + stored).indexOf(VA) === 0 ? ('' + stored).slice(VA.length) : ('' + stored);
      const parts = s.split('.');
      if (parts.length !== 2) throw new Error('密文格式错误');
      const iv = b64d(parts[0]); const ct = b64d(parts[1]);
      const pt = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, this.key, ct);
      return JSON.parse(dec.decode(pt));
    },
    lock() { this.key = null; this.locked = true; }
  };

  vault.init();
  LB.vault = vault;
})(window);
