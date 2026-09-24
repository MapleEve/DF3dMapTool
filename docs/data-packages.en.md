<sub>🌐 <a href="data-packages.md">简体中文</a> · <b>English</b></sub>

# Map Data Packages

All built-in maps ship with the repository as **DMAP encrypted containers** (`.dmap`)
under `apps/web/public/assets/<code>.dmap`. Cloning the repo is all it takes — no extra
downloads or generation steps.

## 1. Shipped packages

The table below reflects the actual scale of the 6 shipped maps, inventoried from each
container's manifest and JSON configs:

| Code        | Map          | MapId | Floors   | 3D chunks | Placements | POIs (total / active / with icon) | Icons | 2D layers | Regions | Size    |
| ----------- | ------------ | ----- | -------- | --------- | ---------- | --------------------------------- | ----- | --------- | ------- | ------- |
| az3         | AZ3          | 106   | 1–3      | 96        | 45,595     | 146 / 146 / 146                   | 34    | 4         | 13      | 36.3 MB |
| damiris     | Zero Dam     | 101   | B1, 1, 2 | 76        | 42,830     | 557 / 553 / 480                   | 55    | 2         | 6       | 18.7 MB |
| forrest     | Layali Grove | 102   | 1        | 139       | 52,472     | 688 / 473 / 620                   | 54    | 1         | 14      | 26.4 MB |
| brakkesh    | Brakkesh     | 104   | 1        | 39        | 28,045     | 803 / 801 / 700                   | 54    | 1         | 9       | 13.2 MB |
| tideprison  | Tide Prison  | 105   | 1–4      | 54        | 28,079     | 915 / 914 / 702                   | 56    | 5         | 16      | 15.6 MB |
| spacecenter | Space City   | 203   | 1–2      | 48        | 23,395     | 591 / 589 / 476                   | 56    | 3         | 18      | 14.3 MB |

Notes:

- **Floors**: the 3D scene and floor tabs follow the container manifest's `floors`;
  the values match the static registry.
- **Navigation data**: besides scene containers, encrypted navigation containers
  (`<code>.nav.dmap`, pathfinding meshes) ship for 5 of the 6 maps (all but AZ3);
  the routing entry hides automatically when a nav container is not available.
- **2D layers**: includes the overview layer. Some floors have no dedicated baked image
  (e.g. Zero Dam B1 and floor 1); they fall back to the overview at runtime — this is not
  missing data.
- **POI columns**: total in the container / `active` / carrying a dedicated icon asset;
  annotations without a dedicated icon asset render with a placeholder. A few annotations
  reference item icon keys that have no file in the icon asset set (6 in Brakkesh, 1 in
  Space City); they fall back to the same placeholder rendering without affecting search
  or fly-to.
- **spacecenter ships at the same standard as the other maps** (complete floors, POIs,
  2D layers and regions) with no separate limitations or downgrades.

## 2. Container layout

Each `.dmap` carries one map's full data plus the index summary of all 6 maps:

```
manifest.json                  dmap-map-manifest/2: maps[] index (6 entries)
  ├─ summary entries: mapId / code / floors / containers / counts
  └─ the map hosted by this container additionally carries:
       entries       in-container paths for scene / poi / map2d / configs[4] / icons / minimaps
       chunkBounds   3D chunk bounds (streamed loading and framing)
maps/<code>/scene.json         floor values, scene bounds, floor triggers
maps/<code>/poi.json           full POI list (coords, floors, icons, visibility)
maps/<code>/map2d.json         per-floor 2D calibration (world extents ↔ pixels)
chunks/b*.glb                  3D chunk geometry (instanced placements)
configs/                       type / item / region / map config tables (cleaned)
icons/index.json               icon index (business key → hashed file path + size)
minimap/index.json             basemap index (business key → hashed file path + size)
```

Encryption and the byte-level layout (magic, AES-256-GCM, dmapc index, key derivation)
are specified in [packages/dmap/FORMAT.md](../packages/dmap/FORMAT.md). Honest protection
statement: container tamper-proofing is fully effective; key material ships with the
client, so extraction protection is deterrence-level.

## 3. Data cleaning policy

JSON inside the containers is a stable, pipeline-cleaned form with five rules:

1. **Minimal fields**: each JSON keeps only fields consumed at runtime (e.g. the map
   config table keeps just `MapId` and `DefaultBornPos`; version arrays and unused
   fields are not shipped).
2. **Neutralized language keys**: in-data language keys are replaced with neutral keys
   (POI `poi.<id>.location` / `poi.<id>.description`, regions `region.<Id>`). The UI
   renders the in-data text directly; keys are never used for translation lookups.
3. **Hash-named assets**: icon and basemap file names are the first 16 hex chars of the
   content SHA-256; `icons/index.json` and `minimap/index.json` keep business keys for
   lookups.
4. **Neutral scene assets**: node and mesh names inside the 3D chunk GLBs are neutral
   sequence numbers (`n0..nN` / `geo0..geoM`) and nodes carry no extras — source-side
   placement paths and other debug information are not shipped; the engine consumes
   geometry and instance attributes only.
5. **Stale-data defenses** (all measured from content, see §3.1).

**Retained business keys**: the lookup keys in `icons/index.json` and
`minimap/index.json` plus the 2D floor names (pinyin-style codes such as `db`, `cgxg`,
with `_-1f`-style suffixes) are internal lookup keys of the data pack, used for icon
retrieval and floor matching and consumed by the app and docs on that basis. They do
not point to any external tool or origin.

### 3.1 Stale-data defenses

The source placement and config tables contain a small number of stale rows; the
pipeline validates each map against measured content during conversion:

- **Outlier chunk removal**: a chunk whose bounding box is more than 512 m away from
  every other chunk and does not intersect the 2D overview calibration region is a
  stale placement row (e.g. stray props at the world origin) and is not shipped —
  Zero Dam drops 1 chunk (2 instances), Layali Grove drops 1 chunk (47 instances),
  the other 4 maps have none;
- **Scene bounds validation**: if the source scene bounds center falls inside a void
  (more than 350 m from the nearest chunk — framing on it would leave nothing within
  the streaming radius), the bounds are replaced with the union of the remaining chunk
  content; Layali Grove is the affected map;
- **Spawn validation**: `DefaultBornPos` must fall inside the 2D overview calibration
  region; stale out-of-region spawns are replaced with the region center (Y taken from
  the median placement height inside the region) — Layali Grove and Space City spawns
  are stale source rows and have been replaced by this rule.

The consumer side (`apps/web/src/data/`) mirrors these keys one-to-one and is verified
per map by the real-container regression in `apps/web/src/data/loadMap.test.ts`.

## 4. Loading behavior and failure states

- **Switch cache**: a container's download + verification result is cached per MapId;
  switching back never re-downloads.
- **Progress**: container download contributes ~70% of the progress bar; the rest is
  driven by streamed 3D chunk loading.
- **Three failure states**: missing container or network failure → `unavailable`
  (the switcher shows "data pack in preparation" with a retry action); integrity or
  manifest failure → `corrupt`; anything else → `unknown`. The status bar shows the
  classified message; full details go to the console.

## 5. Maintenance

- Containers are produced by a private asset pipeline and committed as-is; the app only
  reads them and never rebuilds them in-repo.
- Changing key material (`apps/web/src/engine/dmapKey.ts`) requires rebuilding every
  `.dmap`; hand-edited containers fail integrity verification.
- When adding or updating containers, update the table above and the real-container
  regression in `apps/web/src/data/loadMap.test.ts`.
