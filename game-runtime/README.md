# JourneyWestGreatBrawl Runtime

`game-runtime` is the production-oriented implementation workspace for 《三命无常》.

The current runnable baseline uses a deterministic 20 Hz TypeScript simulation core,
a Three.js client, and an authoritative Node.js WebSocket server. The production target
has changed to Unity 6.3 LTS, a C# integer deterministic simulation, Entities/Burst/Jobs,
Netcode for Entities, and a Linux Unity Dedicated Server.

A Unity 6.3 project and the first C#/Entities/Burst migration shell now exist and build for
Windows, Android, and Linux Dedicated Server. The TypeScript runtime remains the behavior
oracle and the only complete gameplay baseline until the Unity migration passes
deterministic, performance, network, and three-platform gates.

## Documents

- `docs/玩法完整说明.md`
- `docs/技术架构.md`
- `docs/Unity迁移规划.md`
- `docs/开发规划.md`
- `docs/开发进度.md`
- `docs/M0工程基线验收报告_2026-07-23.md`
- `docs/M1战斗机制阶段验收报告_2026-07-23.md`

## Development

```powershell
npm install
npm run dev:web
```

Web client: `http://127.0.0.1:5173`

Run the authoritative server in a second terminal:

```powershell
npm run dev:server
```

Health endpoint: `http://127.0.0.1:8787/health`
WebSocket endpoint: `ws://127.0.0.1:8787/match`

The Web client uses the online authoritative server by default. Run both processes and open:

```text
http://127.0.0.1:5173/
```

Use `server`, `player`, and `hero` query parameters to override the WebSocket URL,
temporary player ID, and hero ID. The online client stores its player ID and rotating
recovery credential in the current tab's `sessionStorage`, automatically reconnects, and
can reload into the same authoritative entity during the 120-second recovery window.

Use `?mode=local` to run the browser-local deterministic host for offline development and
local verification.

Recovery does not create a new entity or reset health, cooldowns, equipment, random streams,
or the accepted input sequence. Full matchmaking, room reuse after a match, and a
source-of-truth rule for players whose recovery window expires are not implemented yet.

Verification:

```powershell
npm run check
```

Browser verification images are stored in `artifacts/`.

## Unity migration

U0 remains open only on device and release-signing evidence, while U1 now has a first
client-side synthetic rendering baseline. UPM resolution, C# compilation, 15 EditMode
tests, three product IL2CPP targets, and a separate Windows IL2CPP stress Player have
passed. The stress Player renders 423 ECS agents through three GPU-instanced batches and
writes a repeatable JSON report plus an offscreen verification image.

This development-machine sample is not a release performance gate: it does not provide
GPU timing, Release `GC.Alloc`, low-end Android thermal data, or representative projectile,
area, drop, animation, and VFX peaks. Full gameplay parity and production signing also
remain incomplete. The execution order is:

1. Close the remaining U0 Android device startup gate.
2. Expand and measure the synthetic `30 players + 123 monsters + 270 summons` field.
3. Extend Golden Fixtures from the TypeScript oracle.
4. Port the current M1 slice with tick-by-tick comparison.
5. Build the Unity client, authoritative Netcode loop, and three-platform release gates.

See `docs/Unity迁移规划.md` for version locks, provisional hardware targets, budgets, and
Go/No-Go rules.

Build and run the current Windows synthetic baseline:

```powershell
npm run unity:build:windows-stress
npm run unity:sample:windows-stress
```

## Source of truth

The current design authority remains the adjacent file:

`..\三命无常_工程真源定稿_v4.docx`

Known P0 conflicts are tracked in `docs/玩法完整说明.md` and must be resolved before
their affected systems are promoted from prototype to release implementation.
