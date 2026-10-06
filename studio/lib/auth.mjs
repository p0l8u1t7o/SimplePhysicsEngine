// 登入帳號與權限（2026-10-05）。帳號存在本機 studio/data/users.json（不進版控），密碼只存 scrypt 雜湊；操作紀錄在 studio/data/audit.jsonl。
// - 還沒有任何帳號時不需要登入（單機模式，和以前一樣）；建立第一個管理者之後，介面、API、專案檔案都要登入。
// - 命令列不經過這裡：能在這台電腦開終端機的人本來就能動檔案。
// - 角色：admin 管理者（全部，含帳號與設定）、editor 一般（執行流程、改元件、建立與刪除專案）、viewer 唯讀（只能看）。
// - 登入狀態是簽章過的 cookie（帳號、到期時間、帳號的版本號）；改密碼、改角色、停用、刪除帳號都會讓舊的 cookie 失效。
// - 登入失敗次數限制（2026-10-06）：同一個帳號或同一個來源 IP 在 15 分鐘內錯 5 次，鎖 15 分鐘（記在記憶體，重開伺服器就清掉）。
// - 依專案分權限（2026-10-06）：專案有成員（擁有者、成員）時，只有成員與管理者能執行與修改；還沒有成員的專案（舊的、本庫的站）所有一般帳號都能動。
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, scryptSync, createHmac, timingSafeEqual } from 'node:crypto';
import { STUDIO, readJson, writeJson, now } from './util.mjs';

export const ROLE_LABEL = { admin: '管理者', editor: '一般', viewer: '唯讀' };
const COOKIE = 'vs3d_session', DAYS = 7;
const NAME_RE = /^[A-Za-z0-9][\w.-]{1,31}$/;
export class AuthError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const bad = (msg, status) => { throw new AuthError(msg, status); };

const hash = (password, salt) => scryptSync(String(password), salt, 32).toString('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const pub = u => ({ name: u.name, display: u.display || u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt });

export const MEMBER_LABEL = { owner: '擁有者', member: '成員' };
// 專案權限：user 是登入的人（沒有帳號的單機模式是 null），members 是 [{ user, role }]
export function canEditProject(user, members = []) {
  if (!user || user.role === 'admin') return true;
  if (user.role === 'viewer') return false;
  return !members.length || members.some(m => m.user.toLowerCase() === user.name.toLowerCase());
}
export const canManageProject = (user, members = []) => !user || user.role === 'admin'
  || (user.role !== 'viewer' && members.some(m => m.role === 'owner' && m.user.toLowerCase() === user.name.toLowerCase()));

// 這個角色能不能做這個請求；回傳 null（可以）或拒絕的原因。path 是 /api/ 後面的片段陣列
export function denied(role, method, [a]) {
  if (a === 'auth') return null;                                  // 登入、登出、改自己的密碼
  if (a === 'users') return role === 'admin' ? null : '只有管理者可以管理帳號';
  if (a === 'secrets') return role === 'admin' ? null : '只有管理者可以看與改 API 金鑰';
  if (a === 'trash') return role === 'admin' ? null : '只有管理者可以管理回收桶';
  if (method === 'GET') return null;
  if (role === 'viewer') return '唯讀帳號不能修改';
  if ((a === 'settings' || a === 'system') && role !== 'admin') return '只有管理者可以改設定';
  return null;
}

// 帳號檔的位置可以用環境變數 VS3D_USERS 改（測試用暫存檔）
export const LOGIN_LIMIT = { max: 5, windowMs: 15 * 60e3, lockMs: 15 * 60e3 };
export function createAuth({ file = process.env.VS3D_USERS || join(STUDIO, 'data', 'users.json'), auditFile = join(dirname(file), 'audit.jsonl'), clock = Date.now, secure = false } = {}) {
  const failures = new Map();       // 'u:帳號'／'ip:位址' → { n, first, until }
  const locked = key => { const f = failures.get(key); return f && f.until > clock() ? Math.ceil((f.until - clock()) / 60e3) : 0; };
  const fail = key => {
    const t = clock(), f = failures.get(key);
    const cur = f && t - f.first < LOGIN_LIMIT.windowMs ? f : { n: 0, first: t, until: 0 };
    cur.n++; if (cur.n >= LOGIN_LIMIT.max) cur.until = t + LOGIN_LIMIT.lockMs;
    failures.set(key, cur);
  };
  let data = readJson(file, null) || { secret: randomBytes(32).toString('hex'), users: [] };
  const save = () => writeJson(file, data);
  const find = name => data.users.find(u => u.name.toLowerCase() === String(name || '').toLowerCase());
  const admins = () => data.users.filter(u => u.role === 'admin' && !u.disabled);
  const sign = body => createHmac('sha256', data.secret).update(body).digest('base64url');
  function checkPassword(p) { if (String(p || '').length < 8) bad('密碼至少 8 個字'); }
  function checkRole(r) { if (!ROLE_LABEL[r]) bad('角色只能是管理者、一般或唯讀'); }

  return {
    file,
    enabled: () => data.users.length > 0,
    list: () => data.users.map(pub),
    // 第一個帳號一定是管理者
    create({ name, display = '', role = 'editor', password }) {
      name = String(name || '').trim();
      if (!NAME_RE.test(name)) bad('帳號用英數開頭，2～32 個字，可以含 . _ -');
      if (find(name)) bad('已經有這個帳號');
      if (!data.users.length) role = 'admin';
      checkRole(role); checkPassword(password);
      const salt = randomBytes(16).toString('hex');
      data.users.push({ name, display: String(display).trim(), role, salt, hash: hash(password, salt), ver: 1, disabled: false, createdAt: now() });
      save(); return pub(find(name));
    },
    // 可以改顯示名稱、角色、停用、密碼；不能讓系統沒有可用的管理者
    update(name, v) {
      const u = find(name) || bad('找不到帳號', 404);
      const role = v.role ?? u.role, disabled = v.disabled ?? u.disabled;
      checkRole(role);
      if (u.role === 'admin' && !u.disabled && (role !== 'admin' || disabled) && admins().length === 1) bad('至少要留一個可用的管理者');
      if (v.password != null && v.password !== '') { checkPassword(v.password); u.salt = randomBytes(16).toString('hex'); u.hash = hash(v.password, u.salt); u.ver++; }
      if (role !== u.role || !!disabled !== !!u.disabled) u.ver++;
      Object.assign(u, { role, disabled: !!disabled, display: v.display != null ? String(v.display).trim() : u.display });
      save(); return pub(u);
    },
    remove(name) {
      const u = find(name) || bad('找不到帳號', 404);
      if (u.role === 'admin' && !u.disabled && admins().length === 1) bad('至少要留一個可用的管理者');
      data.users = data.users.filter(x => x !== u); save();
      return { deleted: u.name };
    },
    // 帳號或密碼錯都回同一句話；ip 給了就連來源一起計算失敗次數，鎖住時回 429
    login(name, password, { ip = '' } = {}) {
      const keys = [`u:${String(name || '').toLowerCase()}`, ...(ip ? [`ip:${ip}`] : [])];
      const wait = Math.max(...keys.map(locked));
      if (wait) bad(`登入失敗次數太多，請 ${wait} 分鐘後再試`, 429);
      const u = find(name);
      const ok = u && !u.disabled && same(hash(password, u.salt), u.hash);
      if (!u) hash(password, 'x');                                   // 帳號不存在時也算一次雜湊，回應時間差不多
      if (!ok) { keys.forEach(fail); bad('帳號或密碼不對', 401); }
      keys.forEach(k => failures.delete(k));
      const body = `${b64(u.name)}.${Date.now() + DAYS * 864e5}.${u.ver}`;
      return { user: pub(u), token: `${body}.${sign(body)}` };
    },
    verify(token) {
      const m = String(token || '').match(/^([\w-]+)\.(\d+)\.(\d+)\.([\w-]+)$/);
      if (!m || !same(sign(`${m[1]}.${m[2]}.${m[3]}`), m[4]) || +m[2] < Date.now()) return null;
      const u = find(Buffer.from(m[1], 'base64url').toString('utf8'));
      return u && !u.disabled && u.ver === +m[3] ? pub(u) : null;
    },
    fromRequest(req) {
      const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
      return m ? this.verify(m[1]) : null;
    },
    cookie: token => `${COOKIE}=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? DAYS * 86400 : 0}${secure ? '; Secure' : ''}`,
    // 給專案成員的選單：可以登入的帳號（不含停用的）
    names: () => data.users.filter(u => !u.disabled).map(u => ({ name: u.name, display: u.display || u.name, role: u.role })),
    // 操作紀錄：誰、什麼時候、做了什麼（只記會改東西的請求）
    audit(entry) { try { mkdirSync(dirname(auditFile), { recursive: true }); appendFileSync(auditFile, JSON.stringify({ at: now(), ...entry }) + '\n'); } catch { /* 記不了不影響操作 */ } },
    recent(limit = 100) {
      if (!existsSync(auditFile)) return [];
      return readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).slice(-limit).reverse().flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    },
  };
}
