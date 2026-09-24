/**
 * 楼层分带推导（纯逻辑，可独立单测）。
 *
 * 摆放数据不含逐对象楼层字段，场景元数据提供的是楼层触发体（楼梯间等
 * 切层区域）的包围盒。以每个楼层的触发体中心高度均值代表该楼层高度，
 * 相邻楼层均值的中点作为分界，得到覆盖全高度域的分带；
 * 运行时按实例位置 Y 判定归属。无触发体的单层地图退化为单一分带。
 */

export interface FloorTrigger {
  readonly floor: number;
  readonly boundsCenter: readonly [number, number, number];
  readonly boundsExtent: readonly [number, number, number];
}

export interface FloorBand {
  readonly floor: number;
  /** 含下界、不含上界；最高带的上界为 +∞。 */
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * 由楼层列表 + 触发体推导分带（升序）。
 * floorValues 中的楼层若没有触发体，按与相邻楼层的相对顺序插入分带中间；
 * 触发体齐全时结果与触发体一致。
 */
export function deriveFloorBands(
  floorValues: readonly number[],
  triggers: readonly FloorTrigger[],
): FloorBand[] {
  if (floorValues.length === 0) {
    return [];
  }
  const floors = floorValues.toSorted((a, b) => a - b);
  if (floors.length === 1) {
    return [{ floor: floors[0], yMin: Number.NEGATIVE_INFINITY, yMax: Number.POSITIVE_INFINITY }];
  }

  // 每个楼层的触发体中心 Y 均值；无触发体的楼层高度未知，记为 null
  const centerByFloor = new Map<number, number | null>(floors.map((floor) => [floor, null]));
  const sums = new Map<number, { total: number; count: number }>();
  for (const trigger of triggers) {
    if (!centerByFloor.has(trigger.floor)) {
      continue;
    }
    const entry = sums.get(trigger.floor) ?? { total: 0, count: 0 };
    entry.total += trigger.boundsCenter[1];
    entry.count += 1;
    sums.set(trigger.floor, entry);
  }
  for (const [floor, sum] of sums) {
    centerByFloor.set(floor, sum.count > 0 ? sum.total / sum.count : null);
  }

  // 无触发体数据的地图：整体退化为单一带，保证对象可见
  if ([...centerByFloor.values()].every((value) => value === null)) {
    return [{ floor: floors[0], yMin: Number.NEGATIVE_INFINITY, yMax: Number.POSITIVE_INFINITY }];
  }

  // 缺触发体的楼层用相邻已知楼层的中点补齐（保持单调，避免分带交叠）
  const heights: number[] = [];
  for (let i = 0; i < floors.length; i += 1) {
    const known = centerByFloor.get(floors[i]);
    heights.push(known ?? Number.NaN);
  }
  for (let i = 0; i < heights.length; i += 1) {
    if (Number.isNaN(heights[i])) {
      const lower = findNearestKnown(heights, i, -1);
      const upper = findNearestKnown(heights, i, 1);
      if (lower >= 0 && upper >= 0) {
        heights[i] = (heights[lower] + heights[upper]) / 2;
      } else if (lower >= 0) {
        heights[i] = heights[lower] + (i - lower) * 4;
      } else if (upper >= 0) {
        heights[i] = heights[upper] - (upper - i) * 4;
      } else {
        heights[i] = 0;
      }
    }
  }
  for (let i = 1; i < heights.length; i += 1) {
    heights[i] = Math.max(heights[i], heights[i - 1] + 0.5);
  }

  const bands: FloorBand[] = [];
  for (let i = 0; i < floors.length; i += 1) {
    const yMin = i === 0 ? Number.NEGATIVE_INFINITY : (heights[i - 1] + heights[i]) / 2;
    const yMax =
      i === floors.length - 1 ? Number.POSITIVE_INFINITY : (heights[i] + heights[i + 1]) / 2;
    bands.push({ floor: floors[i], yMin, yMax });
  }
  return bands;
}

/** 按实例高度判定楼层：落在边界上归上层，越界归最近带。 */
export function floorForY(bands: readonly FloorBand[], y: number): number {
  if (bands.length === 0) {
    return 0;
  }
  for (const band of bands) {
    if (y >= band.yMin && y < band.yMax) {
      return band.floor;
    }
  }
  return y < bands[0].yMin ? bands[0].floor : bands[bands.length - 1].floor;
}

function findNearestKnown(heights: number[], from: number, step: number): number {
  let index = from + step;
  while (index >= 0 && index < heights.length) {
    if (!Number.isNaN(heights[index])) {
      return index;
    }
    index += step;
  }
  return -1;
}
