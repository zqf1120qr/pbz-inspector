#!/usr/bin/env node
/**
 * tools/audit-save.js — 存档结构审计（开发参考用）
 *
 * 与 test-real.js 的区别：那个是跑一遍指标提取验证功能，
 * 这个是把解密后的 JSON 结构完整摊开，用来回答「某个数据到底有没有存」。
 *
 * 用法：
 *   node tools/audit-save.js [存档路径]
 * 默认读取项目根目录的 PBZSaveGame.sav。
 *
 * 输出：
 *   1. 槽位表（名称 / 压缩算法 / 原始大小 / 偏移）
 *   2. 每个槽位的顶层键清单及规模
 *   3. 全量递归搜索时间类字段（time / duration / elapsed / cost / timer）
 *   4. BossRecord 原始结构
 *   5. 可选：--dump 写出完整 JSON 便于二次分析
 */
'use strict';

const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;   // pbzs.js 以 window/globalThis 为宿主
const Save = require('../js/pbzs.js');

const ROOT = path.dirname(__dirname);
const TIME_RE = /time|duration|elapsed|cost|spend|second|millisec|timer|clock/i;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function sizeOf(v) {
  if (Array.isArray(v)) return v.length + ' 项';
  if (v && typeof v === 'object') return Object.keys(v).length + ' 键';
  if (typeof v === 'string') return v.length + ' 字符';
  return String(v).slice(0, 30);
}

async function main() {
  const args = process.argv.slice(2);
  const dump = args.includes('--dump');
  const file = args.filter(a => !a.startsWith('--'))[0] ||
    path.join(ROOT, 'PBZSaveGame.sav');

  if (!fs.existsSync(file)) {
    console.error('找不到存档：' + file);
    console.error('用法：node tools/audit-save.js [存档路径] [--dump]');
    process.exit(1);
  }

  const buf = fs.readFileSync(file);
  console.log('存档：' + file + '（' + buf.length + ' 字节）');

  const save = await Save.open(buf);
  console.log('容器：PBZS v' + save.header.version + '，' + save.header.slotCount + ' 槽位，目录 ' + save.header.directorySize + ' 字节\n');

  console.table(save.slots.map(s => ({
    槽位: s.name, 算法: s.algorithm, 原始大小: s.rawSize, 偏移: s.offset, 块大小: s.blockSize
  })));

  const parsed = {};
  for (const slot of save.slots) {
    parsed[slot.name] = await save.readJson(slot);
  }

  for (const name of Object.keys(parsed)) {
    const j = parsed[name];
    if (!j || typeof j !== 'object') continue;
    const keys = Object.keys(j);
    console.log('\n【' + name + '】' + keys.length + ' 个顶层键');
    console.table(keys.map(k => ({ 键: k, 类型: typeOf(j[k]), 规模: sizeOf(j[k]) })));
  }

  console.log('\n=== 时间类字段穷举（不限深度） ===');
  const hits = [];
  function walk(o, p, d) {
    if (d > 8 || !o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      const np = p ? p + '.' + k : k;
      if (TIME_RE.test(k)) hits.push({ path: np, type: typeOf(v), value: JSON.stringify(v).slice(0, 60) });
      walk(v, np, d + 1);
    }
  }
  for (const slot of Object.keys(parsed)) walk(parsed[slot], slot, 0);

  const bossHits = hits.filter(h => /Boss/i.test(h.path));
  console.log('\nBoss 相关（这是判断「战斗时长」有无的唯一依据）：');
  if (!bossHits.length) console.log('  （无）');
  bossHits.forEach(h => console.log('  ' + h.path + '  = ' + h.value));

  const uniq = {};
  hits.filter(h => !/Boss/i.test(h.path)).forEach(h => {
    const tail = h.path.split('.').filter(s => !/^\d+$/.test(s)).slice(-1)[0];
    if (!uniq[tail]) uniq[tail] = { n: 0, sample: h.value, path: h.path };
    uniq[tail].n++;
  });
  console.log('\n其它命中（按字段名归并）：');
  Object.entries(uniq).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => {
    console.log('  ' + k.padEnd(22) + ' ×' + String(v.n).padStart(3) + '   ' + v.sample + '   ← ' + v.path);
  });

  console.log('\n=== BossRecord 原始结构 ===');
  const br = (parsed.AutoSave1 || parsed[save.slots[0].name] || {}).BossRecord || {};
  console.log(JSON.stringify(br, null, 1));

  if (dump) {
    const out = path.join(ROOT, '.save-dump.json');
    fs.writeFileSync(out, JSON.stringify(parsed, null, 1));
    console.log('\n完整数据已写入 ' + out);
  }
}

main().catch(err => {
  console.error('失败：' + err.message);
  process.exit(1);
});
