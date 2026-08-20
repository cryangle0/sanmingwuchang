# JourneyWestGreatBrawl Engineering Rules

## Non-negotiable architecture

- Until the Unity parity and cutover gates pass, `packages/sim` is the only implemented
  gameplay authority and the migration behavior oracle.
- Simulation code must not import DOM, browser, Three.js, WebSocket, database, or UI modules.
- Simulation time advances only through a fixed 20 Hz tick.
- Simulation randomness uses the seeded RNG from `@jwgb/core`. Never use `Math.random`.
- Simulation code never reads `Date.now`, `performance.now`, timers, or wall-clock state.
- Positions are integer millimeters. Health, shields, gold, ticks, and IDs are integers.
- Clients submit intent. They never decide damage, death, drops, economy, cooldowns, or victory.
- Renderers read immutable world views and interpolate them. They never mutate simulation state.

## Unity migration rules

- The production target is Unity 6.3 LTS with a C# integer deterministic simulation.
- Keep the TypeScript runtime until Golden Fixtures, tick-by-tick parity, performance,
  networking, and three-platform gates pass.
- Do not expand TypeScript gameplay scope except for defects, fixtures, migration tools,
  and necessary protocol maintenance.
- Unity authority must keep 20 Hz ticks, integer millimeters, seeded random streams,
  stable ordering, replay inputs, and state-hash semantics.
- Do not use PhysX, Rigidbody, wall-clock time, or unseeded randomness for authoritative rules.
- Do not depend on chunk iteration, hash-container iteration, job completion order, or
  thread index for gameplay outcomes.
- Parallel jobs may gather candidates; authoritative commits use explicit stable sort keys.
- Do not put high-volume simulation entities or per-tick gameplay logic in MonoBehaviour
  or GameObject hot paths.
- Do not use Netcode for GameObjects for the production match runtime.
- The Unity project belongs under `unity/`; cross-language fixtures belong under
  `migration/fixtures/`.
- Follow `docs/Unity迁移规划.md` and ADR-005 in `docs/技术架构.md`.

## Module rules

- Add behavior in a small domain module with tests.
- Coordinators compose modules and remain thin.
- Do not append unrelated helpers to entrypoints.
- Content data belongs in `packages/content`, not in systems.
- Wire contracts belong in `packages/protocol`, not in the client or server entrypoint.
- One public surface per package through `src/index.ts`.

## Performance rules

- Keep per-tick allocations near zero on hot paths.
- Reuse entity views, temporary vectors, effects, and network buffers.
- Use interest management before broadcasting snapshots.
- Keep gameplay at 20 Hz and rendering at display refresh rate.
- Measure before adding post-processing or large runtime dependencies.
- Preserve gameplay information across quality tiers.

## Verification

- Every simulation or server behavior change requires a test.
- Run `npm run check` before marking a milestone complete.
- Once the Unity project exists, run its edit-mode, play-mode, deterministic fixture,
  client build, and Dedicated Server build gates in addition to `npm run check`.
- Visual changes require desktop and mobile screenshots.
- Keep `docs/开发进度.md` current in the same change as completed work.
