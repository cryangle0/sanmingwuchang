import { M0_RULES, MAP_COURTS } from '@jwgb/content';
import {
  distanceSquaredMm,
  type EntityId,
  entityId,
  moveToward,
  normalizeAxisPair,
  TICKS_PER_SECOND,
  type Vec2Mm,
  vec2Mm,
} from '@jwgb/core';
import { sortedPlayers } from '../state';
import type {
  CoreBossAbilityId,
  CoreBossHazard,
  CoreBossRevealAnchor,
  CoreBossRuntimeState,
  CoreBossTargetMark,
  MonsterEntity,
  MutableSimulationState,
  PlayerEntity,
  SimEvent,
  SummonEntity,
} from '../types';
import { hasDirectLineOfSight } from './active-targeting';
import { applyDamage } from './damage';
import { resolveTargetForcedDisplacement, resolveWorldMovement } from './displacement';
import { isInNormalStormZone } from './storm-zone';
import { applyHardControl } from './whirlwind';

const TRUE_SIGHT_RADIUS_MM = 10_000;
const PUBLIC_RING_RADIUS_MM = 10_000;
const METEOR_RADIUS_MM = 6_000;
const EARTHBREAK_LENGTH_MM = 20_000;
const EARTHBREAK_WIDTH_MM = 2_000;
const EARTHBREAK_GAP_MM = 3_000;
const FIRELANE_LENGTH_MM = 18_000;
const FIRELANE_WIDTH_MM = 3_000;
const WINDCHARGE_LENGTH_MM = 18_000;
const WINDCHARGE_WIDTH_MM = 3_000;
const POISON_RADIUS_MM = 5_000;
const MIRROR_DURATION_TICKS = 10 * TICKS_PER_SECOND;
const MIRROR_ATTACK_PERIOD_TICKS = Math.ceil(TICKS_PER_SECOND / 0.8);

type CoreBossSignatureAbilityId = Exclude<CoreBossAbilityId, 'ring-shockwave' | 'meteor'>;

const SIGNATURES: readonly CoreBossSignatureAbilityId[] = [
  'earthbreak',
  'firelane',
  'poisonpool',
  'windcharge',
  'thunderchain',
  'mirrorshadow',
];

const SIGNATURE_COOLDOWNS_SECONDS: Readonly<Record<CoreBossSignatureAbilityId, number>> = {
  earthbreak: 16,
  firelane: 18,
  poisonpool: 20,
  windcharge: 16,
  thunderchain: 18,
  mirrorshadow: 24,
};

const ROTATED_DIRECTIONS: readonly Vec2Mm[] = [
  vec2Mm(1_000, 0),
  vec2Mm(-500, 866),
  vec2Mm(-500, -866),
] as const;

function allocateEntityId(state: MutableSimulationState): EntityId {
  const allocated = entityId(state.nextEntityId);
  state.nextEntityId += 1;
  return allocated;
}

function secondsToTicks(seconds: number, cooldownScale = 1): number {
  return Math.max(1, Math.ceil(seconds * TICKS_PER_SECOND * cooldownScale));
}

function coreCooldownScale(state: MutableSimulationState): number {
  return state.tick >= 10 * 60 * TICKS_PER_SECOND ? 0.9 : 1;
}

function clonePoint(point: Vec2Mm): Vec2Mm {
  return vec2Mm(point.x, point.z);
}

function directionBetween(from: Vec2Mm, to: Vec2Mm, fallback: Vec2Mm): Vec2Mm {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) {
    return normalizeAxisPair(fallback.x, fallback.z);
  }
  return normalizeAxisPair(dx, dz);
}

function pointAlong(origin: Vec2Mm, direction: Vec2Mm, distanceMm: number): Vec2Mm {
  return vec2Mm(
    origin.x + Math.trunc((direction.x * distanceMm) / 1_000),
    origin.z + Math.trunc((direction.z * distanceMm) / 1_000),
  );
}

function pointDistanceToSegmentSquared(point: Vec2Mm, start: Vec2Mm, end: Vec2Mm): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) {
    return distanceSquaredMm(point, start);
  }
  const projection = Math.max(
    0,
    Math.min(lengthSquared, (point.x - start.x) * dx + (point.z - start.z) * dz),
  );
  const closest = vec2Mm(
    start.x + Math.trunc((dx * projection) / lengthSquared),
    start.z + Math.trunc((dz * projection) / lengthSquared),
  );
  return distanceSquaredMm(point, closest);
}

function pointInLine(
  point: Vec2Mm,
  start: Vec2Mm,
  direction: Vec2Mm,
  lengthMm: number,
  widthMm: number,
): boolean {
  const end = pointAlong(start, direction, lengthMm);
  return pointDistanceToSegmentSquared(point, start, end) <= Math.trunc(widthMm / 2) ** 2;
}

function pointInCenteredLine(
  point: Vec2Mm,
  center: Vec2Mm,
  direction: Vec2Mm,
  lengthMm: number,
  widthMm: number,
): boolean {
  const halfStart = pointAlong(center, direction, -Math.trunc(lengthMm / 2));
  const halfEnd = pointAlong(center, direction, Math.trunc(lengthMm / 2));
  return pointDistanceToSegmentSquared(point, halfStart, halfEnd) <= Math.trunc(widthMm / 2) ** 2;
}

function livingPlayers(state: MutableSimulationState): PlayerEntity[] {
  return sortedPlayers(state).filter(
    (player) => player.lifeState === 'alive' && player.invulnerableTicks <= 0,
  );
}

function bossCanSeePlayer(
  state: MutableSimulationState,
  boss: MonsterEntity,
  player: PlayerEntity,
): boolean {
  if (player.lifeState !== 'alive') {
    return false;
  }
  if (
    !hasDirectLineOfSight(
      state,
      boss.position,
      player.position,
      boss.collisionRadiusMm + M0_RULES.playerCapsuleRadiusMm,
    )
  ) {
    return false;
  }
  const hidden = player.stealthTicks > 0 || player.nightCloakStealthed;
  return (
    !hidden ||
    distanceSquaredMm(boss.position, player.position) <= TRUE_SIGHT_RADIUS_MM * TRUE_SIGHT_RADIUS_MM
  );
}

function targetCandidates(state: MutableSimulationState, boss: MonsterEntity): PlayerEntity[] {
  return livingPlayers(state).filter((player) => {
    if (
      distanceSquaredMm(boss.position, player.position) >
      boss.aggroRadiusMm * boss.aggroRadiusMm
    ) {
      return false;
    }
    if (
      distanceSquaredMm(boss.homePosition, player.position) >
      boss.leashRadiusMm * boss.leashRadiusMm
    ) {
      return false;
    }
    return bossCanSeePlayer(state, boss, player);
  });
}

function threatValue(state: MutableSimulationState, player: PlayerEntity): number {
  return state.coreBossThreat.get(player.entityId) ?? 0;
}

function selectThreatTarget(
  state: MutableSimulationState,
  boss: MonsterEntity,
): PlayerEntity | undefined {
  return targetCandidates(state, boss).sort(
    (left, right) =>
      threatValue(state, right) - threatValue(state, left) ||
      distanceSquaredMm(boss.position, left.position) -
        distanceSquaredMm(boss.position, right.position) ||
      Number(left.entityId) - Number(right.entityId),
  )[0];
}

function selectRandomTarget(
  state: MutableSimulationState,
  boss: MonsterEntity,
): PlayerEntity | undefined {
  const candidates = targetCandidates(state, boss);
  if (candidates.length === 0) {
    return undefined;
  }
  const weighted = [...candidates].sort(
    (left, right) =>
      threatValue(state, right) - threatValue(state, left) ||
      Number(left.entityId) - Number(right.entityId),
  );
  return weighted[state.random.combat.nextInt(weighted.length)];
}

function createTargetMarks(targets: readonly PlayerEntity[]): CoreBossTargetMark[] {
  return targets.map((target) => ({
    targetEntityId: target.entityId,
    position: clonePoint(target.position),
  }));
}

function createHazard(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  values: {
    readonly abilityId: CoreBossAbilityId;
    readonly center: Vec2Mm;
    readonly direction?: Vec2Mm;
    readonly delayTicks: number;
    readonly durationTicks: number;
    readonly radiusMm?: number;
    readonly lengthMm?: number;
    readonly widthMm?: number;
    readonly damage?: number;
    readonly damagePerSecond?: number;
    readonly hardControlTicks?: number;
    readonly displacementMm?: number;
    readonly gapIndex?: number;
    readonly pulseIntervalTicks?: number;
    readonly targetMarks?: readonly CoreBossTargetMark[];
  },
): CoreBossHazard {
  const hazard: CoreBossHazard = {
    entityId: allocateEntityId(state),
    bossEntityId: boss.entityId,
    abilityId: values.abilityId,
    createdAtTick: state.tick,
    activatesAtTick: state.tick + values.delayTicks,
    expiresAtTick: state.tick + values.delayTicks + values.durationTicks,
    center: clonePoint(values.center),
    direction: normalizeAxisPair(
      values.direction?.x ?? boss.facing.x,
      values.direction?.z ?? boss.facing.z,
    ),
    radiusMm: values.radiusMm ?? 0,
    lengthMm: values.lengthMm ?? 0,
    widthMm: values.widthMm ?? 0,
    damage: values.damage ?? 0,
    damagePerSecond: values.damagePerSecond ?? 0,
    hardControlTicks: values.hardControlTicks ?? 0,
    displacementMm: values.displacementMm ?? 0,
    gapIndex: values.gapIndex ?? -1,
    resolved: false,
    nextPulseTick: state.tick + values.delayTicks,
    pulseIntervalTicks: values.pulseIntervalTicks ?? 0,
    targetMarks: (values.targetMarks ?? []).map((mark) => ({
      targetEntityId: mark.targetEntityId,
      position: clonePoint(mark.position),
    })),
    hitEntityIds: [],
  };
  state.coreBossHazards.set(hazard.entityId, hazard);
  events.push({
    type: 'core-boss-cast',
    tick: state.tick,
    bossEntityId: boss.entityId,
    hazardEntityId: hazard.entityId,
    abilityId: hazard.abilityId,
    phase: 'warning',
    center: clonePoint(hazard.center),
    activatesAtTick: hazard.activatesAtTick,
  });
  return hazard;
}

function markResolved(
  state: MutableSimulationState,
  events: SimEvent[],
  hazard: CoreBossHazard,
): void {
  if (hazard.resolved) {
    return;
  }
  hazard.resolved = true;
  events.push({
    type: 'core-boss-cast',
    tick: state.tick,
    bossEntityId: hazard.bossEntityId,
    hazardEntityId: hazard.entityId,
    abilityId: hazard.abilityId,
    phase: 'resolved',
    center: clonePoint(hazard.center),
    activatesAtTick: hazard.activatesAtTick,
  });
}

function targetInHazardLine(
  state: MutableSimulationState,
  boss: MonsterEntity,
  player: PlayerEntity,
  start: Vec2Mm,
  direction: Vec2Mm,
  lengthMm: number,
  widthMm: number,
): boolean {
  return (
    pointInLine(player.position, start, direction, lengthMm, widthMm) &&
    hasDirectLineOfSight(
      state,
      boss.position,
      player.position,
      boss.collisionRadiusMm + M0_RULES.playerCapsuleRadiusMm,
    )
  );
}

function applyBossDamage(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  target: PlayerEntity,
  amount: number,
  form: 'skill' | 'dot',
): number {
  return applyDamage(state, events, {
    sourceEntityId: boss.entityId,
    targetEntityId: target.entityId,
    amount: Math.max(1, Math.trunc(amount)),
    cause: 'monster',
    form,
    periodic: form === 'dot',
    ignoreSourceBonuses: true,
  });
}

function knockBack(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  target: PlayerEntity,
  distanceMm: number,
): void {
  const direction = directionBetween(boss.position, target.position, boss.facing);
  const requested = pointAlong(target.position, direction, distanceMm);
  target.position = resolveTargetForcedDisplacement(
    state,
    events,
    target,
    target.position,
    requested,
    M0_RULES.playerCapsuleRadiusMm,
  );
}

function resolveRing(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  for (const target of livingPlayers(state)) {
    if (
      distanceSquaredMm(target.position, hazard.center) <=
        PUBLIC_RING_RADIUS_MM * PUBLIC_RING_RADIUS_MM &&
      hasDirectLineOfSight(state, boss.position, target.position, 450)
    ) {
      applyBossDamage(state, events, boss, target, hazard.damage, 'skill');
    }
  }
}

function resolveMeteor(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  for (const target of livingPlayers(state)) {
    if (distanceSquaredMm(target.position, hazard.center) <= METEOR_RADIUS_MM * METEOR_RADIUS_MM) {
      applyBossDamage(state, events, boss, target, hazard.damage, 'skill');
    }
  }
}

function resolveEarthbreak(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  const perpendicular = vec2Mm(-hazard.direction.z, hazard.direction.x);
  for (const target of livingPlayers(state)) {
    const hit = [-1, 0, 1].some((offsetIndex) => {
      const lineCenter = pointAlong(hazard.center, perpendicular, offsetIndex * EARTHBREAK_GAP_MM);
      return pointInCenteredLine(
        target.position,
        lineCenter,
        hazard.direction,
        EARTHBREAK_LENGTH_MM,
        EARTHBREAK_WIDTH_MM,
      );
    });
    if (!hit) {
      continue;
    }
    const applied = applyBossDamage(state, events, boss, target, hazard.damage, 'skill');
    if (applied > 0) {
      applyHardControl(target, hazard.hardControlTicks, state, events);
    }
  }
}

function rotatedDirection(direction: Vec2Mm, index: number): Vec2Mm {
  const base = ROTATED_DIRECTIONS[index % ROTATED_DIRECTIONS.length] ?? vec2Mm(1_000, 0);
  const x = Math.trunc((direction.x * base.x - direction.z * base.z) / 1_000);
  const z = Math.trunc((direction.x * base.z + direction.z * base.x) / 1_000);
  return normalizeAxisPair(x, z);
}

function resolveFirelane(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  for (const target of livingPlayers(state)) {
    const hit = [0, 1, 2].some(
      (index) =>
        index !== hazard.gapIndex &&
        targetInHazardLine(
          state,
          boss,
          target,
          hazard.center,
          rotatedDirection(hazard.direction, index),
          FIRELANE_LENGTH_MM,
          FIRELANE_WIDTH_MM,
        ),
    );
    if (hit) {
      applyBossDamage(state, events, boss, target, hazard.damagePerSecond, 'dot');
    }
  }
}

function updateFollowingMarks(state: MutableSimulationState, hazard: CoreBossHazard): void {
  for (const mark of hazard.targetMarks) {
    if (mark.targetEntityId === null) {
      continue;
    }
    const target = state.players.get(mark.targetEntityId);
    if (target?.lifeState === 'alive') {
      mark.position = clonePoint(target.position);
    }
  }
}

function resolvePoisonpool(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  updateFollowingMarks(state, hazard);
  for (const mark of hazard.targetMarks) {
    for (const target of livingPlayers(state)) {
      if (
        distanceSquaredMm(target.position, mark.position) <=
        POISON_RADIUS_MM * POISON_RADIUS_MM
      ) {
        applyBossDamage(state, events, boss, target, hazard.damagePerSecond, 'dot');
      }
    }
  }
}

function resolveWindcharge(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  for (const target of livingPlayers(state)) {
    if (
      !targetInHazardLine(
        state,
        boss,
        target,
        hazard.center,
        hazard.direction,
        WINDCHARGE_LENGTH_MM,
        WINDCHARGE_WIDTH_MM,
      )
    ) {
      continue;
    }
    const applied = applyBossDamage(state, events, boss, target, hazard.damage, 'skill');
    if (applied > 0) {
      knockBack(state, events, boss, target, hazard.displacementMm);
    }
  }
}

function resolveThunderchain(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  const first = hazard.targetMarks[0]?.targetEntityId;
  let previous = first === undefined || first === null ? undefined : state.players.get(first);
  const hit = new Set<EntityId>();
  for (let jump = 0; jump < 4 && previous; jump += 1) {
    if (previous.lifeState !== 'alive' || hit.has(previous.entityId)) {
      break;
    }
    hit.add(previous.entityId);
    hazard.hitEntityIds.push(previous.entityId);
    applyBossDamage(
      state,
      events,
      boss,
      previous,
      Math.max(1, Math.trunc((300 * 8 ** jump) / 10 ** jump)),
      'skill',
    );
    // Narrowed alias: `previous` is reassigned below, so closures cannot keep
    // the loop condition's non-null narrowing on it.
    const from = previous;
    const candidates = livingPlayers(state)
      .filter(
        (candidate) =>
          !hit.has(candidate.entityId) &&
          distanceSquaredMm(candidate.position, from.position) <= 6_000 * 6_000 &&
          hasDirectLineOfSight(state, from.position, candidate.position, 450),
      )
      .sort(
        (left, right) =>
          distanceSquaredMm(left.position, from.position) -
            distanceSquaredMm(right.position, from.position) ||
          Number(left.entityId) - Number(right.entityId),
      );
    previous = candidates[0];
    if (previous) {
      hazard.targetMarks.push({
        targetEntityId: previous.entityId,
        position: clonePoint(previous.position),
      });
    }
  }
}

function spawnMirrors(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
): void {
  const perpendicular = vec2Mm(-boss.facing.z, boss.facing.x);
  for (const side of [-1, 1]) {
    const mirror: SummonEntity = {
      entityId: allocateEntityId(state),
      ownerEntityId: boss.entityId,
      kind: 'core-mirror',
      position: pointAlong(boss.position, perpendicular, side * 2_500),
      hp: 2_000,
      maxHp: 2_000,
      attackPower: 60,
      targetable: true,
      expiresAtTick: state.tick + MIRROR_DURATION_TICKS,
      attackCooldownTicks: MIRROR_ATTACK_PERIOD_TICKS,
      touchCooldownTicks: 0,
      destroyedByHostileDamage: false,
    };
    state.summons.set(mirror.entityId, mirror);
    events.push({
      type: 'summon-spawned',
      tick: state.tick,
      entityId: mirror.entityId,
      ownerEntityId: boss.entityId,
      summonKind: mirror.kind,
    });
  }
}

function mirrorTarget(
  state: MutableSimulationState,
  boss: MonsterEntity,
  mirror: SummonEntity,
): PlayerEntity | undefined {
  return targetCandidates(state, boss)
    .filter((target) => distanceSquaredMm(mirror.position, target.position) <= 12_000 * 12_000)
    .sort(
      (left, right) =>
        threatValue(state, right) - threatValue(state, left) ||
        distanceSquaredMm(mirror.position, left.position) -
          distanceSquaredMm(mirror.position, right.position) ||
        Number(left.entityId) - Number(right.entityId),
    )[0];
}

function advanceMirrors(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
): void {
  const mirrors = [...state.summons.values()]
    .filter((summon) => summon.kind === 'core-mirror' && summon.ownerEntityId === boss.entityId)
    .sort((left, right) => Number(left.entityId) - Number(right.entityId));
  for (const mirror of mirrors) {
    if (!state.summons.has(mirror.entityId)) {
      continue;
    }
    if (mirror.hp <= 0 || mirror.expiresAtTick <= state.tick) {
      state.summons.delete(mirror.entityId);
      events.push({
        type: 'summon-expired',
        tick: state.tick,
        entityId: mirror.entityId,
        ownerEntityId: boss.entityId,
        summonKind: mirror.kind,
      });
      continue;
    }
    mirror.attackCooldownTicks = Math.max(0, mirror.attackCooldownTicks - 1);
    const target = mirrorTarget(state, boss, mirror);
    if (!target) {
      continue;
    }
    const distance = distanceSquaredMm(mirror.position, target.position);
    if (distance > 1_800 * 1_800) {
      const requested = moveToward(
        mirror.position,
        target.position,
        Math.trunc(2_600 / TICKS_PER_SECOND),
      );
      mirror.position = resolveWorldMovement(state, mirror.position, requested, 650);
      continue;
    }
    if (mirror.attackCooldownTicks > 0) {
      continue;
    }
    mirror.attackCooldownTicks = MIRROR_ATTACK_PERIOD_TICKS;
    applyDamage(state, events, {
      sourceEntityId: mirror.entityId,
      targetEntityId: target.entityId,
      amount: mirror.attackPower,
      cause: 'monster',
      form: 'basic',
      ignoreSourceBonuses: true,
    });
  }
}

function resolveHazard(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  hazard: CoreBossHazard,
): void {
  if (state.tick < hazard.activatesAtTick || state.tick >= hazard.expiresAtTick) {
    return;
  }
  if (!hazard.resolved) {
    markResolved(state, events, hazard);
  }
  if (
    hazard.abilityId === 'firelane' &&
    hazard.pulseIntervalTicks > 0 &&
    state.tick >= hazard.nextPulseTick
  ) {
    resolveFirelane(state, events, boss, hazard);
    hazard.nextPulseTick += hazard.pulseIntervalTicks;
  } else if (
    hazard.abilityId === 'poisonpool' &&
    hazard.pulseIntervalTicks > 0 &&
    state.tick >= hazard.nextPulseTick
  ) {
    resolvePoisonpool(state, events, boss, hazard);
    hazard.nextPulseTick += hazard.pulseIntervalTicks;
  }
  if (state.tick !== hazard.activatesAtTick) {
    return;
  }
  switch (hazard.abilityId) {
    case 'ring-shockwave':
      resolveRing(state, events, boss, hazard);
      break;
    case 'meteor':
      resolveMeteor(state, events, boss, hazard);
      break;
    case 'earthbreak':
      resolveEarthbreak(state, events, boss, hazard);
      break;
    case 'firelane':
    case 'poisonpool':
      break;
    case 'windcharge':
      resolveWindcharge(state, events, boss, hazard);
      break;
    case 'thunderchain':
      resolveThunderchain(state, events, boss, hazard);
      break;
    case 'mirrorshadow':
      spawnMirrors(state, events, boss);
      break;
  }
}

function castSignature(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  abilityId: CoreBossSignatureAbilityId,
): void {
  const target = selectThreatTarget(state, boss);
  const _targetMarks = target ? createTargetMarks([target]) : [];
  switch (abilityId) {
    case 'earthbreak':
      createHazard(state, events, boss, {
        abilityId,
        center: boss.position,
        direction: directionBetween(
          boss.position,
          target?.position ?? pointAlong(boss.position, boss.facing, 1_000),
          boss.facing,
        ),
        delayTicks: secondsToTicks(1.2),
        durationTicks: secondsToTicks(0.1),
        lengthMm: EARTHBREAK_LENGTH_MM,
        widthMm: EARTHBREAK_WIDTH_MM,
        damage: 350,
        hardControlTicks: secondsToTicks(0.6),
      });
      break;
    case 'firelane':
      createHazard(state, events, boss, {
        abilityId,
        center: boss.position,
        direction: boss.facing,
        delayTicks: secondsToTicks(1.2),
        durationTicks: secondsToTicks(6),
        lengthMm: FIRELANE_LENGTH_MM,
        widthMm: FIRELANE_WIDTH_MM,
        damagePerSecond: 100,
        pulseIntervalTicks: TICKS_PER_SECOND,
        gapIndex: state.random.combat.nextInt(3),
      });
      break;
    case 'poisonpool':
      createHazard(state, events, boss, {
        abilityId,
        center: boss.position,
        delayTicks: secondsToTicks(1.5),
        durationTicks: secondsToTicks(8),
        radiusMm: POISON_RADIUS_MM,
        damagePerSecond: 70,
        pulseIntervalTicks: TICKS_PER_SECOND,
        targetMarks: createTargetMarks(
          targetCandidates(state, boss)
            .sort(
              (left, right) =>
                threatValue(state, right) - threatValue(state, left) ||
                Number(left.entityId) - Number(right.entityId),
            )
            .slice(0, 3),
        ),
      });
      break;
    case 'windcharge':
      createHazard(state, events, boss, {
        abilityId,
        center: boss.position,
        direction: directionBetween(
          boss.position,
          target?.position ?? pointAlong(boss.position, boss.facing, 1_000),
          boss.facing,
        ),
        delayTicks: secondsToTicks(1.2),
        durationTicks: secondsToTicks(0.1),
        lengthMm: WINDCHARGE_LENGTH_MM,
        widthMm: WINDCHARGE_WIDTH_MM,
        damage: 350,
        displacementMm: 5_000,
      });
      break;
    case 'thunderchain': {
      const selected = selectRandomTarget(state, boss);
      createHazard(state, events, boss, {
        abilityId,
        center: selected?.position ?? boss.position,
        delayTicks: secondsToTicks(1.5),
        durationTicks: secondsToTicks(0.1),
        damage: 300,
        targetMarks: selected ? createTargetMarks([selected]) : [],
      });
      break;
    }
    case 'mirrorshadow':
      createHazard(state, events, boss, {
        abilityId,
        center: boss.position,
        delayTicks: secondsToTicks(1.5),
        durationTicks: secondsToTicks(10),
      });
      break;
  }
}

function castPublicAbility(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  abilityId: Extract<CoreBossAbilityId, 'ring-shockwave' | 'meteor'>,
): void {
  if (abilityId === 'ring-shockwave') {
    createHazard(state, events, boss, {
      abilityId,
      center: boss.position,
      delayTicks: secondsToTicks(1.5),
      durationTicks: secondsToTicks(0.1),
      radiusMm: PUBLIC_RING_RADIUS_MM,
      damage: 400,
    });
    return;
  }
  const target = selectRandomTarget(state, boss);
  if (!target) {
    return;
  }
  createHazard(state, events, boss, {
    abilityId,
    center: target.position,
    delayTicks: secondsToTicks(2),
    durationTicks: secondsToTicks(0.1),
    radiusMm: METEOR_RADIUS_MM,
    damage: 500,
    targetMarks: createTargetMarks([target]),
  });
}

export function initializeCoreBoss(state: MutableSimulationState, boss: MonsterEntity): void {
  state.coreBossRuntimes.set(boss.entityId, {
    bossEntityId: boss.entityId,
    courtId: boss.courtId,
    nextRingCastTick: state.tick + 5 * TICKS_PER_SECOND,
    nextMeteorCastTick: state.tick + 10 * TICKS_PER_SECOND,
    nextSignatureCastTick: state.tick + 16 * TICKS_PER_SECOND,
    signatureIndex: 0,
  });
}

function migrateCoreBossIfNeeded(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
  runtime: CoreBossRuntimeState,
): void {
  const finalCourtId = state.stormZone.selectedCourtId;
  if (
    state.mapField === null ||
    finalCourtId === null ||
    boss.courtId === finalCourtId ||
    !isInNormalStormZone(state, boss.position)
  ) {
    return;
  }
  const court = MAP_COURTS.find((candidate) => candidate.id === finalCourtId);
  if (!court) {
    return;
  }
  const previousCourtId = boss.courtId;
  const healthBasisPoints = Math.max(0, Math.trunc((boss.hp * 10_000) / Math.max(1, boss.maxHp)));
  boss.courtId = finalCourtId;
  boss.homePosition = vec2Mm(court.center.x, court.center.z);
  boss.position = vec2Mm(court.center.x, court.center.z);
  boss.hp = Math.max(1, Math.trunc((boss.maxHp * healthBasisPoints) / 10_000));
  boss.targetEntityId = null;
  boss.invulnerableTicks = TICKS_PER_SECOND;
  runtime.courtId = finalCourtId;
  for (const hazard of [...state.coreBossHazards.values()]) {
    if (hazard.bossEntityId === boss.entityId) {
      state.coreBossHazards.delete(hazard.entityId);
    }
  }
  for (const mirror of [...state.summons.values()]) {
    if (mirror.kind === 'core-mirror' && mirror.ownerEntityId === boss.entityId) {
      state.summons.delete(mirror.entityId);
    }
  }
  events.push({
    type: 'core-boss-migrated',
    tick: state.tick,
    bossEntityId: boss.entityId,
    fromCourtId: previousCourtId,
    toCourtId: finalCourtId,
    position: clonePoint(boss.position),
    hp: boss.hp,
    maxHp: boss.maxHp,
  });
}

function cleanupExpiredCoreState(state: MutableSimulationState): void {
  for (const [entityId, anchor] of state.coreBossRevealAnchors) {
    if (anchor.expiresAtTick <= state.tick) {
      state.coreBossRevealAnchors.delete(entityId);
    }
  }
  for (const [entityId, hazard] of state.coreBossHazards) {
    if (hazard.expiresAtTick <= state.tick) {
      state.coreBossHazards.delete(entityId);
    }
  }
}

export function advanceCoreBoss(state: MutableSimulationState, events: SimEvent[]): void {
  cleanupExpiredCoreState(state);
  for (const boss of [...state.monsters.values()]
    .filter((monster) => monster.kind === 'core-boss')
    .sort((left, right) => Number(left.entityId) - Number(right.entityId))) {
    const runtime = state.coreBossRuntimes.get(boss.entityId);
    if (!runtime) {
      initializeCoreBoss(state, boss);
    }
    const currentRuntime = state.coreBossRuntimes.get(boss.entityId);
    if (!currentRuntime) {
      continue;
    }
    migrateCoreBossIfNeeded(state, events, boss, currentRuntime);
    for (const hazard of [...state.coreBossHazards.values()]
      .filter((candidate) => candidate.bossEntityId === boss.entityId)
      .sort((left, right) => Number(left.entityId) - Number(right.entityId))) {
      if (state.coreBossHazards.has(hazard.entityId)) {
        resolveHazard(state, events, boss, hazard);
      }
    }
    advanceMirrors(state, events, boss);
    if (boss.invulnerableTicks > 0) {
      continue;
    }
    const scale = coreCooldownScale(state);
    if (state.tick >= currentRuntime.nextRingCastTick) {
      castPublicAbility(state, events, boss, 'ring-shockwave');
      currentRuntime.nextRingCastTick = state.tick + secondsToTicks(10, scale);
    }
    if (state.tick >= currentRuntime.nextMeteorCastTick) {
      castPublicAbility(state, events, boss, 'meteor');
      currentRuntime.nextMeteorCastTick = state.tick + secondsToTicks(20, scale);
    }
    if (state.tick >= currentRuntime.nextSignatureCastTick) {
      const abilityId = SIGNATURES[currentRuntime.signatureIndex % SIGNATURES.length];
      if (abilityId) {
        castSignature(state, events, boss, abilityId);
        currentRuntime.signatureIndex = (currentRuntime.signatureIndex + 1) % SIGNATURES.length;
        currentRuntime.nextSignatureCastTick =
          state.tick + secondsToTicks(SIGNATURE_COOLDOWNS_SECONDS[abilityId], scale);
      }
    }
  }
}

export function createCoreBossRevealAnchor(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
): CoreBossRevealAnchor {
  const anchor: CoreBossRevealAnchor = {
    entityId: allocateEntityId(state),
    bossEntityId: boss.entityId,
    position: clonePoint(boss.position),
    expiresAtTick: state.tick + 10 * TICKS_PER_SECOND,
  };
  state.coreBossRevealAnchors.set(anchor.entityId, anchor);
  events.push({
    type: 'core-boss-reveal-anchor',
    tick: state.tick,
    bossEntityId: boss.entityId,
    anchorEntityId: anchor.entityId,
    position: clonePoint(anchor.position),
    expiresAtTick: anchor.expiresAtTick,
  });
  return anchor;
}

export function handleCoreBossDefeated(
  state: MutableSimulationState,
  events: SimEvent[],
  boss: MonsterEntity,
): void {
  createCoreBossRevealAnchor(state, events, boss);
  state.coreBossRuntimes.delete(boss.entityId);
  state.coreBossThreat.clear();
  for (const hazard of [...state.coreBossHazards.values()]) {
    if (hazard.bossEntityId === boss.entityId) {
      state.coreBossHazards.delete(hazard.entityId);
    }
  }
  for (const mirror of [...state.summons.values()]) {
    if (mirror.kind === 'core-mirror' && mirror.ownerEntityId === boss.entityId) {
      state.summons.delete(mirror.entityId);
      events.push({
        type: 'summon-expired',
        tick: state.tick,
        entityId: mirror.entityId,
        ownerEntityId: boss.entityId,
        summonKind: mirror.kind,
      });
    }
  }
}

export function coreBossRevealSource(
  state: MutableSimulationState,
  observer: PlayerEntity,
): Vec2Mm | null {
  for (const boss of state.monsters.values()) {
    if (
      boss.kind === 'core-boss' &&
      distanceSquaredMm(observer.position, boss.position) <=
        TRUE_SIGHT_RADIUS_MM * TRUE_SIGHT_RADIUS_MM &&
      hasDirectLineOfSight(state, observer.position, boss.position, 450)
    ) {
      return boss.position;
    }
  }
  for (const anchor of state.coreBossRevealAnchors.values()) {
    if (
      anchor.expiresAtTick > state.tick &&
      distanceSquaredMm(observer.position, anchor.position) <=
        TRUE_SIGHT_RADIUS_MM * TRUE_SIGHT_RADIUS_MM &&
      hasDirectLineOfSight(state, observer.position, anchor.position, 450)
    ) {
      return anchor.position;
    }
  }
  return null;
}

export function coreBossHasTrueSight(
  state: MutableSimulationState,
  observer: PlayerEntity,
  targetPosition: Vec2Mm,
): boolean {
  const source = coreBossRevealSource(state, observer);
  return (
    source !== null &&
    distanceSquaredMm(observer.position, targetPosition) <=
      TRUE_SIGHT_RADIUS_MM * TRUE_SIGHT_RADIUS_MM &&
    hasDirectLineOfSight(state, observer.position, targetPosition, 450)
  );
}

export function recordCoreBossThreat(
  state: MutableSimulationState,
  sourceEntityId: EntityId,
  amount: number,
): void {
  if (amount <= 0) {
    return;
  }
  const sourcePlayer =
    state.players.get(sourceEntityId) ??
    (() => {
      const summon = state.summons.get(sourceEntityId);
      return summon ? state.players.get(summon.ownerEntityId) : undefined;
    })();
  if (!sourcePlayer) {
    return;
  }
  state.coreBossThreat.set(
    sourcePlayer.entityId,
    (state.coreBossThreat.get(sourcePlayer.entityId) ?? 0) + amount,
  );
}

export function isCoreBossMirror(summon: SummonEntity): boolean {
  return summon.kind === 'core-mirror';
}

export function coreBossTrueSightRadiusMm(): number {
  return TRUE_SIGHT_RADIUS_MM;
}
