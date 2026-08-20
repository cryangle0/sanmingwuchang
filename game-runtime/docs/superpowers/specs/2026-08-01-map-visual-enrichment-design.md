# 百眼迷城地图视觉丰富化设计

日期:2026-08-01
状态:已定稿(自主执行模式,决策依据真源与工程规则,记录于本文)
基线:`b412975`(321 项测试通过,session-0731 地标已入库)

## 1. 问题

当前地图虽有权威几何、道路、地标与基础散布,但画面"丑且简单":

1. **氛围浑浊**:`scene.background` 与雾都是纯色暗橄榄 `0x2a3630`,画面上部大片死色,整体发闷。
2. **区域无主题**:真源第 2 章给六区明确职责与意象(断墙巷战/双折峡谷/高台深潭/窄巷网/烬水消费圈/深穴田地),现状只靠地面 tint 与统一的树/竹/石三族散布区分,单帧无法辨认身处哪区。
3. **真源元素缺视觉**:`MAP_CHOKES`(窄关 G1-G4)、`MAP_NESTS`(48 巢穴)、`MAP_MONSTER_SLOTS` 在画面上完全不存在;真源称窄关为"卡位/陷阱/封路热点",必须可辨识。
4. **大面积同质纹理**:庭心 90m 六边形只有三道金环;野地 mottle 均匀无事件;缺贴花层打破重复。

## 2. 硬约束(不可违反)

- 不改 `packages/sim`、`packages/content` 生成物、权威几何;`MAP_GEOMETRY_HASH` 保持 `dc80a9ec2b7b9ff4`;`npm run map:authority` 通过。
- 全部新内容是 **render-only** 静态装饰:构建期一次生成,不引入每帧逻辑与逐帧分配。
- 确定性:所有散布 seed 派生自地图几何哈希,同 seed 同几何(延续 signature 测试模式)。
- 不误导玩法:装饰体不得让可走区看起来不可走。装饰残墙高度 ≤0.45m(明显可跨越);任何 ≥1m 的新体积必须落在实体墙足迹内、界外、或既有地标净空区,并保持真源"庭心无遮挡"(庭心 25m 内只允许平面贴花)。
- 采样放置必须复用 `map-sampling.sampleOpenGround` 的拒绝规则(边界内/墙外/庭外/路外/地标净空)。
- 绘制预算:环境静态 DrawCall 总量 ≤75(现状约 43);新增逐模块记账并写入测试断言。
- 30 英雄可读性:延续"低饱和水墨基底+区域点缀色"纪律,饱和度只花在区域 accent 与玩法要点上。
- 工程标准:每模块一个小文件、协调器保持薄、新行为有测试、`npm run check` 全绿、桌面+移动截图验收。

## 3. 方案比较

- **A. 只调光照与调色**:改善氛围但不满足"根据真源丰富地图",区域仍无主题。否决。
- **B. 表现层区域主题化装饰(选定)**:新增 render-only 模块族,按真源区块职责逐区落实道具、贴花、窄关与巢穴标识,配合天空/雾重构。不碰权威数据,风险最低,收益最大。
- **C. 扩展地图编译器(把区域多边形/主题写进生成物)**:动权威管线,`map-geometry.generated.ts` 变更会触发哈希漂移,违反底线。否决。

## 4. 模块设计(B 方案分解)

参考 `world-of-claudecraft` 的既有借鉴路径(静态道具全部烘焙进世界空间、按共享材质合并 DrawCall、程序化 canvas 纹理、实例化+顶点色变化),继续沿用并扩展:

### 4.1 `atmosphere.ts`(氛围重构,DC +0)
- 256×256 CanvasTexture 垂直渐变天空(顶 `0x93a8a2` 青灰 → 中 `0x6e837b` → 底 `0x4d5c55`,叠极淡水墨云纹与远山影带),设为 `scene.background`(claudecraft 低配 dome 思路在正交相机下的等价实现)。
- 雾改 `FogExp2`,基础色 `0x59695f`、密度 0.0038;**分区雾色漂移**:每帧按本地玩家位置的 `regionBlendAt` 把雾色向该区 `mist` 色(map-regions 已定义、当前未消费)插值,密度在 0.0034~0.0044 区间随区微调(峡谷稍浓、庭区稍透)。只写 `fog.color`/`density`,零材质重编译(移植自 claudecraft 的 BIOME_FOG 按区切换)。
- 光照微调:hemisphere sky `0xe4f0e6`,sun 保持暖金但 3.6→3.3;其余不动,小步快照对比。
- 由 `ArenaRenderer` 在地图模式调用;圆形竞技场旧路径不变。

### 4.1b `shading/wind.ts`(环境风摆,DC +0)
- 共享 `uTime` uniform(`ArenaRenderer` 每帧 tick 一次),`applyWindSway(material, strength)` 用 `onBeforeCompile` 注入顶点摆动:相位取实例世界坐标(邻簇不同步),权重随局部 y 上升(根部不动)。
- 应用于草簇(strength 0.08)与树冠/竹(0.05);three 0.165 与 claudecraft 同版本,方案已验证。几何与实例矩阵不变,确定性签名测试不受影响(签名只查几何)。

### 4.2 `dressing/prop-kit.ts`(共享道具几何工厂,重构)
- 把 `landmarks.ts` 私有的 `GeometryBag/Site/addBox/addCylinder/addCone/addHemisphere/addDisc/addEllipsoid/addDodecahedron/addBeamBetween/addRoof/addLantern/transformAtSite/…` 提取为共享模块;`landmarks.ts` 改为导入(纯搬移,几何 checksum 不变,现有 signature 测试守护)。
- 1005 行的 `landmarks.ts` 随之瘦身,符合单文件不臃肿标准。

### 4.3 `dressing/` 六区主题装饰(核心增量,DC ≤14)
每区一个 builder 文件(~120-200 行),`dressing/region-dressing.ts` 做薄协调:按 `regionAt` 把 `sampleOpenGround` 采样点分桶发给各区 builder,所有 bag 按共享材质合并。

- `mihun.ts` 迷魂田(南,猪窝袋路/拾荒):田垄条带贴花、稻草人(杆+横臂+草冠)、干草堆、倒伏栅栏段;紫灰点缀 `0x9c6092`。
- `zhusi.ts` 蛛丝峡(北,双折峡谷/截击):半透明蛛网面片(挂石与墙角)、白茧包(椭球贴石)、石笋簇;冷蓝紫点缀。
- `longji.ts` 龙脊渊(东北,高台深潭):巨型龙骨肋拱(半环骨白拱列成"龙脊"意象)、芦苇丛、苔石;青碧点缀 `0x3f9d8e`。
- `jinshui.ts` 烬水市(东,商店/龙宫/关口三角):焦黑枯木(带余烬 emissive 点)、灰烬地斑贴花、货栈杂物(木箱/麻袋/陶罐堆);橙红点缀 `0xc96838`。
- `duanjin.ts` 断金坊(西北,断墙巷战):≤0.45m 断墙残段(可跨越视觉语义)、插地断刀断戟、铜锈点缀 `0xb8763f`。
- `baizu.ts` 百足城(西南,窄巷网):石灯笼柱、路口石阶小品、蜈蚣图腾柱;黄绿点缀 `0x759c4e`。
- `santing.ts` 万劫三庭:庭心大型阵法环贴花(平面,半径≤20m,金墨双色,不违反庭心无遮挡)、环廊带经幡杆;沿用庭金 `0xcbaa4c`。

### 4.4 `chokes.ts`(窄关寨门,DC +2)
- 读 `MAP_CHOKES`,取最近路段方向,跨路架木寨牌楼(双柱+横枋+小瓦檐+垂旗),门洞净宽=该路 `width_m`,不侵入路面。
- 数量断言 = `MAP_CHOKES.length`。

### 4.5 `nests.ts`(巢穴标识,DC +3)
- 读 `MAP_NESTS` 按 `kind` 三族实例化:地面怪=兽骨堆+踏平草圈贴花;飞行怪=石笼巢(枝条团);精英带=小型旗桩。让野区"有怪处看得出来"。
- 数量断言 = `MAP_NESTS.length`。

### 4.6 `flora.ts` 小改
- 树冠区域 tint 权重 0.34 → 按区可配(烬水市 0.62 枯褐、迷魂田 0.5 灰紫),让通用树在主题区自然变调;几何不动。
- 石头共享几何一次性烘焙"苔藓顶"顶点色(按法线朝上度),与每实例 tint 相乘(移植自 claudecraft `bakeTopTint`)。

### 4.7 world-of-claudecraft 采纳与否决清单

| 技术 | 决定 | 理由 |
|---|---|---|
| 按群系 Record 表组织调色板/雾/散布参数 | 已有并延续 | `REGION_STYLES` 即同构做法 |
| 按区雾色/密度切换(BIOME_FOG) | **采纳**(4.1) | 区分度最大的单点改进,零重编译 |
| canvas 渐变天空 dome(低配路径) | **采纳为背景纹理**(4.1) | 正交相机下等价且更省 |
| 共享 uTime 风摆(onBeforeCompile) | **采纳**(4.1b) | 同 three 版本已验证;静态世界瞬间有生命力 |
| 岩石顶面苔藓/积雪顶点色烘焙 | **采纳**(4.6) | 一次烘焙零运行时成本 |
| 实例 tint 大幅拉向白防脏染 | 已有并延续 | scatter/flora 已按此纪律 |
| Canvas 程序化纹理 + heightToNormal | 已有(texture-lab 同构) | 新材质优先复用现有 surface |
| FBM 地形高度场 | **否决** | 权威可走面必须保持平面,哈希不可漂移 |
| chunk 流式加载/LOD/impostor/分桶裁剪 | **否决** | 840m 静态合并场景 ≤75 DC,无此规模需求 |
| 后处理链(N8AO/Bloom/Grade) | **否决** | AGENTS 规则:先测量再上后处理;移动端预算未验证 |
| 场内水体 | **否决**(界外墨潭列为可选 P3) | 无权威水体足迹,可走面上做水会误导玩法 |

## 5. 材质与 DrawCall 记账

新增共享材质(入 `map-palette.ts` 统一持有/释放):骨白 bone、焦木 charred(带 emissive)、稻草 straw、织物 cloth(旗/幡,DoubleSide)、蛛网 web(透明)、贴花 decal(透明 vertex-color)、青苔 moss、陶土 clay。目标 8 种以内。

| 层 | DC |
|---|---:|
| 现状(地面/路/墙/高台/庭/地标/植被/散布/界外) | ~43 |
| atmosphere | +0 |
| 六区 dressing(按材质合并) | ≤14 |
| chokes | ≤2 |
| nests | ≤3 |
| santing 阵法+经幡 | ≤2 |
| **总计** | **≤64(预算 75)** |

顶点增量目标 ≤80k(0731 地标 55.7k/10DC 同量级),全静态一次构建。

## 6. 测试

- 新增 `tests/map-dressing.test.ts`:
  - summary 计数:六区每区 props>0、chokes=`MAP_CHOKES.length`、nests=`MAP_NESTS.length`;
  - DC 预算断言(dressing 层 children ≤ 记账值);
  - determinism:同 seed 双构建 signature 一致;顶点全有限;
  - 放置合法:结构类道具位点显式断言不在墙片段/庭六边形内、不压路面(贴花与界外体除外)。
- `tests/map-landmarks.test.ts` 不应变(prop-kit 提取是纯搬移;checksum 守护)。
- 全量 `npm run check` + `npm run map:authority` 哈希不变。

## 7. 验收

- 桌面 1440×900:六区各一张 + 三庭 + 窄关近景;移动 390×844:两张。
- WebGL 像素抽样非空、控制台无应用错误、HUD 无遮挡。
- 截图存 `artifacts/session-0801-dressing/`;`docs/开发进度.md` 同变更更新。

## 8. 实施顺序

1. prop-kit 提取(测试保持绿)
2. atmosphere(截图对比调参)
3. 六区 dressing + santing
4. chokes + nests
5. flora tint 微调
6. 全量验证 + 截图 + 文档
