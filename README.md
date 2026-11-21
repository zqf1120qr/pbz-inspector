# 影之刃零 · 本地存档解析

上传 Steam 存档 `PBZSaveGame.sav`，在浏览器里解开它的 PBZS 加密容器，解析出游玩数据，如总时长、首领战死记录、收集进度、武器与货币；每名首领可以点开查看简介与战绩详情，并能导出一张可分享的战绩长图。

> 全程在本地浏览器解析，存档不会上传到任何服务器。

## 在线使用

**[影之刃零 · 本地存档解析](https://zqf1120qr.github.io/pbz-inspector/)**

没有存档也可以点「看示例」，用内置的示例存档跑通整个流程。

## 说明

上游原版：**[YangHFeng/ying-zhi-ren-ling: 影之刃零存档解析](https://github.com/YangHFeng/ying-zhi-ren-ling)**

本目录是它的本地改造版，在原版基础上增加了：首领按区域分类、首领详情抽屉（简介 / 战绩 / 分组记录）、击败难度标注、本地缓存、320–1920 全档响应式，以及重做的战绩长图。部署方式见「部署到 GitHub Pages」。

## 功能

- **时长与进度** — 总游玩时长、当前天数 / 66 天、首领击破率环形图
- **首领战死图鉴** — 每名交战过的首领一张卡片，带立绘、中文名、击败难度与死亡次数；顶部按所属区域分类筛选
- **首领详情** — 点击卡片展开抽屉：图鉴简介、死亡 / 挑战 / 击杀 / 最快用时 / 击杀率，以及按「周目_难度」分组的战斗记录
- **顶栏入口** — 右上角金色「点个 Star」按钮直达 GitHub 仓库；页脚也有一枚求 Star 的胶囊
- **收集与装备** — 敌人图鉴、成就；武器库（主武器 + 影之武装，含强化等级）、饰品库、药瓶库，图标 + 官方中文名逐条与游民星空图鉴对齐，并给出「已获得 / 图鉴总数」
- **存档槽切换** — 一份文件里打包的自动档、手动档与账户数据可逐个查看
- **战绩长图** — Canvas 绘制 1600px 宽的分享图，含四格战绩与首领立绘网格，一键下载
- **原始数据浏览** — 解密后的完整 JSON 属性树，支持搜索
- **自定义密钥** — 游戏大版本更新导致内置密钥失效时，可在「解析信息」里覆盖
- **本地缓存** — 解析过的存档存进本机 IndexedDB，刷新页面自动恢复，不必反复上传；「清除缓存」可随时删除

## 存档格式：PBZS v3

影之刃零**没有**使用 UE 默认的 GVAS 存档，而是自研的 PBZS 加密容器。解析链路：

```
PBZSaveGame.sav
  └─ PBZS 容器（明文 12 字节头 + 若干 AES-256-GCM 封存块）
       ├─ 目录块 → 每个槽位的名字 / 压缩算法 / 偏移 / 大小
       └─ 数据块 → 解密 → 按算法解压 → UTF-8 JSON
```

容器头 12 字节：

| 偏移 | 长度 | 含义 |
| --- | --- | --- |
| 0x00 | 4 | magic `PBZS` |
| 0x04 | 1 | 版本号（当前为 3） |
| 0x05 | 1 | flags |
| 0x06 | 2 | 槽位数量（uint16 LE） |
| 0x08 | 4 | 目录块长度（uint32 LE，含封包头） |

每个封存块的 36 字节前缀为 `PBZS` + 4 字节标记 + 12 字节 nonce + **16 字节 GCM 认证标签**，随后才是密文。标签在密文**之前**，而 WebCrypto 要求 `ciphertext || tag`，解密前需要重排。

目录块解密后是一张紧凑表，逐条为：

```
uint16 nameLen | name | uint8 algorithm | uint8 flag
| uint32 rawSize | uint32 offset | uint32 blockSize
```

`algorithm`：`0` 原始 JSON、`1` zlib、`2` Oodle Kraken。

槽位数量与压缩算法随存档而变，两份实测样本正好覆盖了两条解压路径：

| 样本 | 槽位 | 压缩算法 |
| --- | --- | --- |
| 真实存档 `PBZSaveGame.sav` | 5 | 全部 Oodle Kraken |
| 示例存档 `samples/demo-pbzs.sav` | 7 | 全部 zlib |

因此项目内置了 Oodle 解码器的 WASM 版本（`js/vendor/ooz.mjs`，约 115 KB）。解密与解压分别用 WebCrypto 的 `AES-GCM` 与 `DecompressionStream('deflate')`，Oodle 走 WASM，**没有任何后端参与**。

## 指标怎么算

| 指标 | 来源 |
| --- | --- |
| 游玩时长 | `PBZGameSystem.CurrentCycleGameTime`（秒） |
| 天数 | `Player.RemainingDays` / 天数上限 66 |
| 死亡总数 | `PBZDeathMeta.DiedTimes` |
| 单首领死亡数 | `BossRecord.<BP_Monster_X>.Records.<cycle>_<diff>.AttemptCount - KillCount` |
| 击败难度 | 分部键的第二段：`1` 入阵者、`2` 破局者、`3` 逆天者 |
| 周目 | 分部键的第一段（存档从 0 起算，界面显示为「第 N 周目」） |
| 击破率 | 已击破首领数 / 图鉴内的首领总数 |
| 货币 | `Player.Dust` |
| 武器 | `Inventory.MainWeaponInfos`，`WeaponLevel` 比 UI 上的 `+n` 多 1 |
| 影之武装 | `Inventory.ShaChiWeaponInfo`（已获得全部），`ShaqiWeapons` 只是当前装配的两个 |
| 饰品 | `Inventory.AccessoryInfos`（已获得全部）；`AccessoryIDs` 是身上 3 个槽，空位为 `"None"` |
| 药瓶 | `Inventory.MedicineInfos`；`TopMedicine` / `BottomMedicine` 是上/下两个快捷位 |
| 收集 | `__Advanced__.Codex.DiscoveredEnemies`、`__Achievements__.UnlockedIds`，装备类按图鉴总数算进度 |

## 装备与图鉴对齐

武器 / 影之武装 / 饰品 / 药瓶的中文名不靠人肉翻译，而是直接取**游民星空《影之刃零》图鉴**：图鉴每个条目都带 `values.gameInternalId`，正好等于存档里的键名，所以「存档 ID → 官方中文名」是精确对照。

`js/item-atlas.js` 由 `node tools/fetch-item-atlas.js` 生成（当前 132 条：武器 25、影之武装 24、饰品 66、药瓶 17），文件头带生成日期，重新抓取即可跟上游戏版本。图鉴前端是 Nuxt SSR + 懒加载，HTML 首屏只有 20 条，全量要走 `renderer.gamersky.com/gameWiki/web/wikis/16/categories/<id>/entries?pageSize=100`。

早期的社区对照表把 `Tang` 译成「唐刀」、`IronBlade` 译成「玄铁刃」、`Long` 译成「长刀」，与官方图鉴（黑伤 / 残钢刃 / 长形黑伤）不符，现已改为图鉴名。`js/item-names.js` 只保留图鉴没覆盖的材料、服饰与旧 ID 别名。存档里偶有大小写与图鉴不一致的键（`Kuye` vs `KuYe`），查表时做了小写兜底。

### 图标

装备区用「图标 + 名称」瓦片展示，图标是图鉴条目的 `coverUrl`（256×256 透明底 PNG），由 `node tools/fetch-item-icons.js` 统一缩到 96px 存进 `assets/items/`，按图鉴内部 ID 命名，页面里显示 44px（2 倍屏够用）。

缩放走无头浏览器的 canvas：Node 下载字节 → base64 → `createImageBitmap` → canvas → PNG。不在页面里直接 fetch 是因为 `img1.gamersky.com` 没有 CORS 头，跨域图片会把 canvas 标脏，读不出像素。

瓦片宽度是 `minmax(184px, 1fr)`——再窄的话「容器维护液体 + 上」「亡命斩马刀 +13」这类最长的组合会被省略号截断（实测过 172px 必然截断）。窄屏 ≤560px 改两列并缩到 32px 图标，≤365px 退回单列，因为 320px 宽下 6 个汉字的名称加角标放不进半屏。

## 首领数据与简介

立绘、中文名、所属区域与简介整理自**游民星空《影之刃零》图鉴**（BOSS 分类），版权归 S-GAME 所有，本项目仅作非商业展示。立绘用 `tools/fetch-boss-atlas.py` 抓取，简介用 `tools/fetch-boss-lore.js` 抓取（正文在详情接口的 `moduleValues` HTML 里，列表接口的 `summary` 只有 120 字）。

存档里的首领标识通常是游戏内部蓝图名（如 `BP_Monster_YuCong_P1`）。匹配顺序：精确匹配 → 去 `BP_Monster_` / `Boss_` 前缀 → 最长前缀匹配（处理 `_P2`、`_FirstTime` 这类阶段后缀）→ 中文名包含匹配。全部失败时把内部名转成可读形式（`BP_Monster_YuCong_P1` → `Yu Cong P1`），卡片显示占位符而不是破图。

界面上首领按**所属区域**分类（序章 / 悲泣溪谷 / 庞镇……），区域顺序取自图鉴条目顺序，近似游戏推进顺序，只显示当前存档里遇到过的区域。个别图鉴条目的内部名与存档不一致（如 `BP_Monster_HookMan` 对应图鉴的 `_P2`），会用立绘文件名里的图鉴编号兜底。

### 多段遭遇

少数首领会在同一周目里按章节反复登场（如「金面具黑衣人」每章一次），但游戏只维护**一条** `BossRecord`：键名固定取第一段蓝图的 `_01`，`ClassPath` 被最后一次遭遇覆盖，挑战 / 击杀 / 最快天生就是累计值，存档里没有任何分段计数。

能区分「每次遭遇」的痕迹只有任务系统：`Narrative.QuestGameTimes` 里的 `Tutorial_Longzhu1` / `Tutorial_Longzhu3` 记录了各段完成时的游戏内秒，`NarrativeSavedQuests` 里对应条目带墙钟时间（`QuestBranches[].DirtyTime`）。`js/pbz-view.js` 的 `ENCOUNTER_RULES` 用「存档键 → 任务名正则」显式声明映射，卡片左下角标出「N 段合并」，详情抽屉里列出各段的任务与完成时间，并注明统计为合计值。

## 战绩卡

`js/share-card.js` 用 Canvas 2D 绘制，与页面响应式是**两套体系**：页面按视口自适应，导出图固定 1600px 宽，高度只随首领数量变化（9 名 → 1959px，15 名 → 2390px），与视口、像素比无关。

- 版面：页眉（英文小标 + 衬线标题 + 难度/天数/时长 + 右上角头号苦主立绘）→ 四格数值（累计死亡 / 战斗记录 / 已击败 / 推算失败）→ 首领立绘网格 → 页脚说明
- 导出文件名取自存档时间（`PBZGameSystem.DateTimeString`），如 `2026.11.15-02.02.53` 的存档导出为 `261115_战绩.png`；账户槽没有存档时间时退回 `战绩.png`
- 每张卡片上的难度、周目、死亡数都是深色胶囊标签，难度按档位配色（入阵者冷灰 / 破局者旧金 / 逆天者朱砂）
- 多段遭遇的首领（见上文）在格子左下角多一枚金色「N 段合并」小标签，与页面卡片一致，提醒该格的挑战次数与最佳用时是几段遭遇的累计值
- 页眉**右上角**有一个压暗底板的小牌子：`在线解析` + `zqf1120qr.github.io/pbz-inspector`（26px 等宽字），缩到 560px 宽仍读得出来。一开始放在页脚左下角，实测太容易被忽略；底板同时也是为了压住从那个角穿过的朱砂斜线
- 页脚右侧有一行收藏汇总：`图鉴  武器 12/25 · 影之武装 9/24 · 饰品 25/66 · 药瓶 7/17`。**只上数字不上图标** —— 24 个首领的卡已经 3200px 高、3.6 MB，再塞 132 个图标会到 5000px 以上，微信压完基本看不清，而且装备是存档状态、不是战绩
- `draw()` 是异步的（需预载立绘），调用方必须 `await`
- 噪点用 `mulberry32` 按存档数据播种，同一份存档导出的 PNG **逐字节一致**；实测 390@3x / 360@2x / 768@2x / 1600@1x 四种设备配置 MD5 相同

## 界面适配

页面在 320–1920 各档均无横向溢出、无文字截断，主要断点为 **340 / 365 / 400 / 560 / 620 / 767 / 880 / 1199**。面板内的纵向间距统一由 `.tab-panel` 的 `flex + gap` 提供，新增区块不需要自己加 `margin-top`。

## 本地运行

纯静态页面，不需要构建。但因为用到 WebCrypto、`DecompressionStream`、ES Module 与 `fetch`，必须用 HTTP 服务打开（`file://` 下 WebCrypto 不可用）：

```bash
python -m http.server 8765
# 或 npx serve .
```

然后访问 `http://127.0.0.1:8765/`。Windows 下也可以直接双击 `start-server.bat`。

## 部署到 GitHub Pages

纯静态站点，没有后端，可直接托管在 GitHub Pages。线上地址：**[zqf1120qr.github.io/pbz-inspector](https://zqf1120qr.github.io/pbz-inspector/)**。注意三点：

1. **必须是 HTTPS 或 localhost** — `crypto.subtle` 只在安全上下文可用，GitHub Pages 自带 HTTPS
2. **仓库根目录就是站点根目录** — 本目录下的 `index.html` 要位于仓库根（或改成 `docs/` 后在设置里选 `/docs`）。页面全部使用相对路径，部署在 `https://<user>.github.io/<repo>/` 这样的子路径下也能正常工作
3. **别把真实存档提交上去** — `.gitignore` 已排除 `PBZSaveGame.sav`，只保留 `samples/demo-pbzs.sav`

```bash
cd page_source
git init && git add -A && git commit -m "影之刃零存档解析"
git remote add origin https://github.com/zqf1120qr/pbz-inspector.git
git push -u origin main
```

推送后在仓库 Settings → Pages 里把 Source 设为 `Deploy from a branch` → `main` / `(root)`。`.nojekyll` 已在仓库内，避免 Jekyll 处理静态资源。

站点地址出现在三处，换域名时一起改：顶栏金色 `点个 Star` 按钮的 `href`、页脚求 Star 链接的 `href`（都在 `index.html`）、战绩卡右上角牌子里的地址文案（`js/share-card.js` 的 `siteUrl`）。

体积参考：全站约 7 MB（立绘 2.6 MB、示例图 2.9 MB、装备图标 0.97 MB、代码 0.5 MB），远低于 Pages 的 1 GB 上限。

## 项目结构

```
index.html                 页面骨架
assets/styles.css          全部样式（含响应式）
assets/bosses/             76 张首领立绘（256×256 PNG，共约 2.6 MB）
assets/items/              132 张装备图标（96×96 PNG，共约 0.97 MB，按图鉴内部 ID 命名）
js/pbzs.js                 PBZS v3 容器解密 + 解压（zlib / Oodle）
js/pbz-view.js             解密后 JSON → 页面视图模型
js/item-atlas.js           图鉴对照表（武器 / 影之武装 / 饰品 / 药瓶，自动生成）
js/item-names.js           图鉴未覆盖的 ID 中文名补丁表（材料 / 服饰 / 旧别名）
js/boss-atlas.js           首领图鉴数据（内部 ID / 中文名 / 区域 / 立绘）
js/boss-lore.js            首领简介与图鉴编号（按内部 ID 索引）
js/share-card.js           战绩长图绘制（Canvas，异步）
js/app.js                  交互、渲染、槽位切换、原始数据树、分类与详情抽屉、本地缓存
js/vendor/ooz.mjs          Oodle Kraken WASM 解码器
samples/demo-pbzs.sav      示例存档（真实容器格式，7 个槽位，zlib 压缩）
samples/card-preview.png   战绩长图预览
tools/make-demo.js         生成示例存档
tools/audit-save.js        存档结构审计（时间字段穷举 / BossRecord 原始结构）
tools/fetch-boss-atlas.py  重新抓取首领图鉴数据与立绘
tools/fetch-boss-lore.js   重新抓取首领简介，生成 js/boss-lore.js
tools/fetch-item-atlas.js  重新抓取武器 / 饰品 / 药瓶图鉴，生成 js/item-atlas.js
tools/fetch-item-icons.js  抓取图鉴图标并缩到 96px，输出到 assets/items/
tools/fetch-item-names.py  重新抓取物品 ID 对照表
tools/serve.js             本地静态服务器（页面依赖 crypto.subtle，必须走 localhost）
tools/test-real.js         命令行解析真实存档并打印关键指标
tools/test-ui.js           Playwright 界面自检（需另装 playwright-core）
.nojekyll                  跳过 GitHub Pages 的 Jekyll 处理
```

### 自检

```bash
npm i                                                     # 只为界面自检装 playwright-core
node tools/serve.js 8765                                  # 另开一个终端起本地服务
node tools/test-real.js /path/to/PBZSaveGame.sav          # 命令行跑通解密 + 指标
node tools/audit-save.js /path/to/PBZSaveGame.sav --dump # 打印结构并导出完整 JSON
BASE=http://127.0.0.1:8765/index.html node tools/test-ui.js --real
```

`test-ui.js` 会走一遍「示例存档 → 概览 → 分享卡 → 原始数据搜索 → 槽位切换 → 真实存档 → 错误文件 → 移动端」，任何控制台报错都会以非零码退出，截图输出到 `shots/`。

`audit-save.js` 用来回答「某个数据到底有没有存」这类问题：它会列出槽位、每个顶层键的规模、所有键名含 time / duration / elapsed 的字段，以及 `BossRecord` 的原始结构。

## 已知限制

- **存档不含单场或累计战斗时长** — `BossRecord` 每个分部只有 `AttemptCount`、`KillCount`、`BestTimeMs` 三个字段，没有任何逐场耗时或累计耗时记录。界面只能显示「最快用时」，首领的总耗时无法从存档得出
- **多段遭遇的统计拆不开** — 「金面具黑衣人」这类跨章节反复登场的首领共用一条记录，挑战 / 击杀 / 最速只能显示合计值；页面只能靠任务名与完成时间标出各段先后，无法把数字分到每一段。真要分次数据，得在每次遭遇后各存一个档，再按 `AttemptCount` 增量做 diff
- **密钥会随版本失效** — 内置密钥对应 Steam build 26266538（2026-10-29 发行版）。大版本更新后若提示「认证失败」，把社区给出的新密钥填进「解析信息 → 自定义密钥」即可，配置存在 localStorage
- 需要 HTTPS 或 localhost：WebCrypto 在 `file://` 下不可用
- Oodle 解码器是 115 KB 的 WASM 模块，首次解析需要加载，弱网下会有短暂等待
- 战绩卡的字体按系统解析（`Songti SC` / `SimSun` 等），跨操作系统字形可能有细微差异；尺寸与排版不受影响
- 图鉴收录 76 个首领条目（同一首领的不同阶段分开计），后续版本新增首领需要重新跑一次抓取脚本
- 图鉴有一处编号空缺（`80300`，「金面具黑衣人」），该首领没有简介，详情里会显示「图鉴没有收录这名首领的介绍」
- 装备图鉴同理：游戏更新后新增武器 / 饰品 / 药瓶，要重跑 `tools/fetch-item-atlas.js` 和 `tools/fetch-item-icons.js`，否则新条目没有中文名、也没有图标（图标缺失时瓦片左侧留空，不会出现破图）
- 饰品的 `AccessoryInfos.CurrentLevel` 语义未核实（不是武器那种 `+n`），只在悬浮提示里显示原始等级，不做角标
- 药瓶的 `CurrentTime` / `MaxTime` 与界面上显示的可用瓶数不完全等同，因此不当主数值展示
- 本地缓存存的是**加密后的原始文件**，解密 JSON 不落盘；清除缓存或使用无痕模式即不保留

## License

MIT
