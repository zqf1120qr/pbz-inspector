/**
 * share-card.js — 生成可分享的战绩长图（Canvas 2D → PNG）
 *
 * 版面参考 samples/影之刃零_战绩.png：
 *   页眉（英文小标 + 衬线标题 + 副题 + 存档时间 + 右上立绘）
 *   → 四格数值（累计死亡 / 战斗记录 / 已击败 / 推算失败）
 *   → Boss 网格（立绘底板 + 左上难度 + 右上章节 + 右下死亡数 + 名字/最佳用时）
 *   → 页脚说明
 *
 * draw() 是异步的：需要先预载立绘再绘制。
 */
(function (global) {
  'use strict';

  var W = 1600;
  var PAD = 64;

  var C = {
    bg: '#0a0a0c',
    panel: '#131316',
    art: '#e4ddcd',
    artEdge: '#cfc6b3',
    ink: '#2a2622',
    line: 'rgba(255,255,255,0.10)',
    text: '#f4f1ec',
    dim: '#bdb8b1',
    faint: '#9d968d',
    red: '#e8503f',
    redDeep: '#b8302c',
    gold: '#d3b078'
  };

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "SimSun", Georgia, serif';
  var SANS = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  var MONO = '"SFMono-Regular", "JetBrains Mono", Consolas, monospace';

  /* 难度档位配色，与页面上 .boss-card-diff 一致 */
  var TIER = {
    1: { text: '#a8bcc6', border: 'rgba(168,188,198,0.45)' },
    2: { text: '#d3b078', border: 'rgba(211,176,120,0.5)' },
    3: { text: '#e8503f', border: 'rgba(232,80,63,0.55)' }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** 深色胶囊标签：先量宽再画，返回占位矩形 */
  function chip(ctx, x, y, text, o) {
    o = o || {};
    ctx.font = o.font;
    var padX = o.padX == null ? 13 : o.padX;
    var h = o.h == null ? 32 : o.h;
    var lead = o.lead || 0;
    var w = ctx.measureText(text).width + padX * 2 + lead;
    var px = o.align === 'right' ? x - w : x;

    ctx.save();
    ctx.fillStyle = o.bg || 'rgba(12,12,15,0.86)';
    roundRect(ctx, px, y, w, h, o.r == null ? 4 : o.r);
    ctx.fill();

    if (o.border) {
      ctx.strokeStyle = o.border;
      ctx.lineWidth = 1.2;
      roundRect(ctx, px + 0.6, y + 0.6, w - 1.2, h - 1.2, o.r == null ? 4 : o.r);
      ctx.stroke();
    }

    if (o.lead) o.leadDraw(px + padX, y + h / 2, o.lead);

    ctx.fillStyle = o.color || '#f4f1ec';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + padX + lead, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    return { x: px, y: y, w: w, h: h };
  }

  /* ---------------- 工具 ---------------- */

  function withSpacing(ctx, text, x, y, spacing, align) {
    var chars = Array.from(String(text));
    var widths = [];
    var total = 0;
    for (var i = 0; i < chars.length; i++) {
      var w = ctx.measureText(chars[i]).width;
      widths.push(w);
      total += w + spacing;
    }
    total -= spacing;
    var start = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    var prev = ctx.textAlign;
    ctx.textAlign = 'left';
    for (var j = 0; j < chars.length; j++) {
      ctx.fillText(chars[j], start, y);
      start += widths[j] + spacing;
    }
    ctx.textAlign = prev;
    return total;
  }

  function line(ctx, x1, y1, x2, y2, color) {
    ctx.save();
    ctx.strokeStyle = color || C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function fmtInt(n) {
    if (n == null || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function clip(ctx, text, maxW) {
    var s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }

  /* 小骷髅：头骨 + 下颌 + 眼窝，眼窝用底板色挖空 */
  function drawSkull(ctx, x, y, s, color, holeColor) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.06, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - s * 0.2, y + s * 0.16, s * 0.4, s * 0.24);

    ctx.fillStyle = holeColor;
    ctx.beginPath();
    ctx.arc(x - s * 0.16, y - s * 0.1, s * 0.13, 0, Math.PI * 2);
    ctx.arc(x + s * 0.16, y - s * 0.1, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - s * 0.03, y + s * 0.06, s * 0.06, s * 0.1);
    ctx.restore();
  }

  /* 确定性伪随机：同一份存档导出的图永远逐字节一致 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function noise(ctx, w, h, n, seed) {
    var rand = mulberry32(seed);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.022)';
    for (var i = 0; i < n; i++) {
      ctx.fillRect(rand() * w, rand() * h, 1, 1);
    }
    ctx.restore();
  }

  /* ---------------- 主绘制 ---------------- */

  async function draw(view, opts) {
    opts = opts || {};
    var bosses = (view.bosses || []).slice();
    var shown = bosses;

    var COLS = 4;
    var GAP = 20;
    var CARD_W = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
    var ART_H = Math.round(CARD_W * 0.84);
    var INFO_H = 108;
    var CARD_H = ART_H + INFO_H;
    var ROW_GAP = 26;

    var HEADER_H = 300;
    var STAT_Y = HEADER_H + 6;
    var STAT_H = 118;
    var SEC_Y = STAT_Y + STAT_H + 62;
    var GRID_Y = SEC_Y + 36;

    var rows = Math.max(1, Math.ceil(shown.length / COLS));
    var gridH = rows * CARD_H + (rows - 1) * ROW_GAP;
    var FOOT_Y = GRID_Y + gridH + 66;
    var H = FOOT_Y + 104;

    // 预载立绘
    var images = await Promise.all(shown.map(function (b) {
      return loadImage(b.img);
    }));
    var heroImg = images[0] || null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    /* ---------- 背景 ---------- */
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    var glow = ctx.createRadialGradient(W * 0.18, -180, 0, W * 0.18, -180, 1100);
    glow.addColorStop(0, 'rgba(180,44,40,0.26)');
    glow.addColorStop(0.6, 'rgba(150,36,34,0.05)');
    glow.addColorStop(1, 'rgba(150,36,34,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 760);

    /* 右上：头号苦主立绘，淡出到背景（裁剪在页眉区内，避免溢到数值格） */
    if (heroImg) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, HEADER_H + 4);
      ctx.clip();

      var hh = 600;
      var hw = hh * (heroImg.width / heroImg.height);
      var hx = W - hw * 0.46;
      var hy = -96;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(heroImg, hx, hy, hw, hh);
      ctx.globalAlpha = 1;

      var fade = ctx.createLinearGradient(W * 0.34, 0, W, 0);
      fade.addColorStop(0, 'rgba(10,10,12,1)');
      fade.addColorStop(0.34, 'rgba(10,10,12,0.92)');
      fade.addColorStop(0.72, 'rgba(10,10,12,0.16)');
      fade.addColorStop(1, 'rgba(10,10,12,0.62)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, HEADER_H + 4);

      var fadeY = ctx.createLinearGradient(0, HEADER_H - 190, 0, HEADER_H + 4);
      fadeY.addColorStop(0, 'rgba(10,10,12,0)');
      fadeY.addColorStop(1, 'rgba(10,10,12,1)');
      ctx.fillStyle = fadeY;
      ctx.fillRect(0, HEADER_H - 190, W, 200);
      ctx.restore();
    }

    /* 朱砂斜线 */
    ctx.save();
    ctx.strokeStyle = 'rgba(205,52,48,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W - 470, 0);
    ctx.lineTo(W, HEADER_H - 24);
    ctx.stroke();
    ctx.restore();

    /* ---------- 页眉 ---------- */
    ctx.fillStyle = C.faint;
    ctx.font = '600 19px ' + SANS;
    withSpacing(ctx, 'PHANTOM BLADE ZERO / BATTLE RECORD', PAD, 64, 5);

    /* 右上角：线上地址。放在页眉而不是页脚——战绩图会被转发，
       底部那行细字八成没人看到。朱砂斜线正好从这块穿过去，
       所以给一层压暗的底板，顺带把网址衬得更醒目。
       换域名时 index.html 的两处链接要一起改。 */
    var siteUrl = 'zqf1120qr.github.io/pbz-inspector';
    ctx.font = '400 26px ' + MONO;
    var siteUrlW = ctx.measureText(siteUrl).width;
    ctx.font = '400 17px ' + SANS;
    var siteLabelW = ctx.measureText('在线解析').width;

    var siteW = Math.max(siteUrlW, siteLabelW) + 36;
    var siteX = W - PAD - siteW;
    var siteY = 34;
    var siteH = 72;

    ctx.save();
    roundRect(ctx, siteX, siteY, siteW, siteH, 3);
    ctx.fillStyle = 'rgba(8,8,10,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(211,176,120,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = C.faint;
    ctx.font = '400 17px ' + SANS;
    ctx.fillText('在线解析', siteX + 18, siteY + 26);

    ctx.fillStyle = '#d0c8bd';
    ctx.font = '400 26px ' + MONO;
    ctx.fillText(siteUrl, siteX + 18, siteY + 60);

    ctx.fillStyle = C.text;
    ctx.font = '600 104px ' + SERIF;
    withSpacing(ctx, '影之刃零', PAD, 190, 12);

    var sub = [];
    if (view.difficulty) sub.push(view.difficulty);
    if (view.day != null) sub.push('第 ' + view.day + ' / ' + (view.dayLimit || 66) + ' 天');
    if (view.playTimeText) sub.push('游玩 ' + view.playTimeText);
    ctx.fillStyle = C.dim;
    ctx.font = '400 31px ' + SANS;
    withSpacing(ctx, sub.join(' · '), PAD, 243, 2);

    ctx.fillStyle = C.faint;
    ctx.font = '400 20px ' + MONO;
    ctx.fillText((view.savedAt || opts.dateText || '').replace(/-/g, '.'), PAD, 276);

    line(ctx, PAD, HEADER_H, W - PAD, HEADER_H, 'rgba(255,255,255,0.13)');

    /* ---------- 四格数值 ---------- */
    var bossDeaths = 0;
    for (var i = 0; i < bosses.length; i++) bossDeaths += bosses[i].deaths || 0;

    var stats = [
      { label: '累计死亡', value: fmtInt(view.deathCount) },
      { label: '战斗记录', value: String(view.bossTotal || 0) },
      { label: '已击败记录', value: String(view.bossDefeated || 0) },
      { label: '推算失败', value: fmtInt(bossDeaths) }
    ];

    var cellW = (W - PAD * 2 - GAP * 3) / 4;
    for (var s = 0; s < stats.length; s++) {
      var sx = PAD + (cellW + GAP) * s;
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      ctx.fillRect(sx, STAT_Y, cellW, STAT_H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, STAT_Y + 0.5, cellW - 1, STAT_H - 1);

      ctx.fillStyle = C.red;
      ctx.fillRect(sx, STAT_Y, 2, STAT_H);

      ctx.fillStyle = C.text;
      ctx.font = '600 60px ' + SERIF;
      ctx.fillText(stats[s].value, sx + 24, STAT_Y + 80);

      var vw = ctx.measureText(stats[s].value).width;
      ctx.fillStyle = C.faint;
      ctx.font = '400 21px ' + SANS;
      ctx.fillText(stats[s].label, sx + 34 + vw, STAT_Y + 76);
    }

    /* ---------- 段标题 ---------- */
    ctx.fillStyle = C.text;
    ctx.font = '600 33px ' + SERIF;
    withSpacing(ctx, '刀下见真章', PAD, SEC_Y, 7);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.font = '400 19px ' + MONO;
    ctx.fillText((view.bossDefeated || 0) + ' / ' + (view.bossTotal || 0) + ' 已击破', W - PAD, SEC_Y);
    ctx.textAlign = 'left';

    /* 只有存在多周目记录时，周目才有信息量；否则不占版面（存档里周目从 0 起算，展示 +1） */
    var multiCycle = false;
    for (var c = 0; c < bosses.length; c++) {
      if ((bosses[c].cycleLabels || []).length > 1) { multiCycle = true; break; }
    }

    /* ---------- Boss 网格 ---------- */
    for (var k = 0; k < shown.length; k++) {
      var b = shown[k];
      var col = k % COLS;
      var row = Math.floor(k / COLS);
      var x = PAD + (CARD_W + GAP) * col;
      var y = GRID_Y + (CARD_H + ROW_GAP) * row;

      // 卡片底
      ctx.fillStyle = C.panel;
      ctx.fillRect(x, y, CARD_W, CARD_H);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1);

      // 立绘底板
      ctx.fillStyle = C.art;
      ctx.fillRect(x + 1, y + 1, CARD_W - 2, ART_H - 1);

      var img = images[k];
      if (img) {
        var scale = Math.min((CARD_W - 16) / img.width, (ART_H - 18) / img.height);
        var dw = img.width * scale;
        var dh = img.height * scale;
        ctx.drawImage(img, x + (CARD_W - dw) / 2, y + ART_H - 10 - dh, dw, dh);
      } else {
        ctx.fillStyle = 'rgba(42,38,34,0.16)';
        ctx.font = '600 64px ' + SERIF;
        ctx.textAlign = 'center';
        ctx.fillText(String(b.display || '?').slice(0, 1), x + CARD_W / 2, y + ART_H / 2 + 22);
        ctx.textAlign = 'left';
      }

      // 左上：难度（深色胶囊 + 档位配色，和页面卡片一致）
      if (b.difficulty) {
        var tier = TIER[b.difficultyByte] || { text: '#e9e4dc', border: 'rgba(255,255,255,0.28)' };
        chip(ctx, x + 12, y + 12, b.difficulty, {
          font: '600 23px ' + SANS,
          h: 37,
          bg: 'rgba(10,10,13,0.9)',
          color: tier.text,
          border: tier.border
        });
      }

      // 右上：所属章节（与页面 .boss-card-region 对应，中性色，不与左上的难度抢眼）
      // 多段遭遇的首领跨章节登场，图鉴给的是首见章节，写死会误导 → 只标「多处登场」
      var regionText = b.merged ? '多处登场' : b.region;
      if (regionText) {
        chip(ctx, x + CARD_W - 12, y + 12, regionText, {
          font: '500 19px ' + SANS,
          h: 37,
          bg: 'rgba(10,10,13,0.7)',
          color: 'rgba(228,223,214,0.92)',
          border: 'rgba(255,255,255,0.2)',
          align: 'right'
        });
      }

      // 左下：多段遭遇标记（与页面 .boss-card-multi 对应，提示战绩为累计值）
      if (b.merged) {
        chip(ctx, x + 12, y + ART_H - 44, b.encounterCount + ' 段合并', {
          font: '500 17px ' + SANS,
          h: 32,
          padX: 11,
          bg: 'rgba(10,10,13,0.84)',
          color: C.gold,
          border: 'rgba(211,176,120,0.42)'
        });
      }

      // 右下：死亡数（骷髅 + 朱砂数字）
      if (b.deaths != null && b.deaths > 0) {
        chip(ctx, x + CARD_W - 12, y + ART_H - 56, String(b.deaths), {
          font: '700 34px ' + SERIF,
          h: 44,
          padX: 13,
          bg: 'rgba(10,10,13,0.92)',
          color: C.red,
          border: 'rgba(232,80,63,0.5)',
          align: 'right',
          lead: 28,
          leadDraw: function (lx, cy, size) {
            drawSkull(ctx, lx + size / 2, cy + 1, size, C.red, '#0a0a0d');
          }
        });
      }

      // 信息条
      var cycText = '';
      if (multiCycle && b.cycleLabels && b.cycleLabels.length) {
        var cl = b.cycleLabels;
        cycText = (cl.length > 1 ? cl[0] + '–' + cl[cl.length - 1] : cl[0]) + ' 周目';
      }
      var cycW = 0;
      if (cycText) {
        ctx.font = '400 18px ' + SANS;
        cycW = ctx.measureText(cycText).width + 16;
      }

      ctx.fillStyle = C.text;
      ctx.font = '500 25px ' + SANS;
      var nm = clip(ctx, b.display || b.name || b.rawName, CARD_W - 28 - cycW);
      ctx.fillText(nm, x + 14, y + ART_H + 38);

      if (cycText) {
        ctx.textAlign = 'right';
        ctx.fillStyle = C.faint;
        ctx.font = '400 18px ' + SANS;
        ctx.fillText(cycText, x + CARD_W - 14, y + ART_H + 36);
        ctx.textAlign = 'left';
      }

      ctx.fillStyle = b.defeated === false ? C.faint : C.dim;
      ctx.font = '400 19px ' + SANS;
      var timeText = b.defeated === false
        ? '尚未击败'
        : '最佳用时 ' + (b.bestTime || '—');
      ctx.fillText(timeText, x + 14, y + ART_H + 74);

      if (b.attempts != null) {
        ctx.textAlign = 'right';
        ctx.fillStyle = C.faint;
        ctx.font = '400 18px ' + SANS;
        ctx.fillText('挑战 ' + b.attempts + ' 次', x + CARD_W - 14, y + ART_H + 74);
        ctx.textAlign = 'left';
      }
    }

    /* ---------- 收藏汇总（一行，不放图标：图太长会糊） ---------- */
    var gear = [];
    if (view.weapons && view.weapons.count) {
      gear.push('武器 ' + view.weapons.count + (view.weapons.total ? '/' + view.weapons.total : ''));
    }
    if (view.edges && view.edges.count) {
      gear.push('影之武装 ' + view.edges.count + (view.edges.total ? '/' + view.edges.total : ''));
    }
    if (view.accessories && view.accessories.count) {
      gear.push('饰品 ' + view.accessories.count + (view.accessories.total ? '/' + view.accessories.total : ''));
    }
    if (view.medicines && view.medicines.count) {
      gear.push('药瓶 ' + view.medicines.count + (view.medicines.total ? '/' + view.medicines.total : ''));
    }
    if (gear.length) {
      ctx.textAlign = 'right';
      ctx.fillStyle = C.faint;
      ctx.font = '400 19px ' + SANS;
      ctx.fillText('图鉴  ' + gear.join(' · '), W - PAD, FOOT_Y - 30);
      ctx.textAlign = 'left';
    }

    /* ---------- 页脚 ---------- */
    line(ctx, PAD, FOOT_Y, W - PAD, FOOT_Y, 'rgba(255,255,255,0.10)');

    ctx.textAlign = 'center';
    ctx.fillStyle = C.faint;
    ctx.font = '400 18px ' + SANS;
    ctx.fillText('红色数字 = 挑战次数 − 击败次数，为推算的失败次数，不保证等于实际死亡。', W / 2, FOOT_Y + 38);
    ctx.fillText('人物图片 © 各自权利人 · 不同周目、难度与形态按独立记录展示。', W / 2, FOOT_Y + 68);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#4a4744';
    ctx.font = '400 15px ' + MONO;
    ctx.fillText('parsed locally in browser', PAD, FOOT_Y + 68);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.font = '400 17px ' + SANS;
    ctx.fillText('影之刃零 · 存档解析', W - PAD, FOOT_Y + 68);
    ctx.textAlign = 'left';

    // 种子取自存档内容：同一份存档稳定复现，不同存档纹理不同
    var seed = ((view.deathCount || 0) * 2654435761) ^
      ((view.bossTotal || 0) << 16) ^
      ((view.playTimeSeconds || 0) & 0xffff);
    noise(ctx, W, H, 3200, seed);

    return canvas;
  }

  function download(canvas, filename) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        if (!blob) return resolve(false);
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        resolve(true);
      }, 'image/png');
    });
  }

  global.PBZ = global.PBZ || {};
  global.PBZ.ShareCard = { draw: draw, download: download };
})(typeof window !== 'undefined' ? window : globalThis);
