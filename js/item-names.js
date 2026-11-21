/**
 * item-names.js — 存档内部 ID 的中文名（图鉴未覆盖的补丁表）
 *
 * 武器 / 影之武装 / 饰品 / 药瓶 的中文名以 js/item-atlas.js 为准
 * （由 tools/fetch-item-atlas.js 从游民星空图鉴抓取，带 gameInternalId，
 *  与存档键名一一对应）。这里只保留图鉴里没有的条目：
 * 材料、食材、服饰、残页，以及旧版本遗留的 ID 别名。
 *
 * 早期的社区对照表曾把 Tang 译成「唐刀」、IronBlade 译成「玄铁刃」，
 * 与官方图鉴（黑伤 / 残钢刃）不符，已按图鉴更正并移入 item-atlas.js。
 */
(function (global) {
  'use strict';

  var NAMES = {
    // —— 旧版本遗留的武器 ID 别名（当前图鉴里已改名为 LuanYing / YuuBlade 等） ——
    "BlackWound": "黑伤",
    "Dragon吟Blade": "龙吟双刃",
    "BloodShadowSword": "血影长剑",
    "WhiteJadeSword": "白玉刺",
    "SeveringCleaver": "断魂重剑",
    "GhostWeepBlade": "鬼泣刀",
    "LionRoarCannon": "狮吼火铳",
    "PuppetStrings": "傀儡丝",
    "ThunderBow": "惊雷大弓",

    // —— 旧版本遗留的饰品 ID 别名 ——
    "AC_ShaChiMastery": "残火笼",
    "AC_PrayerBeads": "沉香念珠",
    "AC_MothersTalisman": "慈母护符",
    "AC_Livingwood": "活木符",
    "AC_FineThread": "金丝线",

    // —— 材料 ——
    "Weapon_Material_01": "锻铁",
    "Weapon_Material_02": "精炼锻铁",
    "Weapon_Material_03": "玄铁锭",
    "Weapon_Material_04": "融魂玉",
    "Medi_Material_01": "泣溪草",
    "Medi_Material_02": "百年山参",
    "Ac_Material_01": "朱砂丝",
    "Memory_Flower_01": "记忆之花",
    "Skill_Point_Stone": "杀气石",

    // —— 服饰 ——
    "Hun_OutFit_Default": "默认黑衣",
    "Hun_OutFit_Climax": "黑伤战袍",
    "Hun_OutFit_MoTian": "狩猎者",
    "Hun_OutFit_YaYu": "同袍",
    "Hun_OutFit_FengXue": "风雪",
    "Hun_OutFit_ZhuiMing": "宿命",
    "Hun_OutFit_GuYou": "蜃楼华服",
    "Hun_OutFit_JiGuanMoQu": "机关魔躯",
    "Hun_OutFit_Climax_Hat": "泣雨斗笠",
  };

  global.PBZItemNames = NAMES;
})(typeof window !== 'undefined' ? window : globalThis);
