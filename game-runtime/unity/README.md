# JWGB Unity Runtime

This project is the Unity migration target for Journey West Great Brawl. The TypeScript
simulation remains the behavior oracle until every migration gate passes.

## Locked Toolchain

- Unity Editor: `6000.3.20f1` (`c9ba695d4f07`)
- Entities: `1.4.8`
- Burst: `1.8.30`
- Netcode for Entities: `1.14.1`
- Unity Transport: `2.6.0`
- URP: `17.3.0`

The machine running Unity must have an active Unity license. Package Manager cache can be
moved off the system drive with:

```powershell
$env:UPM_CACHE_ROOT = 'E:\Unity\Cache\upm'
```

Set `UNITY_EDITOR` when the Editor is installed somewhere other than the locked default.

## Package Boundaries

- `com.jwgb.core`: engine-independent deterministic integers, hashes, and RNG.
- `com.jwgb.content`: versioned data and synthetic stress profiles.
- `com.jwgb.sim`: ECS components, systems, and deterministic workloads.
- `com.jwgb.netcode`: authoritative network contracts.
- `com.jwgb.client`: presentation and client bootstrap boundary.
- `com.jwgb.server`: Dedicated Server process boundary.
- `com.jwgb.tests`: fixture parity and Unity-side contract tests.

Core and Sim are guarded against UnityEngine, PhysX, wall-clock time, and unseeded random
dependencies.

## Commands

Run from the repository root:

```powershell
npm run unity:architecture
npm run unity:setup
npm run unity:test
npm run unity:build:windows
npm run unity:build:android
npm run unity:build:linux-server
```

Unity-generated state is kept under ignored `Library`, `Temp`, `Logs`, and `Builds`
directories. Test results intended as migration evidence are written under
`migration/reports/unity`.

## Current Status

The repository skeleton, deterministic Core vectors, synthetic 423-agent workload, tests,
and build entrypoints exist. They are not considered Unity-verified until Package Manager
resolution, Editor compilation, EditMode tests, and all three batch builds pass.
