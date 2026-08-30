# 第三方来源

## world-of-claudecraft

地面浮雕着色技术（偏移视差、cavity 暗部、朝阳微观自阴影，以及"按通道均值零均值化
以便 mip 随距离自动淡出"的做法）移植自 world-of-claudecraft，并适配到本项目的权威
高度场。随之引入的打包地面 AO 贴图 `apps/web/public/assets/terrain/GroundAO_Packed.png`
（R 草 / G 土 / B 岩 / A 沙）同样来自该项目。

- 项目：https://github.com/levy-street/world-of-claudecraft
- 代码许可：MIT License, Copyright (c) 2026 Levy Street
- 贴图来源：ambientCG 等 CC0 1.0 素材，经该项目离线打包

MIT 许可要求保留版权声明与许可声明，本文件即为该声明。

## 地形贴图

`apps/web/public/assets/terrain/` 下的 Grass001 / Ground023 / Rock026 /
PavingStones046 系列来自 ambientCG，CC0 1.0。

## Grassworks WebGPU 演示适配

全地图草地的 25 米区块、四级 LOD、2x2 图集、风摆、角色压草影响图，以及树木高模/
广告牌 LOD 结构，适配自用户提供的本地目录
`grassworks-webgpu-demo-webrip-main`。原演示使用 three.js r185 WebGPU/TSL；本项目在
现有 three.js r165 WebGL 渲染器上实现等价运行机制，并非原代码原样运行。

- 树模型衍生自来源目录中的 `grass-webgpu/Assets/terrain2.glb`。
- 来源目录内未发现许可证文件，因此不得将这些树模型视为已确认可商用素材。
- 来源 `grass-atlas5.png` 带有可见 pngtree 水印且无随附许可，未纳入运行时产物。
- 运行时 `models/grassworks/grass-atlas5.png` 由项目已有的
  `assets/terrain/Grass001_Stylized.jpg` 生成；其来源为 ambientCG，CC0 1.0。
