import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const sourceRoot = resolve(repositoryRoot, '..', '素材');

export const ANIMATED_CHARACTER_CONFIGS = [
  {
    modelId: 'H004',
    displayName: '蝎子精',
    sourceDirectory:
      process.env.JWGB_H004_ANIMATION_SOURCE?.trim() || join(sourceRoot, '蝎子精_FBX'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
  {
    modelId: 'H010',
    displayName: '二郎神',
    sourceDirectory:
      process.env.JWGB_H010_ANIMATION_SOURCE?.trim() || join(sourceRoot, '二郎神FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
  {
    modelId: 'H011',
    displayName: '哪吒',
    sourceDirectory:
      process.env.JWGB_H011_ANIMATION_SOURCE?.trim() || join(sourceRoot, '哪吒FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
  {
    modelId: 'H012',
    displayName: '六耳猕猴',
    sourceDirectory:
      process.env.JWGB_H012_ANIMATION_SOURCE?.trim() || join(sourceRoot, '六耳猕猴_FBX'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
  {
    modelId: 'H014',
    displayName: '白骨精',
    sourceDirectory:
      process.env.JWGB_H014_ANIMATION_SOURCE?.trim() || join(sourceRoot, '白骨精新版'),
    targetHeight: 2.2,
    expectedBones: 41,
    requiresSeparateWeapon: false,
    clipPatterns: {
      Idle: 'preset:biped:look_around_retimed',
      Move: 'preset:biped:run',
      Attack: 'preset:biped:box_02_retimed_retimed',
      Spell: 'preset:biped:angry_01_retimed_retimed',
    },
  },
  {
    modelId: 'H018',
    displayName: '牛魔王',
    sourceDirectory:
      process.env.JWGB_H018_ANIMATION_SOURCE?.trim() || join(sourceRoot, '牛魔王FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 41,
    clipPatterns: {
      Idle: 'standing_relax',
      Move: 'biped:run',
      Attack: 'biped:angry_03',
      Spell: 'biped:angry_01',
    },
  },
  {
    modelId: 'H019',
    displayName: '独角兕大王',
    sourceDirectory:
      process.env.JWGB_H019_ANIMATION_SOURCE?.trim() || join(sourceRoot, '独角兕FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 41,
    clipPatterns: {
      Idle: 'biped:look_around',
      Move: 'biped:run',
      Attack: 'biped:complain_01_retimed',
      Spell: 'biped:complain_01_retimed',
    },
  },
  {
    modelId: 'H023',
    displayName: '黄袍怪',
    sourceDirectory:
      process.env.JWGB_H023_ANIMATION_SOURCE?.trim() || join(sourceRoot, '黄袍怪FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
  {
    modelId: 'H034',
    displayName: '黑熊精',
    sourceDirectory:
      process.env.JWGB_H034_ANIMATION_SOURCE?.trim() || join(sourceRoot, '黑熊精FBX模型动画'),
    targetHeight: 2.2,
    expectedBones: 41,
    clipPatterns: {
      Idle: 'biped:look_around',
      Move: 'biped:run',
      Attack: 'biped:cast_a_spell_retimed',
      Spell: 'biped:cheer',
    },
  },
  {
    modelId: 'H038',
    displayName: '赛太岁',
    sourceDirectory:
      process.env.JWGB_H038_ANIMATION_SOURCE?.trim() || join(sourceRoot, '赛太岁_FBX'),
    targetHeight: 2.2,
    expectedBones: 33,
    clipPatterns: {
      Idle: null,
      Move: null,
      Attack: null,
      Spell: null,
    },
  },
].map((config) => ({
  ...config,
  requiresSeparateWeapon: config.requiresSeparateWeapon ?? true,
  outputDirectory: join(
    repositoryRoot,
    'apps',
    'web',
    'public',
    'models',
    'characters',
    config.modelId,
  ),
  bodyTriangleBudget: 28_000,
  weaponTriangleBudget: 10_000,
  totalTriangleBudget: 40_000,
  fileByteBudget: 12 * 1024 * 1024,
  textureSize: 1024,
  textureQuality: 82,
}));

export function selectedAnimatedCharacterConfigs(argv = process.argv.slice(2)) {
  const idsArgument = argv.find((argument) => argument.startsWith('--ids='));
  if (!idsArgument) {
    return ANIMATED_CHARACTER_CONFIGS;
  }
  const requestedIds = new Set(
    idsArgument
      .slice('--ids='.length)
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  const selected = ANIMATED_CHARACTER_CONFIGS.filter((config) => requestedIds.has(config.modelId));
  const missing = [...requestedIds].filter(
    (modelId) => !ANIMATED_CHARACTER_CONFIGS.some((config) => config.modelId === modelId),
  );
  if (missing.length > 0) {
    throw new Error(`unknown animated character ids: ${missing.join(', ')}`);
  }
  return selected;
}

export { repositoryRoot };
