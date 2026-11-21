#!/usr/bin/env node
/**
 * tools/fetch-item-icons.js — 抓图鉴图标并缩到 96px，输出到 assets/items/
 *
 * 图鉴条目带 coverUrl（256×256 透明底 PNG）。页面里按 44px 显示，
 * 2 倍屏需要 88px，所以统一缩到 96px，体积从 ~1.9 MB 压到 ~0.5 MB。
 *
 * 缩放走浏览器 canvas（png 无第三方依赖）：
 *   Node 下载字节 → base64 传给无头浏览器 → ImageBitmap → canvas → PNG
 * 之所以不在页面里直接 fetch，是因为 img1.gamersky.com 没有 CORS 头，
 * 跨域图片会把 canvas 标脏，读不出像素。
 *
 * 用法：node tools/fetch-item-icons.js
 * 依赖：playwright-core（与 tools/test-ui.js 共用，npm i 即装）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const WIKI_ID = 16;
const BASE = 'https://renderer.gamersky.com/gameWiki/web';
const SIZE = 96;
const OUT = path.join(path.dirname(__dirname), 'assets', 'items');

const CATS = {
  weapon: 1792459412079,
  shaqi: 1792459556723,
  medicine: 1792459583567,
  accessory: 1792459552619
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://www.gamersky.com/'
};

function detectBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  return chromium.executablePath();
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  const j = await r.json();
  if (j.code !== 0) throw new Error(url + ' → ' + (j.message || 'code ' + j.code));
  return j.data;
}

async function entries(categoryId) {
  const out = [];
  let cursor = '';
  for (let guard = 0; guard < 20; guard++) {
    const q = new URLSearchParams({ pageSize: '100' });
    if (cursor) q.set('cursor', cursor);
    const data = await getJson(BASE + '/wikis/' + WIKI_ID + '/categories/' + categoryId + '/entries?' + q);
    const list = data.items || data.entries || data.list || [];
    list.forEach(e => out.push(e));
    cursor = data.nextCursor || '';
    if (!cursor || !list.length) break;
  }
  return out;
}

/** 在页面里把 base64 图片缩到 SIZE×SIZE，返回 PNG dataURL */
async function makeResizer(page) {
  await page.goto('about:blank');
  return (b64) => page.evaluate(async ([b64, size]) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // 保持比例居中，四周留一点呼吸空间
    const scale = Math.min(size / bmp.width, size / bmp.height) * 0.94;
    const w = bmp.width * scale;
    const h = bmp.height * scale;
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
    bmp.close();
    return canvas.toDataURL('image/png');
  }, [b64, SIZE]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: detectBrowser() });
  const page = await browser.newPage();
  const resize = await makeResizer(page);

  let saved = 0, skipped = 0, bytes = 0;
  const missing = [];

  for (const [key, cid] of Object.entries(CATS)) {
    const list = await entries(cid);
    for (const e of list) {
      const id = e.values && e.values.gameInternalId;
      if (!id) { missing.push(key + ':条目无内部 ID'); continue; }

      const file = path.join(OUT, id + '.png');
      if (fs.existsSync(file)) { skipped++; continue; }

      if (!e.coverUrl) { missing.push(id + '（无 coverUrl）'); continue; }

      const r = await fetch(e.coverUrl, { headers: HEADERS });
      if (!r.ok) { missing.push(id + '（HTTP ' + r.status + '）'); continue; }
      const buf = Buffer.from(await r.arrayBuffer());

      const dataUrl = await resize(buf.toString('base64'));
      const out = Buffer.from(dataUrl.split(',')[1], 'base64');
      fs.writeFileSync(file, out);
      bytes += out.length;
      saved++;
      process.stdout.write('.');
    }
  }

  await browser.close();

  console.log('\n新增 ' + saved + ' 个图标，跳过已存在 ' + skipped + ' 个，共 ' + (bytes / 1024).toFixed(0) + ' KB');
  if (missing.length) console.log('未能生成：\n  ' + missing.join('\n  '));
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
