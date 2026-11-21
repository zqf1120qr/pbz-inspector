#!/usr/bin/env node
/**
 * tools/fetch-item-atlas.js — 生成 js/item-atlas.js
 *
 * 数据源：游民星空《影之刃零》图鉴（wikiId 16）
 *   https://www.gamersky.com/tools/game-wiki/wiki/16
 *
 * 图鉴每个条目都带 values.gameInternalId，正好等于存档里的键名，
 * 所以这份表是「存档 ID → 官方中文名」的权威对照，不要手工改动中文名。
 *
 * 前端懒加载，HTML 里只有首屏 20 条，全量走 JSON 接口：
 *   {webApiBaseUrl}/wikis/16/categories/{categoryId}/entries?pageSize=100
 *
 * 用法：node tools/fetch-item-atlas.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WIKI_ID = 16;
const BASE = 'https://renderer.gamersky.com/gameWiki/web';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://www.gamersky.com/'
};

/** 存档里的四个图鉴分区。key 与 pbz-view.js 的 collect* 对应 */
const CATS = [
  { key: 'weapon', label: '武器', id: 1792459412079 },
  { key: 'shaqi', label: '影之武装', id: 1792459556723 },
  { key: 'medicine', label: '药瓶', id: 1792459583567 },
  { key: 'accessory', label: '饰品', id: 1792459552619 }
];

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  const j = await r.json();
  if (j.code !== 0) throw new Error(url + ' → ' + (j.message || 'code ' + j.code));
  return j.data;
}

async function fetchEntries(categoryId) {
  const out = [];
  let cursor = '';
  for (let guard = 0; guard < 20; guard++) {
    const q = new URLSearchParams({ pageSize: '100' });
    if (cursor) q.set('cursor', cursor);
    const data = await getJson(
      BASE + '/wikis/' + WIKI_ID + '/categories/' + categoryId + '/entries?' + q
    );
    const list = data.entries || data.list || data.items || [];
    list.forEach(e => out.push(e));
    cursor = data.nextCursor || (data.pagination && data.pagination.nextCursor) || '';
    if (!cursor || !list.length) break;
  }
  return out;
}

function slim(e) {
  const v = e.values || {};
  return {
    id: v.gameInternalId || null,
    name: e.name || '',
    kind: e.subtitle || '',
    codex: v.codexId || '',
    summary: e.summary || ''
  };
}
async function main() {
  const cats = {};
  const byId = {};

  for (const c of CATS) {
    const raw = await fetchEntries(c.id);
    const list = raw.map(slim).filter(x => x.id);
    list.sort((a, b) => String(a.codex).localeCompare(String(b.codex)));
    cats[c.key] = { label: c.label, categoryId: c.id, total: list.length, list };
    list.forEach(x => {
      byId[x.id] = { id: x.id, name: x.name, kind: x.kind, codex: x.codex, cat: c.key, summary: x.summary };
    });
    console.log(c.label + '：' + list.length + ' 条' + (list.length !== raw.length ? '（丢弃 ' + (raw.length - list.length) + ' 条无内部 ID）' : ''));
  }

  const today = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify(byId, null, 0);
  const catBody = JSON.stringify(cats, null, 0);

  const out = `/**
 * item-atlas.js — 《影之刃零》图鉴对照表（自动生成，勿手改）
 *
 * 重新抓取：node tools/fetch-item-atlas.js
 * 数据源：游民星空图鉴 https://www.gamersky.com/tools/game-wiki/wiki/16
 * 生成日期：${today}
 *
 * 每条都带图鉴的 gameInternalId，与存档里的键名一一对应，
 * 因此 byId 是「存档 ID → 官方中文名」的权威对照。
 */
(function (global) {
  'use strict';

  var CATEGORIES = ${catBody};

  var BY_ID = ${body};

  /* 存档里偶有大小写与图鉴不一致的键（如 Kuye / KuYe），补一层小写索引 */
  var BY_LOWER = {};
  for (var k in BY_ID) {
    if (!Object.prototype.hasOwnProperty.call(BY_ID, k)) continue;
    var lower = k.toLowerCase();
    if (!BY_LOWER[lower]) BY_LOWER[lower] = BY_ID[k];
  }

  /** 存档 ID → { name, kind, codex, cat, summary }；找不到返回 null */
  function lookup(id) {
    if (id == null) return null;
    var key = String(id);
    return BY_ID[key] || BY_LOWER[key.toLowerCase()] || null;
  }

  /** 取某个分区的全部条目；未知分区返回 [] */
  function list(cat) {
    var c = CATEGORIES[cat];
    return c ? c.list : [];
  }

  function total(cat) {
    var c = CATEGORIES[cat];
    return c ? c.total : 0;
  }

  /** 存档 ID → 中文名，找不到时返回 null（调用方可退回 prettyId） */
  function name(id) {
    var hit = lookup(id);
    return hit ? hit.name : null;
  }

  global.PBZItemAtlas = {
    generated: '${today}',
    source: 'https://www.gamersky.com/tools/game-wiki/wiki/16',
    categories: CATEGORIES,
    byId: BY_ID,
    lookup: lookup,
    list: list,
    total: total,
    name: name
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

  const file = path.join(path.dirname(__dirname), 'js', 'item-atlas.js');
  fs.writeFileSync(file, out);
  console.log('\n已写入 ' + file + '（' + Buffer.byteLength(out) + ' 字节，' + Object.keys(byId).length + ' 条）');
}

main().catch(e => { console.error('失败：' + e.message); process.exit(1); });
