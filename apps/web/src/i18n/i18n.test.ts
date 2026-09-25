import { describe, expect, it } from "vitest";
import { stubGlobal } from "@/testing/globals";

// node 测试环境无 localStorage/document：先装桩再装载 i18n（每个测试文件独立模块图）
const storage = new Map<string, string>();
stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
});
// 本用例以持久化 ko 启动，验证四语言存量恢复 + html lang 联动。
stubGlobal("document", { documentElement: { lang: "" } });

const { default: i18next } = await import("i18next");
const {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  changeLanguage,
  initI18n,
  isLanguage,
  readStoredLanguage,
  LANGUAGE_STORAGE_KEY,
} = await import("./index");
const { zh } = await import("./zh");
const { en } = await import("./en");
const { ja } = await import("./ja");
const { ko } = await import("./ko");

type Dict = Record<string, unknown>;

/** 递归收集叶子键路径（点号分隔，与 i18next t() 的寻址一致）。 */
function leafPaths(dict: Dict, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      paths.push(...leafPaths(value as Dict, path));
    } else {
      paths.push(path);
    }
  }
  return paths.toSorted();
}

/** 递归读取叶子值。 */
function leafValue(dict: Dict, path: string): unknown {
  let current: unknown = dict;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Dict)[key];
  }
  return current;
}

/** 提取 i18next 插值占位符名。 */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).toSorted();
}

describe("四语言字典结构同构", () => {
  const dicts: Record<string, Dict> = { zh, en, ja, ko };
  const reference = leafPaths(zh);

  it("zh/en/ja/ko 叶子键路径集合完全一致", () => {
    expect(reference.length).toBeGreaterThan(130);
    for (const name of ["en", "ja", "ko"]) {
      expect(leafPaths(dicts[name])).toEqual(reference);
    }
  });

  it("插值占位符四语言一致（防翻译丢失 {{var}}）", () => {
    for (const path of reference) {
      const base = leafValue(zh, path);
      if (typeof base !== "string") {
        continue;
      }
      const expected = placeholders(base);
      if (expected.length === 0) {
        continue;
      }
      for (const name of ["en", "ja", "ko"]) {
        const value = leafValue(dicts[name], path);
        expect(placeholders(value as string), `${name}:${path}`).toEqual(expected);
      }
    }
  });

  it("键数统计：四语言各 138 个叶子键（103 基线 + toolbar 3 + sandbox2d 31 + poi.locateIn2d）", () => {
    expect(leafPaths(zh)).toHaveLength(138);
    expect(leafPaths(en)).toHaveLength(138);
    expect(leafPaths(ja)).toHaveLength(138);
    expect(leafPaths(ko)).toHaveLength(138);
  });

  it("语言枚举与选择器标签覆盖四语言", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(["zh", "en", "ja", "ko"]);
    expect(LANGUAGE_LABELS.zh).toBe("中文");
    expect(LANGUAGE_LABELS.en).toBe("English");
    expect(LANGUAGE_LABELS.ja).toBe("日本語");
    expect(LANGUAGE_LABELS.ko).toBe("한국어");
    expect(isLanguage("ja")).toBe(true);
    expect(isLanguage("ko")).toBe(true);
    expect(isLanguage("ru")).toBe(false);
    expect(isLanguage("tw")).toBe(false);
  });
});

describe("2D 沙盘命名空间（sandbox2d）", () => {
  it("站点种子键照抄：zh 繁→简、en 逐字", () => {
    expect(zh.sandbox2d.selectAll).toBe("选择全部");
    expect(zh.sandbox2d.all).toBe("全部");
    expect(zh.sandbox2d.searchPlaceholder).toBe("查找地点位置...");
    expect(zh.sandbox2d.notFound).toBe("找不到匹配的类型");
    expect(zh.sandbox2d.noData).toBe("找不到任何资料");
    expect(zh.sandbox2d.filterPoints).toBe("过滤点位");
    expect(zh.sandbox2d.viewPoints).toBe("查看点位");
    expect(zh.sandbox2d.viewOtherMaterials).toBe("查看其他资料");
    expect(zh.sandbox2d.coordinates).toBe("坐标");
    expect(zh.sandbox2d.lastUpdated).toBe("最后更新");
    expect(zh.sandbox2d.copySuccess).toBe("复制链接成功");
    expect(zh.sandbox2d.copyFailed).toBe("复制链接失败");
    expect(en.sandbox2d.selectAll).toBe("Select All");
    expect(en.sandbox2d.searchPlaceholder).toBe("Find name locations...");
    expect(en.sandbox2d.notFound).toBe("No matching location types found");
    expect(en.sandbox2d.filterPoints).toBe("Filter Points");
    expect(en.sandbox2d.viewPoints).toBe("View Points");
    expect(en.sandbox2d.viewOtherMaterials).toBe("View other materials");
    expect(en.sandbox2d.coordinates).toBe("Coordinates");
    expect(en.sandbox2d.lastUpdated).toBe("Last updated");
    expect(en.sandbox2d.copySuccess).toBe("Copy link success");
    expect(en.sandbox2d.copyFailed).toBe("Copy link failed");
    expect(en.sandbox2d.switchTo3d).toBe("3D Interactive Map");
  });

  it("分组页签标签对齐站点口径：tw 组名繁→简、en 取站点 DOM 实测", () => {
    expect(zh.sandbox2d.groups.loot).toBe("搜索点");
    expect(zh.sandbox2d.groups.spawn).toBe("出生点");
    expect(zh.sandbox2d.groups.extraction).toBe("撤离点");
    expect(zh.sandbox2d.groups.redLoot).toBe("大红物资");
    expect(zh.sandbox2d.groups.event).toBe("活动标记");
    expect(en.sandbox2d.groups.loot).toBe("Loot Points");
    expect(en.sandbox2d.groups.spawn).toBe("Spawn Points");
    expect(en.sandbox2d.groups.extraction).toBe("Extraction Points");
    expect(en.sandbox2d.groups.redLoot).toBe("Red Loot");
    expect(en.sandbox2d.groups.event).toBe("Event Points");
  });

  it("楼层标签规则占位符四语言一致（站点 -1F/1F/2F 实测口径）", () => {
    expect(zh.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(en.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(ja.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(ko.sandbox2d.floorLabel).toBe("{{floor}}F");
  });

  it("潮汐监狱空态标题不补进字典（如实对齐缺键直出回退）", () => {
    const fallbackTitle = "map.CONTROL.TDK.TIDE_PRISON.TITLE";
    const allValues: unknown[] = [];
    const collect = (dict: Dict) => {
      for (const value of Object.values(dict)) {
        if (value !== null && typeof value === "object") {
          collect(value as Dict);
        } else {
          allValues.push(value);
        }
      }
    };
    for (const dict of [zh, en, ja, ko]) {
      collect(dict as unknown as Dict);
    }
    expect(allValues).not.toContain(fallbackTitle);
    expect(Object.hasOwn(zh.sandbox2d, "emptyTitle")).toBe(false);
  });

  it("index 级 2D/3D 切换标签存在（toolbar.view2d/view3d/viewSwitch）", () => {
    expect(zh.toolbar.view2d).toBe("2D 沙盘");
    expect(zh.toolbar.view3d).toBe("3D 沙盘");
    expect(zh.toolbar.viewSwitch).toBe("沙盘视图切换");
    expect(en.toolbar.view2d).toBe("2D Sandbox");
    expect(en.toolbar.view3d).toBe("3D Sandbox");
    expect(ja.toolbar.view3d).toBe("3D サンドボックス");
    expect(ko.toolbar.view2d).toBe("2D 샌드박스");
  });
});

describe("语言持久化恢复（readStoredLanguage）", () => {
  it("四语言存量值直接兼容；非法/缺失回退默认 zh", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      storage.set(LANGUAGE_STORAGE_KEY, code);
      expect(readStoredLanguage()).toBe(code);
    }
    storage.set(LANGUAGE_STORAGE_KEY, "ru");
    expect(readStoredLanguage()).toBe("zh");
    storage.set(LANGUAGE_STORAGE_KEY, "tw");
    expect(readStoredLanguage()).toBe("zh");
    storage.delete(LANGUAGE_STORAGE_KEY);
    expect(readStoredLanguage()).toBe("zh");
  });
});

describe("语言初始化、切换与 html lang 联动", () => {
  // 注：bun test 跨测试文件共享 i18next 单例（vitest 则按文件隔离），
  // 故此处只断言与初始化先后次序无关的行为；存量恢复语义由上面的
  // readStoredLanguage 直测覆盖（initI18n 即以其为 lng 来源）。
  it("initI18n 幂等完成初始化", async () => {
    await initI18n();
    expect(i18next.isInitialized).toBe(true);
    await initI18n();
    expect(i18next.isInitialized).toBe(true);
  });

  it("changeLanguage 切换四语言并联动 html lang（zh 用 zh-CN）", async () => {
    await changeLanguage("ko");
    expect(i18next.language).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(i18next.t("sandbox2d.title")).toBe("2D 샌드박스");

    await changeLanguage("ja");
    expect(i18next.language).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
    expect(i18next.t("sandbox2d.groups.redLoot")).toBe("レッド戦利品");

    await changeLanguage("zh");
    expect(i18next.language).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(i18next.t("sandbox2d.title")).toBe("2D 沙盘");

    await changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    expect(i18next.t("sandbox2d.switchTo3d")).toBe("3D Interactive Map");

    // 收尾回默认语言：bun test 跨测试文件共享 i18next 单例，不向后续文件残留 en。
    await changeLanguage("zh");
    expect(i18next.language).toBe("zh");
  });
});
