# 百眼迷城地图视觉丰富化实施计划

规格:`../specs/2026-08-01-map-visual-enrichment-design.md`(以下按其模块号引用)
每步完成即运行对应验证;全部完成后跑 `npm run check` + `map:authority` + 截图验收。

## T1 prop-kit 提取(§4.2)
- 新建 `apps/web/src/render/map/dressing/prop-kit.ts`:从 `landmarks.ts` 搬出 GeometryBag/Site/基元 add* 系列/transformAtSite 等,导出;`landmarks.ts` 改导入,行为零变化。
- 验证:`npx vitest run tests/map-landmarks.test.ts` 签名与计数不变。

## T2 atmosphere + wind(§4.1/§4.1b)
- `apps/web/src/render/map/atmosphere.ts`:渐变天空纹理、基础雾参数、`updateRegionFog(playerX, playerZ)` 分区雾色/密度漂移。
- `apps/web/src/render/shading/wind.ts`:共享 uTime + `applyWindSway`;接到草簇/树冠/竹材质;`ArenaRenderer` 帧循环 tick。
- 验证:typecheck;dev:web 截图对比(桌面庭心/市集两景)。

## T3 六区 dressing(§4.3)
- `dressing/` 下 `region-dressing.ts` 协调器 + `mihun/zhusi/longji/jinshui/duanjin/baizu/santing` 七个 builder;新材质入 `map-palette.ts`;`map-environment.ts` 接线。
- 验证:新增 `tests/map-dressing.test.ts`(计数/DC 预算/确定性/顶点有限/放置合法)。

## T4 chokes + nests(§4.4/§4.5)
- `chokes.ts`(4 窄关寨门,跨最近路段)、`nests.ts`(48 巢穴三族标识);计数断言入 dressing 测试。

## T5 flora 微调(§4.6)
- 区域 tint 权重表 + 石头苔藓顶顶点色烘焙。
- 验证:`tests/map-*.test.ts` 全绿。

## T6 全量验证与验收(§6/§7)
- `npm run check` 全绿;`npm run map:authority` 哈希 `dc80a9ec2b7b9ff4` 不变。
- Playwright 截图:六区+三庭+窄关桌面 1440×900,移动 390×844 两张 → `artifacts/session-0801-dressing/`;像素抽样与控制台检查。
- `docs/开发进度.md` 新条目;提交。
