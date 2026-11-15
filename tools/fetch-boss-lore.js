#!/usr/bin/env node
/**
 * tools/fetch-boss-lore.js — 抓取 BOSS 简介，生成 js/boss-lore.js
 *
 * 数据来源：游民星空《影之刃零》图鉴（BOSS 分类）
 *   列表 https://renderer.gamersky.com/gameWiki/web/wikis/16/categories/1793009175006/entries?cursor=N
 *   详情 https://renderer.gamersky.com/gameWiki/web/wikis/16/entries/{id}
 *
 * 简介正文在详情接口的 moduleValues.{moduleId}.html 里（列表接口的 summary 只有 120 字）。
 * 以 gameInternalId（BP_Monster_xxx）为键，与 boss-atlas.js 的主键一致。
 *
 * 文案版权归 S-GAME / 游民星空所有，此处仅用于非商业的玩家工具展示。
 *
 * 用法：node tools/fetch-boss-lore.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const WIKI_ID = 16;
const CATEGORY_ID = 1793009175006;
const LIST_API = 'https://renderer.gamersky.com/gameWiki/web/wikis/%d/categories/%s/entries?cursor=%s';
const DETAIL_API = 'https://renderer.gamersky.com/gameWiki/web/wikis/%d/entries/%s';

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'js', 'boss-lore.js');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('超时 ' + url)));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function htmlToParagraphs(html) {
  if (!html) return [];
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function fetchList() {
  const rows = [];
  const seen = new Set();
  let cursor = '0';
  while (true) {
    const payload = JSON.parse(await get(LIST_API.replace('%d', WIKI_ID).replace('%s', CATEGORY_ID).replace('%s', cursor)));
    const data = payload.data;
    for (const item of data.items) {
      if (!item.name || seen.has(item.name)) continue;
      seen.add(item.name);
      const v = item.values || {};
      rows.push({
        entryId: item.id,
        name: item.name,
        codexId: String(v.codexId || ''),
        gameInternalId: v.gameInternalId || '',
        region: v['field-1793592000025-region'] || ''
      });
    }
    const next = data.nextCursor;
    if (!next || String(next) === 'None') break;
    cursor = String(next);
  }
  return rows;
}

async function main() {
  const rows = await fetchList();
  if (!rows.length) throw new Error('没有抓到条目，接口可能已变');
  console.log('列表条目：' + rows.length);

  const byId = {};
  let done = 0;
  let withLore = 0;

  for (const r of rows) {
    if (!r.gameInternalId) continue;
    let detail;
    try {
      detail = JSON.parse(await get(DETAIL_API.replace('%d', WIKI_ID).replace('%s', r.entryId)));
    } catch (e) {
      console.warn('  跳过 ' + r.name + '：' + e.message);
      continue;
    }
    const entry = (detail.data && detail.data.entry) || {};
    const mv = entry.moduleValues || {};

    let summary = [];
    let guide = '';
    for (const id of Object.keys(mv)) {
      const block = mv[id] || {};
      if (!summary.length && block.html) summary = htmlToParagraphs(block.html);
      for (const f of block.fields || []) {
        if (f && /guide$/.test(String(f.id)) && f.value) guide = String(f.value);
      }
    }

    byId[r.gameInternalId] = {
      name: r.name,
      codexId: r.codexId,
      region: r.region,
      subtitle: entry.subtitle || 'BOSS',
      summary: summary,
      guide: guide
    };
    if (summary.length) withLore++;
    done++;
    if (done % 10 === 0) console.log('  已处理 ' + done + ' / ' + rows.length);
    await sleep(120);
  }

  const lines = [
    '/**',
    ' * boss-lore.js — BOSS 简介与出处',
    ' *',
    ' * ' + done + ' 个条目，简介正文抓自游民星空《影之刃零》图鉴的详情接口。',
    ' * 由 tools/fetch-boss-lore.js 生成，请勿手改。',
    ' *',
    ' * 以 gameInternalId（BP_Monster_xxx）为键，与 boss-atlas.js 的主键一致。',
    ' * summary 是纯文本段落数组（已去标签），渲染时需自行转义。',
    ' * 文案版权归 S-GAME / 游民星空所有，仅用于非商业的玩家工具展示。',
    ' */',
    '(function (global) {',
    "  'use strict';",
    '',
    '  var BY_ID = ' + JSON.stringify(byId, null, 2).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n') + ';',
    '',
    '  global.PBZBossLore = {',
    '    byId: BY_ID,',
    '    byCodex: (function () {',
    '      var m = {};',
    '      for (var k in BY_ID) { if (BY_ID[k].codexId) m[BY_ID[k].codexId] = BY_ID[k]; }',
    '      return m;',
    '    })(),',
    '    count: ' + done + ',',
    "    source: '游民星空《影之刃零》图鉴'",
    '  };',
    '})(window);',
    ''
  ];

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('完成：' + done + ' 条，其中 ' + withLore + ' 条带简介');
  console.log('已写入 ' + path.relative(ROOT, OUT) + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');
}

main().catch(err => {
  console.error('失败：' + err.message);
  process.exit(1);
});
