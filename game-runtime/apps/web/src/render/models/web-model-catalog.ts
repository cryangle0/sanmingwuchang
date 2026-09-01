import type { FiveElement } from '@jwgb/content';
import type { EntityId } from '@jwgb/core';
import type { MonsterKind, ShopKind } from '@jwgb/sim';

export interface WebModelDefinition {
  readonly id: string;
  readonly sourceName: string;
  readonly kind: 'hero' | MonsterKind | 'shop';
  readonly height: number;
  readonly assetBase: 'model-cdn' | 'web';
  readonly format: 'fbx' | 'glb';
  readonly assetPath: string;
  readonly animationStates?: readonly ('Idle' | 'Move' | 'Attack' | 'Spell')[];
}

export interface WebShopModelDefinition extends WebModelDefinition {
  readonly kind: 'shop';
  readonly shopKind: ShopKind;
}

function hero(
  id: string,
  sourceName: string,
  height = 2.2,
  asset: Pick<WebModelDefinition, 'assetBase' | 'format' | 'assetPath'> = {
    assetBase: 'model-cdn',
    format: 'fbx',
    assetPath: `heroes/${id}/model.fbx`,
  },
): WebModelDefinition {
  return {
    id,
    sourceName,
    kind: 'hero',
    height,
    ...asset,
  };
}

function monster(
  id: string,
  sourceName: string,
  kind: MonsterKind,
  height = kind === 'core-boss'
    ? 4.4
    : kind === 'dragon-king'
      ? 3.8
      : kind === 'elite-tank' || kind === 'elite-ranged'
        ? 2.6
        : 1.7,
): WebModelDefinition {
  return {
    id,
    sourceName,
    kind,
    height,
    assetBase: 'model-cdn',
    format: 'fbx',
    assetPath: `monsters/${id}/model.fbx`,
  };
}

function shop(
  id: string,
  sourceName: string,
  shopKind: ShopKind,
  height: number,
): WebShopModelDefinition {
  return {
    id,
    sourceName,
    kind: 'shop',
    shopKind,
    height,
    assetBase: 'web',
    format: 'glb',
    assetPath: `models/shops/${id}/model.glb`,
    animationStates: ['Idle'],
  };
}

export const WEB_HERO_MODELS: readonly WebModelDefinition[] = [
  hero('H001', '铁山公主'),
  hero('H002', '红孩儿', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H002/model.glb',
  }),
  hero('H003', '蜘蛛精'),
  hero('H004', '蝎子精', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H004/model.glb',
  }),
  hero('H005', '多目怪'),
  hero('H006', '九头虫', 2.4, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H006/model.glb',
  }),
  hero('H007', '黄风怪', 2.4, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H007/model.glb',
  }),
  hero('H008', '太上老君', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H008/model.glb',
  }),
  hero('H009', '孙悟空', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H009/model.glb',
  }),
  hero('H010', '二郎神', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H010/model.glb',
  }),
  hero('H011', '哪吒', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H011/model.glb',
  }),
  hero('H012', '六耳猕猴', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H012/model.glb',
  }),
  hero('H013', '大鹏雕', 2.5),
  hero('H014', '白骨精', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H014/model.glb',
  }),
  hero('H015', '猪八戒', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H015/model.glb',
  }),
  hero('H016', '白龙马', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H016/model.glb',
  }),
  hero('H017', '青狮精'),
  hero('H018', '牛魔王', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H018/model.glb',
  }),
  hero('H019', '独角四大王', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H019/model.glb',
  }),
  hero('H020', '黄眉老祖'),
  hero('H021', '金角大王'),
  hero('H022', '银角大王'),
  hero('H023', '黄袍怪', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H023/model.glb',
  }),
  hero('H024', '虎力大仙'),
  hero('H025', '鹿力大仙'),
  hero('H026', '文殊菩萨'),
  hero('H027', '普贤菩萨'),
  hero('H028', '镇元大仙'),
  hero('H029', '如来'),
  hero('H030', '观音菩萨'),
  hero('H031', '托塔李天王', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H031/model.glb',
  }),
  hero('H032', '唐僧'),
  hero('H033', '沙和尚', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H033/model.glb',
  }),
  hero('H034', '黑熊精', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H034/model.glb',
  }),
  hero('H035', '白象精'),
  hero('H036', '灵感大王'),
  hero('H037', '羊力大仙'),
  hero('H038', '赛太岁', 2.2, {
    assetBase: 'web',
    format: 'glb',
    assetPath: 'models/characters/H038/model.glb',
  }),
];

export const WEB_MONSTER_MODELS: readonly WebModelDefinition[] = [
  monster('M001', '倚海龙', 'ground-melee'),
  monster('M002', '刁钻古怪', 'ground-ranged'),
  monster('M003', '南山大王（精英怪）', 'elite-tank'),
  monster('M004', '古怪刁钻', 'ground-melee'),
  monster('M005', '如意真仙', 'ground-ranged'),
  monster('M006', '孔雀公主（飞行）', 'flying'),
  monster('M007', '寅将军（精英怪）', 'elite-ranged'),
  monster('M008', '巴山虎', 'ground-melee'),
  monster('M009', '晦月魔君（飞行）', 'flying'),
  monster('M010', '树鬼', 'ground-melee'),
  monster('M011', '混天大圣（飞行）', 'flying'),
  monster('M012', '火鸦精', 'flying'),
  monster('M013', '熊山君（精英怪）', 'elite-tank'),
  monster('M014', '特处士（精英怪）', 'elite-ranged'),
  monster('M015', '玉面狐狸（肥猪）', 'pig'),
  monster('M016', '碧水金睛兽（飞行）', 'flying'),
  monster('M017', '红鳞大蟒', 'ground-melee'),
  monster('M018', '肥猪（土）', 'pig'),
  monster('M019', '肥猪（木）', 'pig'),
  monster('M020', '肥猪（水）', 'pig'),
  monster('M021', '肥猪（火）', 'pig'),
  monster('M022', '肥猪（金）', 'pig'),
  monster('M023', '苍狼精', 'ground-melee'),
  monster('M024', '虎精小妖', 'ground-melee'),
  monster('M025', '蛇精小妖', 'ground-ranged'),
  monster('M026', '蜘蛛仔', 'ground-melee'),
  monster('M027', '超级BOSS九灵元圣', 'core-boss'),
  monster('M028', '超级BOSS地涌夫人', 'core-boss'),
  monster('M029', '超级BOSS白鹿魔王', 'core-boss'),
  monster('M030', '超级BOSS辟寒大王', 'core-boss'),
  monster('M031', '超级BOSS辟尘大王', 'core-boss'),
  monster('M032', '超级BOSS辟暑大王', 'core-boss'),
  monster('M033', '黄狮精', 'ground-melee'),
  monster('M034', '龙王（土）', 'dragon-king'),
  monster('M035', '龙王（木）', 'dragon-king'),
  monster('M036', '龙王（水）', 'dragon-king'),
  monster('M037', '龙王（火）', 'dragon-king'),
  monster('M038', '龙王（金）', 'dragon-king'),
];

export const WEB_SHOP_MODELS: readonly WebShopModelDefinition[] = [
  shop('S001', '鞋匠', 'shoemaker', 2.05),
  shop('S002', '太白金星', 'taibai', 2.2),
  shop('S003', '土地公', 'land-god', 1.8),
  shop('S004', '黑山老妖', 'heishan', 2.6),
];

const HERO_MODEL_BY_ID = new Map(WEB_HERO_MODELS.map((definition) => [definition.id, definition]));
const MONSTER_MODEL_BY_ID = new Map(
  WEB_MONSTER_MODELS.map((definition) => [definition.id, definition]),
);
const SHOP_MODEL_BY_KIND = new Map<ShopKind, WebShopModelDefinition>(
  WEB_SHOP_MODELS.map((definition) => [definition.shopKind, definition] as const),
);
const MONSTER_MODELS_BY_KIND = new Map<MonsterKind, readonly WebModelDefinition[]>();
const ELEMENTAL_PIG_MODEL_IDS: Readonly<Record<FiveElement, string>> = {
  earth: 'M018',
  wood: 'M019',
  water: 'M020',
  fire: 'M021',
  metal: 'M022',
};
const ELEMENTAL_DRAGON_MODEL_IDS: Readonly<Record<FiveElement, string>> = {
  earth: 'M034',
  wood: 'M035',
  water: 'M036',
  fire: 'M037',
  metal: 'M038',
};
const GENERIC_PIG_MODEL_ID = 'M015';
const GENERIC_PIG_VARIANT_MODULUS = 6;

for (const kind of [
  'ground-melee',
  'ground-ranged',
  'flying',
  'pig',
  'elite-tank',
  'elite-ranged',
  'dragon-king',
  'core-boss',
] as const) {
  MONSTER_MODELS_BY_KIND.set(
    kind,
    WEB_MONSTER_MODELS.filter((definition) => definition.kind === kind),
  );
}

export function heroModelDefinition(heroId: string): WebModelDefinition | null {
  return HERO_MODEL_BY_ID.get(heroId) ?? null;
}

export function monsterModelDefinition(
  kind: MonsterKind,
  entityId: EntityId,
  element: FiveElement | null = null,
  rootSeed = 0,
): WebModelDefinition | null {
  const numericId = Math.abs(Number(entityId));
  if (kind === 'pig' && element) {
    const modelId =
      numericId % GENERIC_PIG_VARIANT_MODULUS === 0
        ? GENERIC_PIG_MODEL_ID
        : ELEMENTAL_PIG_MODEL_IDS[element];
    return MONSTER_MODEL_BY_ID.get(modelId) ?? null;
  }
  if (kind === 'dragon-king' && element) {
    return MONSTER_MODEL_BY_ID.get(ELEMENTAL_DRAGON_MODEL_IDS[element]) ?? null;
  }
  if (kind === 'core-boss') {
    return (
      MONSTER_MODEL_BY_ID.get(`M${(27 + ((rootSeed >>> 0) % 6)).toString().padStart(3, '0')}`) ??
      null
    );
  }

  const candidates = MONSTER_MODELS_BY_KIND.get(kind);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  return candidates[numericId % candidates.length] ?? candidates[0] ?? null;
}

export function shopModelDefinition(shopKind: ShopKind): WebShopModelDefinition | null {
  return SHOP_MODEL_BY_KIND.get(shopKind) ?? null;
}
