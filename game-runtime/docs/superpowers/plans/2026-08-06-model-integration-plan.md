# JourneyWestGreatBrawl Web + Unity 模型接入完整实施计划

> 计划日期：2026-08-06  
> 目标：把两套 Unity 单体优化模型资源接入当前 `game-runtime`，完成 Web 演示、OSS/CDN、服务器部署和 Unity 本地客户端接入，并用可复现证据验收。  
> 范围：Web 演示上线；Unity 客户端、模型资源、Prefab、Animator、LOD 和本地构建/测试；不把 Unity Dedicated Server 部署为公网业务服务。

## 1. 目标与交付物

- [x] Web 演示可访问：`https://fanavatar.org/`
- [x] Web 演示使用 HTTPS/WSS 连接权威 Node 服务端。
- [x] Web 使用真实英雄和野怪 FBX、贴图及基础动画，不依赖 Primitive 作为正常路径。
- [x] 38 个英雄和 38 个野怪均有稳定运行时 ID：
  - 英雄：`H001-H038`
  - 野怪：`M001-M038`
- [x] Unity 工程导入两套资源并生成可引用的 Prefab、Animator Controller、LOD 和 `ModelVisualCatalog`。
- [x] Unity 本地客户端保留 Primitive fallback，资源异常时可诊断而不崩溃。
- [x] Web 资源和模型资源上传 OSS；OSS CORS、缓存策略和 CDN URL 可验证。
- [x] 服务端部署为 systemd 服务，Nginx 负责 HTTPS、健康检查和 WebSocket Upgrade。
- [x] 完成 TypeScript、Web 浏览器、Node 服务端、Unity 架构、Unity EditMode、Unity 构建和已有压力/冒烟验证。
- [x] 所有密钥只通过当前进程环境变量注入，不写入源码、计划、报告、`.env` 或提交记录。

## 2. 输入资源与路径

### 2.1 源资源

- 英雄资源：
  `E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\Unity技术交付_38英雄_单体优化版`
- 野怪资源：
  `E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\Unity技术交付_38野怪_单体优化版`
- 服务器说明：
  `E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\服务器\fanavatar.org-setup.md`

### 2.2 工程资源目录

- Unity 工程：
  `E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\game-runtime\unity`
- 合并后的资源：
  `unity/Assets/ProceduralHeroes/Characters`
- Web 运行时：
  `apps/web/src/render/models`
- Web 资源 URL：
  `apps/web/src/runtime/asset-url.ts`
- 部署工具：
  `tools/deploy`

### 2.3 固定技术基线

- Web：TypeScript、Vite、Three.js、FBXLoader、SkeletonUtils、Lucide。
- 服务端：Node.js 22、TypeScript、`ws`、esbuild。
- 模拟：20Hz、整数毫米、确定性随机、服务端权威快照。
- Unity：Unity 6000.3.20f1、URP 17.3、C#、Entities/ECS、Burst、Netcode for Entities。

## 3. 设计约束

- 模型只属于表现层，不能进入权威模拟、伤害、死亡、掉落或胜负逻辑。
- 网络、本地和 Unity 运行时都使用稳定 ID，不按中文显示名猜测模型。
- 英雄必须使用 `HeroId` 映射；野怪必须使用稳定 `ModelId`，未知类型必须有默认模型和 Primitive fallback。
- 运行时对象必须复用；不能每帧销毁/重建角色对象。
- Web 模型按距离懒加载并缓存；模型加载失败时保留可诊断 fallback。
- Unity 模型资源只保留一份导入链路，避免重复 `AssetPostprocessor` 和重复资源包。
- FBX 贴图路径必须通过显式 `Textures/` 资源路径兼容，不能依赖本机绝对路径。
- 所有生成报告必须记录实际路径、数量、状态和失败原因。

## 4. 执行清单

### T0：基线审计

- [x] 读取项目结构、现有运行时、Unity 工程和服务器说明。
- [x] 确认当前 Web、Node、Unity 三套技术栈。
- [x] 确认项目工作树可能存在用户已有改动，不执行 reset/checkout/revert。
- [x] 建立本计划并将每个阶段绑定到命令或报告证据。

### T1：资源落盘与交付报告

- [x] 合并英雄和野怪 `Assets/ProceduralHeroes` 到 Unity 工程。
- [x] 保证每个角色只有一个 FBX、至少一张贴图、一个 clips sidecar 和一个 validation sidecar。
- [x] 统一四段动画语义：`Idle`、`Move`、`Attack`、`Spell`。
- [x] 验证动画帧区间和帧率：`Idle 1-48`、`Move 49-96`、`Attack 97-120`、`Spell 121-144`、24fps。
- [x] 验证英雄优化报告为 38/38 passed。
- [x] 验证野怪优化报告为 38/38 passed。
- [x] 输出 `migration/reports/unity/model-delivery-verification.json`。
- [x] 执行证据：`npm run models:verify`。

### T2：ID、Catalog、Prefab 和 Unity 导入

- [x] 建立完整英雄 `H001-H038` 到源模型名的映射。
- [x] 建立完整野怪 `M001-M038` 到源模型名的映射。
- [x] 建立 8 种 `MonsterKind` 默认模型映射。
- [x] 建立英雄别名映射并测试重复/缺失。
- [x] 由 Unity Editor 生成 76 个 Prefab。
- [x] 为每个 Prefab 生成并绑定 Animator Controller。
- [x] 为每个 Prefab 设置归一化高度、脚底偏移、阴影、LOD 和渲染器参数。
- [x] 生成并校验 `ModelVisualCatalog` ScriptableObject。
- [x] 验证 Catalog 中英雄和野怪 ID 各自唯一且全覆盖。
- [x] 验证缺失模型可回退到默认模型或 Primitive。
- [x] 执行证据：Unity EditMode 测试、AssetDatabase 校验、模型报告。

### T3：Unity 英雄表现接入

- [x] `MatchPlayerView` 使用 HeroId 对应 Prefab。
- [x] 保留选择环、名字、血条、护盾、受击/无敌表现。
- [x] Animator 状态覆盖 Idle、Move、Attack、Spell。
- [x] 保持远端插值、本地预测和网络 Transform 行为不变。
- [x] 模型缺失、导入失败或压力模式下不崩溃，显示 Primitive fallback。
- [x] 验证至少 H001、H009、H018 的真实网格、Animator 和材质。

### T4：Unity 野怪表现接入

- [x] `MonsterView` 使用稳定 ModelId 和 MonsterKind 选择 Prefab。
- [x] 覆盖普通、精英、飞行、猪、龙王和核心 Boss 等 8 类。
- [x] 保留缩放、血条、位置插值、攻击动作和受击表现。
- [x] PVE 123 个实体使用复用对象，不在每帧重建 GameObject。
- [x] 未知 Kind/ModelId 回退到诊断模型或 Primitive。

### T5：Web 模型运行时接入

- [x] 使用 `FBXLoader` 加载远程模型。
- [x] 使用 `SkeletonUtils.clone` 或等价实例复用方式创建角色实例。
- [x] 使用 `AnimationUtils.subclip` 将通用 Scene 动画切成四个运行时状态。
- [x] 模型按视距懒加载，已加载模板缓存，实例销毁时释放引用。
- [x] 模型 URL 使用发布版本 query，绕过旧 CDN 缓存。
- [x] FBX 贴图使用每个模型目录下的 `Textures/`。
- [x] 处理 FBX 中非有限特效节点，主体模型不得因特效节点污染包围盒而失败。
- [x] Web 头像只使用实际存在资源；缺失头像回退到 H009，不产生批量 404。
- [x] 保留 Primitive fallback 和运行时模型诊断数据。

### T6：OSS/CDN 上传

- [x] 仅在当前进程设置以下变量，不写入文件：
  `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_ENDPOINT`、`OSS_BUCKET_NAME`、`OSS_BASE_PATH`、`OSS_CDN_DOMAIN`。
- [x] 上传 Web 构建到：
  `AIGame/JourneyWestGreatBrawl/releases/<release>/`
  和
  `AIGame/JourneyWestGreatBrawl/current/`
- [x] 上传模型到：
  `AIGame/JourneyWestGreatBrawl/models/v1/`
- [x] 上传 76 个模型、82 张贴图和模型 Catalog。
- [x] 模型/哈希静态资源使用 immutable 缓存，HTML 使用 no-cache。
- [x] 配置或验证 OSS CORS：允许 GET/HEAD、允许任意 Origin。
- [x] 验证 Web HTML、JS、CSS、英雄模型、野怪模型和贴图的 HTTP 状态。
- [x] 执行证据：`npm run web:oss:upload`、`npm run verify:web:production`。

### T7：服务器部署

- [x] 服务器目标：`root@47.84.61.45`，域名 `fanavatar.org`。
- [x] 部署 Node 22 服务端 bundle 到 `/opt/jwgb-web/current/server.mjs`。
- [x] 安装并启用 `jwgb-web.service`。
- [x] Nginx 反代 `/health` 到 `127.0.0.1:8787/health`。
- [x] Nginx 为 `/match` 配置 WebSocket Upgrade。
- [x] 保留现有 HTTPS 证书和 HTTP 到 HTTPS 跳转。
- [x] 验证 systemd active、Nginx config test、HTTPS 200、health 200、WSS join。
- [x] 不把 Unity Dedicated Server 暴露为公网业务服务。

### T8：自动化测试与构建

- [x] `npm run typecheck`
- [x] `npm test -- --testTimeout=15000`
- [x] `npm run build`
- [x] `npm run unity:architecture`
- [x] `npm run unity:test`
- [x] `npm run unity:build:windows`
- [x] Windows menu/client smoke
- [x] Windows stress build/smoke
- [x] Linux Dedicated Server build/smoke
- [x] Android build
- [x] Web production HTTP/WSS verification
- [x] Web browser WebGL/model verification

### T9：最终验收

- [x] 计划所有必需项勾选完成。
- [x] 资源报告、Unity 报告、Web 报告和浏览器截图均存在。
- [x] 报告中不出现 AK/SK、密码或其他秘密。
- [x] 工作树中的改动均属于本任务或用户已有改动，不回滚无关修改。
- [x] 记录当前未能执行的设备/平台验收及具体原因；不能用“未报错”代替证据。
- [x] 最终提供运行地址、构建产物位置、测试结果和已知边界。

## 5. 失败处理策略

- 模型下载失败：保留 Primitive，记录 URL、HTTP 状态和模型 ID。
- 贴图路径不匹配：优先修复 `Textures/` 资源路径，不复制大体积资源作为默认方案。
- FBX 包围盒为 NaN：隐藏非有限特效节点，仅使用有效主体网格计算包围盒。
- CDN 旧缓存：给 Web、模型和贴图请求追加 release version query。
- Unity 导入失败：停止生成对应 Prefab，报告错误，不生成伪成功 Catalog。
- 服务器部署失败：保留旧服务版本，先验证临时文件和远端路径，再切换 systemd。

## 6. 当前执行状态

- [x] T0 基线审计
- [x] T1 资源落盘与交付报告
- [x] T2 ID、Catalog、Prefab 和 Unity 导入
- [x] T3 Unity 英雄表现接入
- [x] T4 Unity 野怪表现接入
- [x] T5 Web 模型运行时接入
- [x] T6 OSS/CDN 上传
- [x] T7 服务器部署
- [x] T8 自动化测试与构建
- [x] T9 最终验收

> 状态必须以命令输出、报告或线上行为为依据更新；不能仅因代码存在就勾选。
