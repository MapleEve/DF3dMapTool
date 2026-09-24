<sub>🌐 <a href="README.md">简体中文</a> · <b>English</b></sub>

<div align="center">

# DF3dMapTool 🗺️

> _「An open-source 3D tactical map viewer for Delta Force players — 6 switchable maps, POI annotations with search, and a 2D overhead overlay.」_

<a href="https://github.com/MapleEve/DF3dMapTool/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/MapleEve/DF3dMapTool/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI" /></a>
<img src="https://img.shields.io/badge/bun-%E2%89%A51.3-000000?style=flat-square&logo=bun&logoColor=white" alt="bun ≥ 1.3" />
<img src="https://img.shields.io/badge/lint-oxlint-1A1A1A?style=flat-square&logo=oxlint&logoColor=white" alt="oxlint" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/three.js-0.186-049EF4?style=flat-square&logo=threedotjs&logoColor=white" alt="three.js 0.186" />

<br>

[Quick start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Map data packs](#map-data-packs) · [Roadmap](#roadmap)

</div>

---

## About

DF3dMapTool is an open-source 3D tactical map viewer for Delta Force players.
It runs in the browser on top of three.js and ships with **built-in map data packs**:

- **6 switchable maps**: Zero Dam, Layali Grove, Brakkesh, Tide Prison, AZ3, and Space City —
  every data pack ships with the repository, ready to use right after cloning;
- **POI annotations and search**: filter by category, group by floor, fuzzy search by name;
- **2D overhead overlay**: prebaked basemap + linear projection, sharing one world coordinate system with the 3D scene;
- **Bilingual UI**: Chinese (default) and English.

---

## Features

| Feature                      | Description                                                                                       | Status |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| DMAP encrypted data pack     | AES-256-GCM encryption + integrity verification (tamper-proof, deterrence-level)                  | ✅     |
| 3D scene skeleton            | three.js scene manager, layer lifecycle, render loop                                              | ✅     |
| Map registry                 | MapId ↔ asset code ↔ display name, floor calibration                                              | ✅     |
| Coordinate transform         | Euler (Y-X-Z) → quaternion → axis mirror, applied uniformly                                       | ✅     |
| 2D projection                | Bidirectional world ↔ basemap pixel mapping, region display coords                                | ✅     |
| Bilingual UI                 | Full Chinese / English resources                                                                  | ✅     |
| 3D scene & orbit camera      | Data pack → scene layers → orbit camera, floor visibility, fly-to                                 | ✅     |
| POI layer                    | Icon rendering, hover tooltips, detail panel, filtering and search                                | ✅     |
| 2D overhead overlay          | Basemap drawing, floor switching, markers, zoom, region labels                                    | ✅     |
| 2D marker teleport & minimap | 2D marker/POI → 3D fly-to teleport (cross-floor sync), HUD minimap                                | ✅     |
| Camera settings              | FOV / sensitivity / respawn, persisted locally                                                    | ✅     |
| Preference-only toggles      | Air jump / volume / ambient motes — stored locally as preferences only, no runtime effect yet     | 🚧 M4  |
| Multi-map switching          | 6-map switching, per-container cache, progress and failure states                                 | ✅     |
| Map mode selection           | Filter data views by in-map mode                                                                  | 🚧 M3  |
| Navigation routes            | NavMesh pathfinding (timed crate) — wired end to end, nav data shipped for 5/6 maps (AZ3 pending) | 🚧     |
| Polish                       | Mobile support, performance (batching/LOD/draw distance), loading experience                      | 🚧 M4  |

---

## Quick start

Requirements: [bun](https://bun.sh) ≥ 1.3 (bundles the runtime, package manager and test
runner — no separate Node / pnpm install needed).

```bash
git clone https://github.com/MapleEve/DF3dMapTool.git
cd DF3dMapTool
bun install
bun run dev
```

Then open <http://localhost:5173>.

Common commands:

| Command                | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `bun run dev`          | Start the dev server                               |
| `bun run build`        | Build the whole workspace (type check + artifacts) |
| `bun test`             | Run all unit tests (bun's native test runner)      |
| `bun run lint`         | Run oxlint                                         |
| `bun run typecheck`    | Strict TypeScript check                            |
| `bun run format`       | Format with oxfmt                                  |
| `bun run format:check` | oxfmt format check (CI gate)                       |

CI (GitHub Actions) runs the same five gates — lint / typecheck / test / build /
format:check — on bun 1.3 via [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun).

---

## Architecture

A bun workspace monorepo with two packages:

```
DF3dMapTool/
├── docs                     Data package docs and more
├── apps/web                 React 19 + Vite + three.js app
│   └── src/
│       ├── engine/          three.js scene manager, DMAP loader wiring, built-in key
│       ├── map/             Map registry, coordinate transform (Y-X-Z euler → quaternion → mirror)
│       ├── poi/             POI model, categories, filtering and search
│       ├── bigmap/          2D overhead projection (world ↔ pixel)
│       ├── data/            Data pack loading and manifest verification
│       ├── state/           Zustand stores (map / floor / POI filter / search / UI)
│       ├── i18n/            Chinese / English resources
│       └── ui/              UI components
└── packages/dmap            DMAP container format
    ├── src/writer.ts        Node-side writer (used by the asset pipeline)
    ├── src/loader.ts        Browser/Node loader (open / read interface)
    └── FORMAT.md            Container format specification
```

Data flow:

```
DMAP data pack (apps/web/public/assets/*.dmap)
  → DmapLoader (AES-256-GCM verification → GLB payload → dmapc index)
    → manifest (map / floors / entries)
      → three.js 3D view (geometry + instanced placements)
      → 2D overhead overlay (prebaked basemap + linear projection, shared world coords)
```

---

## Map data packs

The app distributes its built-in map data packs in a dedicated encrypted container
format called **DMAP**:

- Container: `DMAP` magic + version + flags + 12-byte IV + AES-256-GCM ciphertext
  (GLB geometry, textures and JSON configs packed into one GLB payload with a dmapc index);
- Integrity: the authentication tag covers the entire payload, and the container header
  (version/flags/IV included) is bound as additionalData — any tampered byte fails to load;
- Key: 32 bytes of key material split into 4 segments, XORed with constant tables,
  concatenated, then derived through SHA-256; shipped as a built-in module, never in plaintext;
- Protection level: container tamper-proofing (GCM auth tag + AAD-bound header) is fully
  effective; key material ships with the client, so extraction protection is deterrence-level —
  it stops casual extraction but is not designed against deliberate key-recovery analysis;
- See [packages/dmap/FORMAT.md](packages/dmap/FORMAT.md) for the byte-level layout and read flow.

Data packs ship with the repository under `apps/web/public/assets/` — no extra steps after
cloning: **all 6 maps (AZ3, Zero Dam, Layali Grove, Brakkesh, Tide Prison, Space City) are
ready**. See [docs/data-packages.en.md](docs/data-packages.en.md) for per-map scale,
container layout and the data cleaning policy.

---

## Roadmap

- **M1 single-map core** ✅: full static AZ3 scene loading and roaming, POI icon layer, floor visibility, basemap alignment
- **M2 core interactions** ✅: POI search/detail/fly-to teleport, full 2D overhead suite (markers/teleport/zoom/HUD minimap),
  camera settings (FOV/sensitivity/respawn). Route system, draw-distance setting and a four-language UI are not covered
  yet (see M3/M4); navigation routes (NavMesh pathfinding, data ready for 5/6 maps, AZ3 pending) 🚧
- **M3 multi-map** ✅: 6-map switching (per-container cache, progress and failure states); mode selection, route system 🚧
- **M4 polish** 🚧: mobile support, performance (batching/LOD/draw distance), functional preference toggles, loading experience, four-language wrap-up

---

## Disclaimer

This project is a third-party tool for players and is not affiliated with the game's
official team. Map data is provided for viewing within this program only.

---

Copyright © 2026 Maple (MapleEve). All rights reserved.
Copying, redistribution, and asset extraction outside this program are prohibited without permission.
