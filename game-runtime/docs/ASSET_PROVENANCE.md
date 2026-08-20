# Asset Provenance

## Delivery Rules

The external scene packs listed below were supplied by the project owner as
purchased and authorized resources. The Web release contains only converted,
optimized derivatives. Original Unitypackages, FBX files, PSD files, and
source archives stay outside the Web bundle.

The authoritative map, roads, landmarks, and collision field remain generated
from the project's compiled map geometry. Imported models are render-only
decoration and never change gameplay collision or simulation state.

## Imported Scene Assets

### Wuxia architecture

Source pack: the purchased 80-scene Chinese wuxia/immortal-hero Unity pack.

Converted delivery assets:

- `wuxia-citadel.glb` from `45.FBX`
- `wuxia-gate-court.glb` from `51.FBX`
- `wuxia-east-asia-hall.glb` from `54.FBX`
- `wuxia-mountain-gate.glb` from `60.FBX`

The converter excludes terrain, vegetation, sky, walls, stairs, bridges, and
the known `Item_Palace006` platform from the mountain-gate export. This keeps
the imported architecture from duplicating the procedural ground or blocking
combat lanes.

### Lowpoly Asian village

Source pack: `Lowpoly Style Ultra Pack 1.2.unitypackage` from the purchased
lowpoly forest/island/desert collection.

`lowpoly-asian-village.glb` is a single precomposed landmark containing:

- `AsianHouse_Big2`
- `AsianHouse_Big3`
- `Torii2`
- `ZenGarden`
- `RockFormation1`

The combined delivery is approximately 1.2 MB and 47k triangles after
Meshopt/WebP optimization. It is delivered as one GLB so the runtime can keep
the village to a small number of static draw calls instead of loading five
independent scene assets.

Additional lowpoly delivery assets:

- `asia-house.glb` from `AsianHouse_2.fbx`
- `torii-2.glb` from `Torii2.fbx`
- `rock-formation-2.glb` from `RockFormation2.fbx`

These are placed as a small number of distance-culled render-only landmarks.
They are not included in the authoritative collision field.

### C1524 rocks

Source pack: the purchased C1524 cartoon rock collection.

- 15 optimized `desert-rock-*.glb` assets from `Desert Rocks`
- 9 optimized `stylized-rock-*.glb` assets from `ST-PaCK`

Each delivered rock stays below the 4k triangle budget and is rendered through
`InstancedMesh` batches with distance culling.

## Terrain Textures

The Web map uses the following ambientCG texture sets and in-project
derivatives:

- `Grass001_Stylized.jpg` derived from ambientCG `Grass001_Color.jpg`
- `Ground023_Stylized.jpg` derived from ambientCG `Ground023_Color.jpg`
- `Rock026_Color.jpg`

Source: ambientCG.

License: Creative Commons CC0 1.0 Universal.

These files are redistributed as public-domain assets and are separate from
the purchased scene-pack derivatives.

## Map Foliage Models

The map environment uses optimized static models copied unchanged from the
verified reference project:

- `apps/web/public/models/foliage/`: `pine_*`, `oak_*`, `twisted_*`,
  `dead_*`, `rock_*`, `bush.glb`, `fern.glb`, and `mushroom.glb`
- Source project: `world-of-claudecraft-main/public/models/foliage/`
- Original source: Quaternius Stylized Nature MegaKit
- License: Creative Commons CC0 1.0 Universal

The models are parsed once and rendered through `InstancedMesh` batches.

### Lowpoly foliage and small props

The purchased `0072lowpoly森林岛屿沙漠` Unitypackage is converted into:

- `asia-tree.glb` and `red-maple.glb` for region-selected tree instances
- `asia-bush.glb`, `reed-big.glb`, `small-plant-1.glb`, and
  `small-plant-2.glb` for deterministic wall-foot, structure-perimeter, and
  biome dressing

The runtime keeps these assets render-only, batches repeated meshes with
`InstancedMesh`, and preserves a small initial instance budget with road,
court, wall, and landmark rejection tests.

### Blender Poly Nature foliage

Source pack: the purchased Blender stylized nature collection, identified in
the source file as Poly Nature Pack 1.0.0.

The Web delivery uses six selected low-cost derivatives exported with Blender
4.2.23 LTS, normalized to metres, then optimized with Meshopt and WebP:

- `beech-poly.glb`: 7.8 m, 1,661 triangles
- `willow-poly.glb`: 7.4 m, 2,138 triangles
- `cypress-poly.glb`: 7.2 m, 918 triangles
- `dead-beech-poly.glb`: 6.8 m, 741 triangles
- `dead-cypress-poly.glb`: 6.8 m, 426 triangles
- `burdock-poly.glb`: 1.05 m, 196 triangles

The five tree variants replace a deterministic share of the heavier legacy
tree instances. The reduced graphics tier uses these variants as its primary
tree set and keeps burdock as its only imported groundcover. Burdock is treated
as groundcover rather than a shrub, so its final height remains close to one
metre. All repeated instances are spatially chunked and rendered through
`InstancedMesh`.

## Basis Transcoder

`apps/web/public/basis/basis_transcoder.js` and
`apps/web/public/basis/basis_transcoder.wasm` are the Basis Universal KTX2
transcoder copied from three.js r165's examples distribution.

- Source: three.js / Basis Universal
- License: Apache-2.0

The transcoder is required because the CC0 foliage GLBs use
`KHR_texture_basisu`.

## Animated Wukong Character

The project owner's `素材` directory supplies four purchased and authorized
FBX animation exports for the same cartoon Sun Wukong character:

- `01_待机_idle.fbx`
- `02_跑步_run.fbx`
- `03_攻击_attack.fbx`
- `04_施法_cast.fbx`

The Web release combines the shared 41-joint skeleton and the four clips into
`models/characters/H009/model.glb`. Conversion removes a duplicated
500,000-triangle static mesh, simplifies the retained skinned mesh to a
23,000-triangle budget, embeds 1024-pixel WebP textures, applies Meshopt
compression, and retargets every position track to the Idle skeleton's local
rest transforms. Planar root motion is removed so animation cannot move the
visual away from the authoritative gameplay entity.

The original FBX files total approximately 129 MB and remain outside the Web
bundle. The optimized derivative is below 1 MB and is normalized at runtime to
the same 2.2-metre presentation height used by the H009 gameplay definition.

## Additional Animated Heroes

The project owner's `素材` directory also supplies purchased and authorized
four-action FBX exports for:

- `H004` 蝎子精
- `H010` 二郎神
- `H011` 哪吒
- `H012` 六耳猕猴
- `H014` 白骨精
- `H018` 牛魔王
- `H019` 独角兕大王
- `H023` 黄袍怪
- `H034` 黑熊精
- `H038` 赛太岁

Each delivery contains `Idle`, `Move`, `Attack`, and `Spell` source files. The
Web conversion retains multi-part skinned bodies and separate weapons where
provided; fully skinned characters are also supported. It selects the intended
semantic clip when an FBX embeds duplicate takes, retargets local rest positions
to the Idle skeleton, and removes planar root motion. Geometry is simplified to
a combined 40,000-triangle ceiling, textures are converted to WebP, and the
result uses Meshopt compression.

The optimized derivatives are delivered as:

- `models/characters/H004/model.glb`
- `models/characters/H010/model.glb`
- `models/characters/H011/model.glb`
- `models/characters/H012/model.glb`
- `models/characters/H014/model.glb`
- `models/characters/H018/model.glb`
- `models/characters/H019/model.glb`
- `models/characters/H023/model.glb`
- `models/characters/H034/model.glb`
- `models/characters/H038/model.glb`

The original FBX files remain outside the Web bundle. Runtime presentation
normalizes all ten models to their existing 2.2-metre catalog height.
