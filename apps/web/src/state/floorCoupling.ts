/**
 * 楼层域耦合：2D 沙盘（站点楼层，0 基）与 3D 场景（应用楼层，1 基）的换算与合并。
 *
 * - 站点楼层 0 基：floors 形如 [-1,0,1]（UI 标签 -1F/1F/2F）；az3 为 [0,1,2]（1F/2F/3F）。
 * - 应用楼层与 3D 数据包 manifest.floors 对齐：damiris [-1,1,2]、az3 [1,2,3]。
 * - 换算规则（缺省兜底）：site f<0 → app f；site f>=0 → app f+1（反向：app f<=-1 → site f；app f>=1 → site f-1）。
 * - 权威口径是随 2D 数据包提供的显式映射表（meta.floorMap），运行时反查优先；
 *   表缺项时才落回算术规则，防止两套楼层标注错位。
 */

/** 站点↔应用楼层的显式映射项（2D 数据包 meta.floorMap 逐条对应）。 */
export interface FloorMapEntry {
  readonly site: number;
  readonly app: number;
}

export type FloorMap = readonly FloorMapEntry[];

/** 站点楼层 → 应用楼层：显式表优先，缺项回退算术规则。 */
export function siteFloorToAppFloor(siteFloor: number, floorMap?: FloorMap): number {
  const entry = floorMap?.find((item) => item.site === siteFloor);
  if (entry !== undefined) {
    return entry.app;
  }
  return siteFloor < 0 ? siteFloor : siteFloor + 1;
}

/** 应用楼层 → 站点楼层：显式表逆查优先，缺项回退算术规则；0（全楼层）无站点对应，原样返回。 */
export function appFloorToSiteFloor(appFloor: number, floorMap?: FloorMap): number {
  const entry = floorMap?.find((item) => item.app === appFloor);
  if (entry !== undefined) {
    return entry.site;
  }
  if (appFloor <= -1) {
    return appFloor;
  }
  if (appFloor >= 1) {
    return appFloor - 1;
  }
  return appFloor;
}

/** 站点楼层值域 → 应用域楼层表（升序去重）。 */
export function sandboxFloorsToAppDomain(
  siteFloors: readonly number[],
  floorMap?: FloorMap,
): number[] {
  const mapped = siteFloors.map((siteFloor) => siteFloorToAppFloor(siteFloor, floorMap));
  return [...new Set(mapped)].toSorted((a, b) => a - b);
}

/** 3D 楼层表 ∪ 沙盘楼层表（应用域，升序去重）；沙盘表为 null 时仅 3D 表。 */
export function mergeFloorOptions(
  mapFloors: readonly number[],
  sandboxFloors: readonly number[] | null,
): number[] {
  const merged = sandboxFloors === null ? [...mapFloors] : [...mapFloors, ...sandboxFloors];
  return [...new Set(merged)].toSorted((a, b) => a - b);
}
