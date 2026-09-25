import type { Language } from "./index";

/**
 * 2D 沙盘数据名称的语言解析链（设计文档 §3.2 语言矩阵，不走 i18next——数据名称是数据包字段而非 UI 文案）。
 *
 * 数据包（sandbox2d.dmap data.json）语言字段族：
 * - regions: { nameEn, nameZhTw, nameZh }   nameZh = 站点 tw 名繁→简（管线 sandbox2d_lang.mjs 完成转换）
 * - points:  { nameEn, titleEn, titleZh, descEn }
 * - legend:  { nameEn }（站点三 locale 图例均显英文，如实对齐：全语言恒英文）
 *
 * 解析矩阵：
 * | 实体     | zh        | en        | ja / ko   |
 * | 区域名   | nameZh→nameEn | nameEn→nameZh | 走 zh 链 |
 * | POI 标题 | titleZh→titleEn | titleEn→titleZh | 走 zh 链 |
 * | 图例名   | nameEn（全语言） | nameEn | nameEn |
 * | POI 描述 | descEn（全语言，站点无任何翻译） | | |
 */

/** 2D 沙盘区域名的语言字段（sandbox2d 数据包 regions 条目的名称子集）。 */
export interface SandboxRegionNameFields {
  readonly nameEn: string | null;
  readonly nameZh: string | null;
}

/** 2D 沙盘 POI 的语言字段（sandbox2d 数据包 points 条目的名称子集）。 */
export interface SandboxPointNameFields {
  readonly nameEn: string | null;
  readonly titleEn: string | null;
  readonly titleZh: string | null;
}

/** 2D 沙盘图例条目的语言字段（sandbox2d 数据包 legend 条目的名称子集）。 */
export interface SandboxLegendNameFields {
  readonly nameEn: string | null;
}

/** 潮汐监狱 2D 空态标题：上游三语字典均缺 map.CONTROL.TDK.TIDE_PRISON.TITLE 键，缺键=原键直出。
 *  四语言一致直出此字面量；刻意不补进字典——补了就失去"如实对齐回退行为"（设计文档 §3.1）。 */
export const TIDE_PRISON_FALLBACK_TITLE = "map.CONTROL.TDK.TIDE_PRISON.TITLE";

function firstNonEmpty(...values: readonly (string | null)[]): string | null {
  for (const value of values) {
    if (value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

/** 区域名：zh（及 ja/ko 回退 zh 链）→ nameZh→nameEn；en → nameEn→nameZh。 */
export function resolveSandboxRegionName(
  region: SandboxRegionNameFields,
  locale: Language,
): string | null {
  return locale === "en"
    ? firstNonEmpty(region.nameEn, region.nameZh)
    : firstNonEmpty(region.nameZh, region.nameEn);
}

/** POI 标题（物品名）：zh（及 ja/ko 回退 zh 链）→ titleZh→titleEn；en → titleEn→titleZh。
 *  两字段均缺（如 rare_spawn 点位）返回 null，由调用侧回退图例名。 */
export function resolveSandboxPointTitle(
  point: SandboxPointNameFields,
  locale: Language,
): string | null {
  return locale === "en"
    ? firstNonEmpty(point.titleEn, point.titleZh)
    : firstNonEmpty(point.titleZh, point.titleEn);
}

/** POI 悬浮/搜索标签：上游规则 name || title，name 为站点英文专名、title 按语言链解析。 */
export function resolveSandboxPointLabel(
  point: SandboxPointNameFields,
  locale: Language,
): string | null {
  return firstNonEmpty(point.nameEn, resolveSandboxPointTitle(point, locale));
}

/** 图例/分类名：站点三 locale 图例均显英文，如实对齐——全语言恒 nameEn。 */
export function resolveSandboxLegendName(legend: SandboxLegendNameFields): string | null {
  return firstNonEmpty(legend.nameEn);
}

/** POI 描述：站点无任何翻译（name_i18n 全 null），全语言恒英文原文。 */
export function resolveSandboxPointDesc(point: { readonly descEn: string | null }): string | null {
  return firstNonEmpty(point.descEn);
}
