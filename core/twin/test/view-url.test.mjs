// ?twin= 的網址：只給埠號時，本機／內網開的頁面連同一台主機，Pages 與 file:// 連 127.0.0.1
import test from 'node:test';
import assert from 'node:assert/strict';
import { twinUrl } from '../view.js';

const at = href => { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname }; };

test('只給埠號：依頁面來源決定主機', () => {
  assert.equal(twinUrl('8776', at('http://127.0.0.1:8770/MilitaryGradePC/')), 'http://127.0.0.1:8776/events');
  assert.equal(twinUrl('8776', at('http://localhost:8770/')), 'http://localhost:8776/events');
  assert.equal(twinUrl('8776', at('http://192.168.1.23:8770/MilitaryGradePC/')), 'http://192.168.1.23:8776/events', '內網其他電腦開頁面');
  assert.equal(twinUrl('8776', at('http://10.0.5.7:8770/')), 'http://10.0.5.7:8776/events');
  assert.equal(twinUrl('8776', at('http://172.20.0.4:8770/')), 'http://172.20.0.4:8776/events');
  assert.equal(twinUrl('8776', at('http://spe-host.local:8770/')), 'http://spe-host.local:8776/events');
  assert.equal(twinUrl('8776', at('http://[::1]:8770/')), 'http://[::1]:8776/events');
  assert.equal(twinUrl('8776', at('https://example.github.io/spe/MilitaryGradePC/')), 'http://127.0.0.1:8776/events', 'Pages：連自己電腦');
  assert.equal(twinUrl('8776', at('http://172.32.0.1:8770/')), 'http://127.0.0.1:8776/events', '172.32 不是私有網段');
  assert.equal(twinUrl('8776', { protocol: 'file:', hostname: '' }), 'http://127.0.0.1:8776/events', '匯出的離線檔');
  assert.equal(twinUrl('8776', undefined), 'http://127.0.0.1:8776/events', 'Node 端沒有 location');
});

test('完整網址照用，補上 /events', () => {
  assert.equal(twinUrl('http://192.168.1.5:9000'), 'http://192.168.1.5:9000/events');
  assert.equal(twinUrl('http://192.168.1.5:9000/'), 'http://192.168.1.5:9000/events');
  assert.equal(twinUrl('http://192.168.1.5:9000/events'), 'http://192.168.1.5:9000/events');
  assert.equal(twinUrl(''), null);
});
