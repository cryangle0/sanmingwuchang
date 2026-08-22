/**
 * 修为 progression, transcribed from the engineering source projection.
 *
 * These 50 rows are design content — what each level is called and what
 * cosmetic it grants — taken from rule 47 (`xiuwei.track`) of
 * `source-rule-projection.json` in the design prototype, which projects the
 * canonical 真源 document. They describe the ladder, not any player's place on
 * it: there is no account service yet, so progress is always read as zero and
 * every reward renders locked. Every reward on this track is cosmetic; none of
 * it changes combat.
 */

export interface CultivationStep {
  readonly level: number;
  /** Realm and tier, e.g. 化神·三层. */
  readonly realm: string;
  /** 修为 needed from the previous level. */
  readonly required: number;
  /** 修为 needed from level 1. */
  readonly cumulative: number;
  readonly reward: string;
}

/** The eight realms, in order. Each spans six levels; the last absorbs the remainder. */
export const CULTIVATION_REALMS = [
  '凡人',
  '炼气',
  '筑基',
  '金丹',
  '元婴',
  '化神',
  '大罗',
  '齐天',
] as const;

export const CULTIVATION_TRACK: readonly CultivationStep[] = [
  { level: 1, realm: '凡人·一层', required: 0, cumulative: 0, reward: '初始形象(纯外观)' },
  { level: 2, realm: '凡人·一层', required: 70, cumulative: 70, reward: '头像框(纯外观)' },
  { level: 3, realm: '凡人·二层', required: 80, cumulative: 150, reward: '称号(纯外观)' },
  { level: 4, realm: '凡人·二层', required: 80, cumulative: 230, reward: '名片底纹(纯外观)' },
  { level: 5, realm: '凡人·三层', required: 90, cumulative: 320, reward: '边框特效(纯外观)' },
  { level: 6, realm: '凡人·三层', required: 100, cumulative: 420, reward: '击杀播报样式(纯外观)' },
  {
    level: 7,
    realm: '炼气·一层',
    required: 110,
    cumulative: 530,
    reward: '境界称号[炼气]+专属头像框(纯外观)',
  },
  { level: 8, realm: '炼气·一层', required: 110, cumulative: 640, reward: '称号(纯外观)' },
  { level: 9, realm: '炼气·二层', required: 120, cumulative: 760, reward: '名片底纹(纯外观)' },
  { level: 10, realm: '炼气·二层', required: 130, cumulative: 890, reward: '边框特效(纯外观)' },
  {
    level: 11,
    realm: '炼气·三层',
    required: 150,
    cumulative: 1040,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 12, realm: '炼气·三层', required: 160, cumulative: 1200, reward: '头像框(纯外观)' },
  {
    level: 13,
    realm: '筑基·一层',
    required: 170,
    cumulative: 1370,
    reward: '境界称号[筑基]+专属头像框(纯外观)',
  },
  { level: 14, realm: '筑基·一层', required: 190, cumulative: 1560, reward: '名片底纹(纯外观)' },
  { level: 15, realm: '筑基·二层', required: 200, cumulative: 1760, reward: '边框特效(纯外观)' },
  {
    level: 16,
    realm: '筑基·二层',
    required: 220,
    cumulative: 1980,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 17, realm: '筑基·三层', required: 240, cumulative: 2220, reward: '头像框(纯外观)' },
  { level: 18, realm: '筑基·三层', required: 260, cumulative: 2480, reward: '称号(纯外观)' },
  {
    level: 19,
    realm: '金丹·一层',
    required: 280,
    cumulative: 2760,
    reward: '境界称号[金丹]+专属头像框(纯外观)',
  },
  { level: 20, realm: '金丹·一层', required: 300, cumulative: 3060, reward: '边框特效(纯外观)' },
  {
    level: 21,
    realm: '金丹·二层',
    required: 330,
    cumulative: 3390,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 22, realm: '金丹·二层', required: 360, cumulative: 3750, reward: '头像框(纯外观)' },
  { level: 23, realm: '金丹·三层', required: 390, cumulative: 4140, reward: '称号(纯外观)' },
  { level: 24, realm: '金丹·三层', required: 420, cumulative: 4560, reward: '名片底纹(纯外观)' },
  {
    level: 25,
    realm: '元婴·一层',
    required: 460,
    cumulative: 5020,
    reward: '境界称号[元婴]+专属头像框(纯外观)',
  },
  {
    level: 26,
    realm: '元婴·一层',
    required: 500,
    cumulative: 5520,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 27, realm: '元婴·二层', required: 540, cumulative: 6060, reward: '头像框(纯外观)' },
  { level: 28, realm: '元婴·二层', required: 580, cumulative: 6640, reward: '称号(纯外观)' },
  { level: 29, realm: '元婴·三层', required: 630, cumulative: 7270, reward: '名片底纹(纯外观)' },
  { level: 30, realm: '元婴·三层', required: 690, cumulative: 7960, reward: '边框特效(纯外观)' },
  {
    level: 31,
    realm: '化神·一层',
    required: 750,
    cumulative: 8710,
    reward: '境界称号[化神]+专属头像框(纯外观)',
  },
  { level: 32, realm: '化神·一层', required: 810, cumulative: 9520, reward: '头像框(纯外观)' },
  { level: 33, realm: '化神·二层', required: 880, cumulative: 10400, reward: '称号(纯外观)' },
  { level: 34, realm: '化神·二层', required: 950, cumulative: 11350, reward: '名片底纹(纯外观)' },
  { level: 35, realm: '化神·三层', required: 1030, cumulative: 12380, reward: '边框特效(纯外观)' },
  {
    level: 36,
    realm: '化神·三层',
    required: 1120,
    cumulative: 13500,
    reward: '击杀播报样式(纯外观)',
  },
  {
    level: 37,
    realm: '大罗·一层',
    required: 1220,
    cumulative: 14720,
    reward: '境界称号[大罗]+专属头像框(纯外观)',
  },
  { level: 38, realm: '大罗·一层', required: 1320, cumulative: 16040, reward: '称号(纯外观)' },
  { level: 39, realm: '大罗·二层', required: 1430, cumulative: 17470, reward: '名片底纹(纯外观)' },
  { level: 40, realm: '大罗·二层', required: 1550, cumulative: 19020, reward: '边框特效(纯外观)' },
  {
    level: 41,
    realm: '大罗·三层',
    required: 1690,
    cumulative: 20710,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 42, realm: '大罗·三层', required: 1830, cumulative: 22540, reward: '头像框(纯外观)' },
  {
    level: 43,
    realm: '齐天·一层',
    required: 1980,
    cumulative: 24520,
    reward: '境界称号[齐天]+专属头像框(纯外观)',
  },
  { level: 44, realm: '齐天·一层', required: 2150, cumulative: 26670, reward: '名片底纹(纯外观)' },
  { level: 45, realm: '齐天·二层', required: 2340, cumulative: 29010, reward: '边框特效(纯外观)' },
  {
    level: 46,
    realm: '齐天·二层',
    required: 2540,
    cumulative: 31550,
    reward: '击杀播报样式(纯外观)',
  },
  { level: 47, realm: '齐天·三层', required: 2750, cumulative: 34300, reward: '头像框(纯外观)' },
  { level: 48, realm: '齐天·三层', required: 2980, cumulative: 37280, reward: '称号(纯外观)' },
  { level: 49, realm: '齐天·三层', required: 3240, cumulative: 40520, reward: '名片底纹(纯外观)' },
  { level: 50, realm: '齐天·三层', required: 3510, cumulative: 44030, reward: '边框特效(纯外观)' },
];

/** Total 修为 from level 1 to 50. */
export const CULTIVATION_TOTAL = CULTIVATION_TRACK[CULTIVATION_TRACK.length - 1]?.cumulative ?? 0;

/** Short mark for a reward, used on the track cards. */
export function rewardMark(reward: string): string {
  if (/头像框|边框/.test(reward)) {
    return '框';
  }
  if (/称号|名号/.test(reward)) {
    return '名';
  }
  if (/名片/.test(reward)) {
    return '牌';
  }
  if (/播报/.test(reward)) {
    return '报';
  }
  return '饰';
}
