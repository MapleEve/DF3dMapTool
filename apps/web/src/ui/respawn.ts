import type { Vec3 } from "@/common/geometry";
import type { PoiCategory, PoiDefinition } from "@/poi/types";

/**
 * 回出生点（R 键/设置面板按钮）的流程参数与落点选取。
 *
 * 行为口径（上游实测）：按键 → 进图加载遮罩（地图名 +「加载中」+ 大百分比
 * 爬升至 99%）→ 遮罩解除时相机已位于出生点集的随机一点（落点与进场取景位
 * 不同；出生点集 = POI 数据的出生点分类，缺省回落地图默认出生点）。
 */

/** 遮罩时长（毫秒）：百分比自起始值爬升至 99%。 */
export const RESPAWN_COVER_MS = 3200;

/** 遮罩解除（毫秒）：99% 短暂驻留后硬切卸载。 */
export const RESPAWN_REVEAL_MS = 3600;

/**
 * 遮罩上屏到硬传送的间隔（毫秒）：传送会触发新取景区域的分块流式
 * （拉取+解析+首帧渲染），弱环境（软渲染）下主线程随即饱和；
 * 先让遮罩渲染上屏、再执行传送，保证按键后立即见到加载屏而非冻结旧帧。
 */
export const RESPAWN_TELEPORT_DELAY_MS = 150;

/** 遮罩起始百分比（遮罩期间爬升至 99）。 */
export const RESPAWN_COVER_START_PERCENT = 55;

/** 遮罩结束百分比。 */
export const RESPAWN_COVER_END_PERCENT = 99;

/** 分类是否为出生点（内置 id / i18n 键 / 数据包中文显示名三口径兜底）。 */
function isSpawnCategory(category: PoiCategory): boolean {
  return (
    category.id === "spawn" ||
    category.labelKey === "poiCategory.spawn" ||
    category.label === "出生点"
  );
}

/**
 * 从出生点集中随机取一点：出生点分类 POI 优先；无出生点 POI 时回落
 * 地图默认出生点；两者皆无返回 null（调用方按进场取景位兜底）。
 * random 注入以便测试确定性。
 */
export function pickRespawnPosition(
  pois: readonly PoiDefinition[],
  categories: readonly PoiCategory[],
  fallback: Vec3 | null,
  random: () => number = Math.random,
): Vec3 | null {
  const spawnCategoryIds = new Set(
    categories.filter(isSpawnCategory).map((category) => category.id),
  );
  const spawnPositions = pois
    .filter((poi) => spawnCategoryIds.has(poi.categoryId) || poi.categoryId === "spawn")
    .map((poi) => poi.position);
  if (spawnPositions.length > 0) {
    return spawnPositions[Math.floor(random() * spawnPositions.length)] ?? null;
  }
  return fallback;
}
