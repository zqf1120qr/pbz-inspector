/**
 * pbz-view.js — 把解密后的存档 JSON 折算成页面用的战绩视图
 *
 * 影之刃零的存档槽是一份 UTF-8 JSON，字段命名是 PascalCase。
 * 这里只依赖实际观测到的字段，并对缺失字段保持宽容。
 */
(function (global) {
  'use strict';

  var DAY_LIMIT = 66;

  var DIFFICULTY = {
    1: '入阵者',
    2: '破局者',
    3: '逆天者'
  };

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }

  function formatDuration(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h <= 0) return m + ' 分钟';
    return h + ' 小时 ' + m + ' 分';
  }

  function formatClock(ms) {
    if (ms == null || !isFinite(ms) || ms <= 0) return null;
    var total = Math.round(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** 游戏内累计秒 → 时:分:秒，用于任务时间点 */
  function formatTimecode(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return null;
    var t = Math.round(sec);
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- 内部 ID 美化 ---------- */

  var ITEM_PREFIX = {
    Page: '残页',
    Book: '书卷',
    Weapon: '武器材料',
    R: '材料',
    F: '素材',
    I: '道具',
    K: '信物',
    Item: '道具',
    Medi: '丹药',
    AC: '饰品',
    Ac: '饰品材料',
    T: '令牌',
    FA: '食材',
    Return: '回城道具'
  };

  function itemCategory(key) {
    var head = String(key).split('_')[0];
    return ITEM_PREFIX[head] || '其他';
  }

  function prettyId(id) {
    return String(id)
      .replace(/^BP_Monster_/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
  }

  /* 内部 ID 的逐段词根，用于「Weapon_Material_07」这类没有社区译名的条目 */
  var ID_WORDS = {
    weapon: '武器', material: '材料', shaqi: '杀气', return: '回城', item: '道具',
    page: '残页', book: '书卷', medi: '丹药', ac: '饰品', t: '令牌',
    traversing: '穿越', piece: '碎片', weaponmaterial: '武器材料',
    ironore: '铁矿石', blacksteel: '黑钢', solvent: '溶剂', copper: '铜',
    herb: '草药', coal: '煤', gear: '齿轮', wood: '木材', jade: '玉石'
  };

  /**
   * 把存档内部 ID 变成可读中文。
   * 1) 社区对照表（js/item-names.js）精确命中
   * 2) 逐段词根翻译：Weapon_Material_07 → 武器材料 07
   * 3) 全失败则拆驼峰
   */
  function translateId(id) {
    var key = String(id);
    var table = global.PBZItemNames;
    if (table && table[key]) return table[key];

    var parts = key.split('_').filter(Boolean);
    var last = parts[parts.length - 1] || '';
    var hasNum = /^\d+$/.test(last);

    // 分类前缀：R_01001 → 材料 01001，Weapon_Material_07 → 武器材料 07
    var lead = ITEM_PREFIX[parts[0]];
    if (lead && parts.length > 1) {
      // 中间段先翻词根；与分类前缀语义重复的部分（Weapon_Material 里的 Material）直接略掉
      var mid = parts.slice(1, hasNum ? -1 : undefined).map(function (p) {
        var w = ID_WORDS[p.toLowerCase()];
        if (w && lead.indexOf(w) >= 0) return '';
        return w || p;
      }).filter(Boolean);

      if (hasNum) {
        return lead + (mid.length ? ' · ' + mid.join(' ') : '') + ' ' + last;
      }
      return lead + (mid.length ? ' · ' + mid.join(' ') : '');
    }

    var words = hasNum ? parts.slice(0, -1) : parts;

    var cn = words.map(function (p) {
      return ID_WORDS[p.toLowerCase()] || null;
    });
    var translated = cn.filter(Boolean);

    if (translated.length) {
      var head = translated.join('');
      // 含英文残段时补在后面，保持信息完整
      var rest = words.filter(function (p, i) { return !cn[i]; });
      var tail = rest.length ? ' · ' + rest.join(' ') : '';
      return head + tail + (hasNum ? ' ' + last : '');
    }

    return prettyId(key);
  }

  /* ---------- Boss ---------- */

  /**
   * 从图鉴里找对应条目。
   * 存档键形如 BP_Monster_YuCong_P1，图鉴索引以小写保存，
   * 所以先精确（忽略大小写），再去掉 BP_Monster_ 前缀，最后做前缀匹配
   * 以处理 _P2 / _FirstTime 这类阶段后缀。
   */
  function lookupBoss(atlas, key) {
    if (!atlas || !atlas.list) return null;

    var lower = String(key).toLowerCase();
    if (atlas.byId && atlas.byId[lower]) return atlas.byId[lower];

    var base = lower.replace(/^bp_monster_/, '');
    if (atlas.byBase && atlas.byBase[base]) return atlas.byBase[base];

    // 最长前缀匹配
    var best = null;
    var bestLen = 0;
    for (var i = 0; i < atlas.list.length; i++) {
      var id = String(atlas.list[i].id).toLowerCase();
      if (lower.indexOf(id) === 0 && id.length > bestLen) {
        best = atlas.list[i];
        bestLen = id.length;
      }
    }
    return best;
  }

  /**
   * 多段遭遇。
   *
   * 少数首领在同一周目里按章节反复登场，但游戏只维护一条 BossRecord：
   * 键名固定取第一个蓝图的 _01，ClassPath 被最后一次遭遇覆盖，
   * 挑战 / 击杀 / 最速天生就是累计值，存档里没有分段计数。
   * 唯一能区分「每段遭遇」的痕迹，是任务系统的 Tutorial_xxxN 记录
   * （完成时的游戏内秒 + 墙钟时间），拿来做旁证。
   *
   * 用显式规则而不是名字模糊匹配，避免把同名的其它首领误判成多段。
   */
  var ENCOUNTER_RULES = [
    // 金面具黑衣人：Tutorial_Longzhu1 / Longzhu3 …
    { key: 'BP_Monster_MoTian_LongZhu_01', quest: /^Tutorial_Longzhu\d+$/i }
  ];

  function questFileName(cls) {
    return String(cls || '').split('/').pop().split('.')[0];
  }

  function collectEncounters(narrative, bossKey) {
    var rule = null;
    for (var i = 0; i < ENCOUNTER_RULES.length; i++) {
      if (ENCOUNTER_RULES[i].key.toLowerCase() === String(bossKey).toLowerCase()) {
        rule = ENCOUNTER_RULES[i];
        break;
      }
    }
    if (!rule) return [];

    var times = (narrative && Array.isArray(narrative.QuestGameTimes)) ? narrative.QuestGameTimes : [];
    var savedQuests = (narrative && Array.isArray(narrative.NarrativeSavedQuests)) ? narrative.NarrativeSavedQuests : [];

    var savedByClass = {};
    savedQuests.forEach(function (q) {
      if (q && q.QuestClass) savedByClass[q.QuestClass] = q;
    });

    var out = [];
    times.forEach(function (t) {
      if (!t || !t.QuestClass) return;
      var file = questFileName(t.QuestClass);
      if (!rule.quest.test(file)) return;

      var saved = savedByClass[t.QuestClass] || null;
      var branches = (saved && Array.isArray(saved.QuestBranches)) ? saved.QuestBranches : [];
      var branch = branches.length ? branches[0] : null;
      var completed = saved
        ? /succe|finish|complet/i.test(String(saved.QuestCompletion || ''))
        : false;
      var sec = num(t.GameTime);

      out.push({
        quest: file,
        label: file.replace(/^(Tutorial|Main|Branch|Simple)_/i, ''),
        seconds: sec,
        timecode: formatTimecode(sec),
        clock: (branch && branch.DirtyTime) ? String(branch.DirtyTime) : null,
        completed: completed
      });
    });

    out.sort(function (a, b) { return (a.seconds || 0) - (b.seconds || 0); });
    return out;
  }

  function collectBosses(record, atlas, narrative) {
    var list = [];
    if (!obj(record)) return list;

    for (var key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      var entry = obj(record[key]);
      if (!entry) continue;
      var records = obj(entry.Records) || {};

      var attempts = 0;
      var kills = 0;
      var bestMs = null;
      var cycles = {};
      var rows = [];

      for (var rk in records) {
        if (!Object.prototype.hasOwnProperty.call(records, rk)) continue;
        var r = obj(records[rk]);
        if (!r) continue;
        var a = num(r.AttemptCount) || 0;
        var k = num(r.KillCount) || 0;
        attempts += a;
        kills += k;
        if (num(r.BestTimeMs) && (bestMs == null || r.BestTimeMs < bestMs)) bestMs = r.BestTimeMs;

        var parts = String(rk).split('_');
        var cycle = parts[0];
        var diffByte = parts.length > 1 ? num(parseInt(parts[1], 10)) : null;
        // 存档里的周目从 0 起算，展示时换算成「第 N 周目」
        var cycNum = parseInt(cycle, 10);
        var cycleLabel = isFinite(cycNum) ? String(cycNum + 1) : cycle;
        cycles[cycle] = cycleLabel;
        rows.push({
          key: String(rk),
          cycle: cycle,
          cycleLabel: cycleLabel,
          difficulty: diffByte == null ? null : (DIFFICULTY[diffByte] || String(diffByte)),
          difficultyByte: diffByte,
          attempts: a,
          kills: k,
          deaths: Math.max(0, a - k),
          bestMs: num(r.BestTimeMs),
          bestTime: formatClock(r.BestTimeMs)
        });
      }

      if (!attempts) continue;

      rows.sort(function (x, y) {
        if (x.cycle !== y.cycle) return String(x.cycle).localeCompare(String(y.cycle));
        return (x.difficultyByte || 0) - (y.difficultyByte || 0);
      });

      /* 击败该首领时设定的难度：取有击杀的分组，多个时取最早一次（周目低、难度低）；
         尚未击破则退回首个挑战分组，用来标注「在什么难度下打的」 */
      var killRows = rows.filter(function (r) { return r.kills > 0; });
      var pick = null;
      (killRows.length ? killRows : rows).forEach(function (r) {
        if (!pick) { pick = r; return; }
        var c1 = parseInt(r.cycle, 10);
        var c2 = parseInt(pick.cycle, 10);
        if (isFinite(c1) && isFinite(c2) && c1 !== c2) {
          if (c1 < c2) pick = r;
          return;
        }
        if ((r.difficultyByte || 0) < (pick.difficultyByte || 0)) pick = r;
      });

      var diffLabels = [];
      rows.forEach(function (r) {
        if (r.difficulty && diffLabels.indexOf(r.difficulty) < 0) diffLabels.push(r.difficulty);
      });

      var meta = lookupBoss(atlas, key);
      var deaths = Math.max(0, attempts - kills);
      var lore = lookupLore(key, meta);
      var encounters = collectEncounters(narrative, key);

      list.push({
        key: key,
        rawName: key,
        name: meta ? meta.name : prettyId(key),
        display: meta ? meta.name : prettyId(key),
        region: meta ? meta.region : '',
        img: meta ? meta.img : null,
        matched: !!meta,
        attempts: attempts,
        kills: kills,
        deaths: deaths,
        bestMs: bestMs,
        bestTime: formatClock(bestMs),
        defeated: attempts > 0 ? kills > 0 : null,
        cycles: Object.keys(cycles),
        cycleLabels: Object.keys(cycles).sort().map(function (c) { return cycles[c]; }),
        difficulty: pick ? pick.difficulty : null,
        difficultyByte: pick ? pick.difficultyByte : null,
        difficultyCleared: killRows.length > 0,
        difficulties: diffLabels,
        records: rows,
        winRate: attempts ? kills / attempts : 0,
        subtitle: lore && lore.subtitle ? lore.subtitle : null,
        codexId: lore && lore.codexId ? lore.codexId : null,
        summary: lore && lore.summary ? lore.summary : null,
        encounters: encounters,
        // 多段遭遇：统计数字是几段合并的，不能按段拆
        merged: encounters.length > 1,
        encounterCount: encounters.length
      });
    }

    list.sort(function (a, b) {
      if (b.deaths !== a.deaths) return b.deaths - a.deaths;
      if (b.attempts !== a.attempts) return b.attempts - a.attempts;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return list;
  }

  /* ---------- 区域分类 ---------- */

  /**
   * 按图鉴顺序（≈ 游戏推进顺序）排出区域，再统计各区域的战绩。
   * 只保留当前存档里确实遇到过的区域。
   */
  function buildRegions(bosses, atlas) {
    var order = [];
    var seen = {};
    var i;

    if (atlas && atlas.list) {
      for (i = 0; i < atlas.list.length; i++) {
        var r = atlas.list[i].region;
        if (r && !seen[r]) { seen[r] = true; order.push(r); }
      }
    }
    for (i = 0; i < bosses.length; i++) {
      var br = bosses[i].region;
      if (br && !seen[br]) { seen[br] = true; order.push(br); }
    }

    var stats = {};
    for (i = 0; i < bosses.length; i++) {
      var b = bosses[i];
      var name = b.region || '未归类';
      var s = stats[name];
      if (!s) {
        s = stats[name] = { name: name, total: 0, defeated: 0, deaths: 0, attempts: 0, bestMs: null, keys: [] };
      }
      s.total++;
      if (b.defeated) s.defeated++;
      s.deaths += b.deaths;
      s.attempts += b.attempts;
      s.keys.push(b.key);
      if (b.bestMs != null && (s.bestMs == null || b.bestMs < s.bestMs)) s.bestMs = b.bestMs;
    }

    if (stats['未归类']) order.push('未归类');

    var out = [];
    for (i = 0; i < order.length; i++) {
      var st = stats[order[i]];
      if (!st) continue;
      st.bestTime = formatClock(st.bestMs);
      st.index = out.length;
      out.push(st);
    }
    return out;
  }

  function lookupLore(key, meta) {
    var lore = global.PBZBossLore;
    if (!lore) return null;

    if (lore.byId && lore.byId[key]) return lore.byId[key];

    // 图鉴里个别条目内部名与存档不一致（如 BP_Monster_HookMan vs _P2），
    // 用立绘文件名里的图鉴编号兜底
    if (meta && meta.img && lore.byCodex) {
      var m = String(meta.img).match(/(\d+)\.png$/i);
      if (m && lore.byCodex[m[1]]) return lore.byCodex[m[1]];
    }
    return null;
  }

  /* ---------- 物品 / 武器 ---------- */

  /**
   * 图鉴对照（js/item-atlas.js，由 tools/fetch-item-atlas.js 从游民星空图鉴生成）。
   * 图鉴条目自带 gameInternalId，与存档键名一一对应，所以中文名以它为准，
   * 查不到时才退回社区对照表 / 词根翻译。
   */
  function atlasLookup(id) {
    var atlas = global.PBZItemAtlas;
    return atlas && atlas.lookup ? atlas.lookup(id) : null;
  }

  function atlasTotal(cat) {
    var atlas = global.PBZItemAtlas;
    return atlas && atlas.total ? atlas.total(cat) : 0;
  }

  /** 存档里的一条装备/收藏品，统一成渲染用的结构 */
  function itemEntry(id, extra) {
    var hit = atlasLookup(id);
    var out = {
      raw: String(id),
      name: hit ? hit.name : translateId(id),
      kind: hit ? hit.kind : '',
      codex: hit ? hit.codex : '',
      summary: hit ? hit.summary : '',
      // 图标按图鉴里的规范 ID 命名，存档键偶有大小写不一致（Kuye / KuYe）
      icon: hit && hit.id ? 'assets/items/' + hit.id + '.png' : null,
      matched: !!hit
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return out;
  }

  /** 图鉴顺序（≈ 游戏内排序），没有编号的排最后 */
  function byCodex(a, b) {
    return String(a.codex || 'zzz').localeCompare(String(b.codex || 'zzz'));
  }

  function collectItems(inv) {
    var infos = obj(inv && inv.InventoryInfos) || {};
    var buckets = {};
    var items = [];
    var total = 0;

    for (var key in infos) {
      if (!Object.prototype.hasOwnProperty.call(infos, key)) continue;
      var e = obj(infos[key]);
      if (!e) continue;
      var count = num(e.CurrentAmount);
      if (count == null) count = 1;
      var cat = itemCategory(key);
      buckets[cat] = (buckets[cat] || 0) + 1;
      total += count;
      items.push({ name: translateId(key), raw: key, count: count, category: cat, named: !!(global.PBZItemNames && global.PBZItemNames[key]) });
    }

    items.sort(function (a, b) {
      if (a.named !== b.named) return a.named ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    return {
      count: items.length,
      total: total,
      buckets: buckets,
      items: items.slice(0, 60)
    };
  }

  /**
   * 主武器 + 影之武装。
   * 两个子系统都是「1 级 = 没有强化」，所以界面上的 +n 等于存档等级 - 1。
   * 主武器取 MainWeaponInfos（已获得的全部），装备中的排在前面；
   * 影之武装不能用 ShaqiWeapons（那只是当前装配的两个），
   * 已获得的完整列表在 ShaChiWeaponInfo 里。
   */
  function collectWeapons(inv) {
    var infos = obj(inv && inv.MainWeaponInfos) || {};
    var equipped = Array.isArray(inv && inv.MainWeapons) ? inv.MainWeapons : [];
    var list = [];
    var maxPlus = 0;

    for (var key in infos) {
      if (!Object.prototype.hasOwnProperty.call(infos, key)) continue;
      var e = obj(infos[key]) || {};
      var lvl = num(e.WeaponLevel);
      var plus = lvl && lvl > 1 ? lvl - 1 : 0;
      if (plus > maxPlus) maxPlus = plus;
      list.push(itemEntry(key, {
        level: lvl,
        plus: plus,
        equipped: equipped.indexOf(key) >= 0,
        since: e.DateTime || null
      }));
    }

    list.sort(function (a, b) {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      if (b.plus !== a.plus) return b.plus - a.plus;
      return byCodex(a, b);
    });

    var shaqiInfos = obj(inv && inv.ShaChiWeaponInfo) || {};
    var shaqiEquipped = Array.isArray(inv && inv.ShaqiWeapons) ? inv.ShaqiWeapons : [];
    var shaqi = [];
    var maxShaqiPlus = 0;

    for (var sk in shaqiInfos) {
      if (!Object.prototype.hasOwnProperty.call(shaqiInfos, sk)) continue;
      var s = obj(shaqiInfos[sk]) || {};
      var slvl = num(s.ShaChiWeaponLevel);
      var splus = slvl && slvl > 1 ? slvl - 1 : 0;
      if (splus > maxShaqiPlus) maxShaqiPlus = splus;
      shaqi.push(itemEntry(sk, {
        level: slvl,
        plus: splus,
        equipped: shaqiEquipped.indexOf(sk) >= 0,
        since: s.DirtyTime || null
      }));
    }

    shaqi.sort(function (a, b) {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      if (b.plus !== a.plus) return b.plus - a.plus;
      return byCodex(a, b);
    });

    return {
      count: list.length,
      maxPlus: maxPlus,
      total: atlasTotal('weapon'),
      items: list,
      edges: {
        count: shaqi.length,
        maxPlus: maxShaqiPlus,
        total: atlasTotal('shaqi'),
        items: shaqi,
        equipped: shaqiEquipped.filter(function (x) { return x && x !== 'None'; }).length
      }
    };
  }

  /**
   * 饰品。AccessoryInfos 是全部已获得的饰品（没有槽位概念），
   * AccessoryIDs 才是身上装配的 3 个槽（其余是 "None"）。
   */
  function collectAccessories(inv) {
    var infos = obj(inv && inv.AccessoryInfos) || {};
    var ids = Array.isArray(inv && inv.AccessoryIDs) ? inv.AccessoryIDs : [];
    var equipped = ids.filter(function (x) { return x && x !== 'None'; });
    var list = [];

    for (var key in infos) {
      if (!Object.prototype.hasOwnProperty.call(infos, key)) continue;
      var e = obj(infos[key]) || {};
      var lvl = num(e.CurrentLevel);
      // 饰品的 CurrentLevel 语义没核实（不是武器那种 +n），只放进提示里，不当角标显示
      list.push(itemEntry(key, {
        level: lvl,
        plus: 0,
        equipped: equipped.indexOf(key) >= 0,
        since: e.DirtyTime || null
      }));
    }

    list.sort(function (a, b) {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      return byCodex(a, b);
    });

    return {
      count: list.length,
      total: atlasTotal('accessory'),
      equipped: equipped.length,
      items: list
    };
  }

  /**
   * 药瓶。MedicineInfos 是已获得的全部药瓶，
   * 身上只有上下两个快捷位（TopMedicine / BottomMedicine）。
   * CurrentTime / MaxTime 是充能次数，和存档实际显示的「可用瓶数」不完全等同，
   * 这里只用来给未满的条目做提示，不当主数值。
   */
  function collectMedicines(inv) {
    var infos = obj(inv && inv.MedicineInfos) || {};
    var top = inv && inv.TopMedicine ? String(inv.TopMedicine) : null;
    var bottom = inv && inv.BottomMedicine ? String(inv.BottomMedicine) : null;
    var list = [];

    for (var key in infos) {
      if (!Object.prototype.hasOwnProperty.call(infos, key)) continue;
      var e = obj(infos[key]) || {};
      var slot = null;
      if (top && top.toLowerCase() === key.toLowerCase()) slot = '上';
      else if (bottom && bottom.toLowerCase() === key.toLowerCase()) slot = '下';

      list.push(itemEntry(key, {
        equipped: !!slot,
        slot: slot,
        charge: num(e.CurrentTime),
        chargeMax: num(e.MaxTime),
        since: e.DirtyTime || null
      }));
    }

    list.sort(function (a, b) {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      return byCodex(a, b);
    });

    return {
      count: list.length,
      total: atlasTotal('medicine'),
      equipped: list.filter(function (x) { return x.equipped; }).length,
      items: list
    };
  }

  /* ---------- 图鉴 ---------- */

  /**
   * 图鉴类进度只取「敌人 / 见闻」这种没有别的数据源的项目。
   * 武器、影之武装、饰品、药瓶改为按背包实际获得数对比图鉴总数
   * （__Advanced__.Codex 里并没有这几类数组，只有 DiscoveredEnemies）。
   */
  function collectCodex(codex) {
    var rows = [];

    if (!obj(codex)) return rows;

    var enemies = Array.isArray(codex.DiscoveredEnemies) ? codex.DiscoveredEnemies : [];
    if (enemies.length) rows.push({ label: '敌人', value: enemies.length, total: null });

    var lore = Array.isArray(codex.DiscoveredLore) ? codex.DiscoveredLore : [];
    if (lore.length) rows.push({ label: '见闻', value: lore.length, total: null });

    return rows;
  }

  /* 关卡代号 → 中文区域名 */
  var LEVEL_CN = {
    xigu: '西谷',
    fujizhilin: '伏击之林',
    zhengdaodaying: '正道大营',
    pangzhen: '庞镇',
    lujiacun: '陆家村',
    xuesesenslin: '血色森林',
    xuesesenlin: '血色森林',
    meiguhu: '梅谷湖',
    jialongshan: '枷笼山',
    duanhunshan: '断魂山',
    heishidong: '黑石洞'
  };

  function levelName(raw) {
    if (!raw) return null;
    var key = String(raw).replace(/^PBZ_/i, '').replace(/_WP.*$/i, '').toLowerCase();
    return LEVEL_CN[key] || prettyId(String(raw).replace(/^PBZ_/i, '').replace(/_WP$/i, ''));
  }

  /* ---------- 评语 ---------- */

  function makeVerdict(view) {
    var lines = [];
    var rank = '';

    var deaths = view.deathCount;
    if (deaths != null) {
      if (deaths === 0) { rank = '无伤通关'; lines.push('一次没死，江湖上没几个人做得到。'); }
      else if (deaths < 10) { rank = '身法如风'; lines.push('只死了 ' + deaths + ' 次，招式已经刻进骨子里。'); }
      else if (deaths < 40) { rank = '砥砺前行'; lines.push('死在刀下 ' + deaths + ' 次，每一道疤都换回一招。'); }
      else if (deaths < 100) { rank = '以命换刀'; lines.push('倒下 ' + deaths + ' 次，你比谁都清楚这游戏的重量。'); }
      else { rank = '百死不悔'; lines.push('死亡 ' + deaths + ' 次，这已经不是难度，是执念。'); }
    }

    var top = view.worstBoss;
    if (top && top.deaths > 0) {
      lines.push('「' + top.name + '」在你手里拿下 ' + top.deaths + ' 条命。');
    }

    if (view.bossTotal > 0) {
      lines.push('已击破 ' + view.bossDefeated + ' / ' + view.bossTotal + ' 名首领。');
    }

    if (!lines.length) lines.push('存档解析完成。');

    return { rank: rank, lines: lines };
  }

  /* ---------- 主函数 ---------- */

  function build(save, options) {
    var opts = options || {};
    var atlas = opts.atlas || (global.PBZBossAtlas || null);
    var json = save.json || save;

    var sys = obj(json.PBZGameSystem) || {};
    var player = obj(json.Player) || {};
    var meta = obj(json.PBZDeathMeta) || {};
    var inv = obj(json.Inventory) || {};
    var adv = obj(opts.advanced) || {};

    var playTimeSeconds = num(sys.CurrentCycleGameTime);
    if (playTimeSeconds == null) playTimeSeconds = num(sys.HasGameTime);

    var bosses = collectBosses(json.BossRecord, atlas, json.Narrative);
    var defeated = bosses.filter(function (b) { return b.defeated === true; }).length;
    var regions = buildRegions(bosses, atlas);

    var remaining = num(player.RemainingDays);
    var day = remaining == null ? null : Math.max(0, DAY_LIMIT - remaining);

    var items = collectItems(inv);
    var weapons = collectWeapons(inv);
    var accessories = collectAccessories(inv);
    var medicines = collectMedicines(inv);
    var codex = collectCodex(adv.Codex);

    var achievements = opts.achievements && Array.isArray(opts.achievements.UnlockedIds)
      ? opts.achievements.UnlockedIds.length
      : null;

    /* 收集进度：图鉴类只取敌人/见闻，装备类按「已获得 / 图鉴总数」出进度 */
    var stats = codex.slice();
    if (achievements != null) stats.push({ label: '成就', value: achievements, total: null });
    if (weapons.count) {
      stats.push({ label: '武器', value: weapons.count, total: weapons.total || null });
    }
    if (weapons.edges.count) {
      stats.push({ label: '影之武装', value: weapons.edges.count, total: weapons.edges.total || null });
    }
    if (accessories.count) {
      stats.push({ label: '饰品', value: accessories.count, total: accessories.total || null });
    }
    if (medicines.count) {
      stats.push({ label: '药瓶', value: medicines.count, total: medicines.total || null });
    }

    var view = {
      playTimeSeconds: playTimeSeconds,
      playTimeText: formatDuration(playTimeSeconds),
      deathCount: num(meta.DiedTimes),
      currency: num(player.Dust),
      day: day,
      dayLimit: DAY_LIMIT,
      remainingDays: remaining,
      completion: bosses.length ? (defeated / bosses.length) * 100 : null,
      difficulty: num(sys.DifficultModeByte) != null ? (DIFFICULTY[sys.DifficultModeByte] || String(sys.DifficultModeByte)) : null,
      difficultyByte: num(sys.DifficultModeByte),
      playerName: '魂',
      region: sys.CurrentLevelName || null,
      newGamePlus: num(sys.CycleCount) != null ? sys.CycleCount > 0 : null,
      cycleCount: num(sys.CycleCount),
      sixtySixMode: null,
      finished: sys.bIsFinishGame === true,
      bosses: bosses,
      regions: regions,
      bossDefeated: defeated,
      bossTotal: bosses.length,
      worstBoss: bosses.length && bosses[0].deaths > 0 ? bosses[0] : null,
      items: items,
      weapons: weapons,
      edges: weapons.edges,
      accessories: accessories,
      medicines: medicines,
      collectibles: stats,
      achievements: achievements,
      savedAt: sys.DateTimeString || null,
      levelName: levelName(sys.CurrentLevelName)
    };

    view.verdict = makeVerdict(view);

    return {
      kind: 'pbzs',
      meta: {
        container: 'PBZS v3',
        slot: save.slotName || null,
        size: save.size || null,
        slotCount: save.slotCount || null
      },
      view: view
    };
  }

  var api = {
    build: build,
    DAY_LIMIT: DAY_LIMIT,
    formatDuration: formatDuration,
    formatClock: formatClock,
    formatTimecode: formatTimecode,
    prettyId: prettyId,
    levelName: levelName,
    translateId: translateId,
    itemCategory: itemCategory
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.PBZ = global.PBZ || {};
    global.PBZ.View = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
