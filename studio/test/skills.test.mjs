// 代理的 skills 同步（lib/skills.mjs）：找得到 synced/ 底下的、取最新的一份、白名單拿掉的會刪、別人放的不動
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { availableSkills, syncSkills } from '../lib/skills.mjs';

test('availableSkills 與 syncSkills', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-')), src = join(root, 'src'), home = join(root, 'home');
  const mk = (dir, body, t) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), body); if (t) utimesSync(join(dir, 'SKILL.md'), t, t); };
  try {
    mk(join(src, 'deck'), 'local');
    mk(join(src, 'synced', 'a', 'pptx'), 'old', new Date('2026-01-01'));
    mk(join(src, 'synced', 'b', 'pptx'), 'new', new Date('2026-11-01'));
    mkdirSync(join(src, 'not-a-skill'), { recursive: true });
    const av = availableSkills(src);
    assert.deepEqual(Object.keys(av).sort(), ['deck', 'pptx']);
    mk(join(home, 'skills', 'mine'), 'someone else');
    let r = syncSkills(home, ['deck', 'pptx', 'nope'], { available: av });
    assert.deepEqual(r, { copied: ['deck', 'pptx'], removed: [], missing: ['nope'] });
    assert.equal(readFileSync(join(home, 'skills', 'pptx', 'SKILL.md'), 'utf8'), 'new');
    r = syncSkills(home, ['deck'], { available: av });
    assert.deepEqual(r.removed, ['pptx']);
    assert.ok(!existsSync(join(home, 'skills', 'pptx')) && existsSync(join(home, 'skills', 'mine')), '只刪自己放的');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
