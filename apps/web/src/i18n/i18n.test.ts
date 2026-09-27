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
// 本用例验证语言恢复 + html lang 联动 + 初始语言解析链（URL/浏览器检测桩在下方覆盖）。
stubGlobal("document", { documentElement: { lang: "" } });

const { default: i18next } = await import("i18next");
const {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  changeLanguage,
  initI18n,
  isLanguage,
  readStoredLanguage,
  normalizeLanguageCode,
  detectNavigatorLanguage,
  resolveInitialLanguage,
  readUrlLanguage,
  LANGUAGE_STORAGE_KEY,
} = await import("./index");
const { zh } = await import("./zh");
const { en } = await import("./en");
const { ru } = await import("./ru");
const { tw } = await import("./tw");

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
  const dicts: Record<string, Dict> = { zh, en, ru, tw };
  const reference = leafPaths(zh);

  it("zh/en/ru/tw 叶子键路径集合完全一致", () => {
    expect(reference.length).toBeGreaterThan(130);
    for (const name of ["en", "ru", "tw"]) {
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
      for (const name of ["en", "ru", "tw"]) {
        const value = leafValue(dicts[name], path);
        expect(placeholders(value as string), `${name}:${path}`).toEqual(expected);
      }
    }
  });

  it("键数统计：四语言各 236 个叶子键（Batch4 壳 1:1 对齐 + 路线/物资/交互命名空间；Batch5 增 keytips Q/R/F×3 + routeNav/respawn/interact + webglGuide×3 + 玩法模式 mapMode×3 + bigmap 模式面板×2）", () => {
    expect(leafPaths(zh)).toHaveLength(236);
    expect(leafPaths(en)).toHaveLength(236);
    expect(leafPaths(ru)).toHaveLength(236);
    expect(leafPaths(tw)).toHaveLength(236);
  });

  it("语言枚举与选择器标签覆盖四语言（zh/en/ru/tw；ja/ko 不在语言集内）", () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(["zh", "en", "ru", "tw"]);
    expect(LANGUAGE_LABELS.zh).toBe("中文");
    expect(LANGUAGE_LABELS.en).toBe("English");
    expect(LANGUAGE_LABELS.ru).toBe("Русский");
    expect(LANGUAGE_LABELS.tw).toBe("繁體中文");
    expect(isLanguage("ru")).toBe(true);
    expect(isLanguage("tw")).toBe(true);
    expect(isLanguage("ja")).toBe(false);
    expect(isLanguage("ko")).toBe(false);
  });

  it("玩法模式与模式面板键四语言齐备（Batch5 模式选择）", () => {
    expect(zh.mapMode.confidential).toBe("机密");
    expect(ru.mapMode.confidential).toBe("Секретный");
    expect(tw.mapMode.confidential).toBe("機密");
    expect(en.bigmap.modeTitle).toBe("Game Mode");
    expect(tw.bigmap.modeTitle).toBe("玩法模式");
  });

  it("键位行 Q/R/F 四语言齐备（Batch5 操作说明面板补行）", () => {
    expect(zh.keytips.keyQ).toBe("Q");
    expect(zh.keytips.routeNav).toBe("线路导航");
    expect(en.keytips.respawn).toBe("Respawn");
    expect(ru.keytips.interact).toBe("Действие");
    expect(tw.keytips.routeNav).toBe("線路導航");
  });

  it("WebGL 引导提示四语言齐备（Batch5）", () => {
    expect(zh.webglGuide.dismiss).toBe("知道了");
    expect(en.webglGuide.title).toBe("3D view unavailable");
    expect(ru.webglGuide.dismiss).toBe("Понятно");
    expect(tw.webglGuide.title).toBe("3D 視圖不可用");
  });
});

describe("2D 沙盘命名空间（sandbox2d）", () => {
  it("站点种子键照抄：zh 繁→简、en 逐字、tw 取繁体原文、ru 取站点俄文字典", () => {
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
    expect(tw.sandbox2d.selectAll).toBe("選擇全部");
    expect(tw.sandbox2d.searchPlaceholder).toBe("查找地點位置...");
    expect(tw.sandbox2d.notFound).toBe("找不到匹配的類型");
    expect(tw.sandbox2d.filterPoints).toBe("過濾點位");
    expect(tw.sandbox2d.coordinates).toBe("座標");
    expect(tw.sandbox2d.copySuccess).toBe("複製連結成功");
    expect(tw.sandbox2d.switchTo3d).toBe("3D 互動地圖");
    expect(ru.sandbox2d.selectAll).toBe("Выбрать все");
    expect(ru.sandbox2d.searchPlaceholder).toBe("Найти местоположения...");
    expect(ru.sandbox2d.notFound).toBe("Не найдено совпадающих типов местоположений");
    expect(ru.sandbox2d.filterPoints).toBe("Фильтровать точки");
    expect(ru.sandbox2d.coordinates).toBe("Координаты");
    expect(ru.sandbox2d.copySuccess).toBe("Ссылка успешно скопирована");
    expect(ru.sandbox2d.switchTo3d).toBe("3D Интерактивная Карта");
  });

  it("分组页签标签对齐站点口径：zh 繁→简、tw 取繁體原文、ru 取站点实测、en 取站点 DOM 实测", () => {
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
    expect(tw.sandbox2d.groups.loot).toBe("蒐索點");
    expect(tw.sandbox2d.groups.extraction).toBe("撤離點");
    expect(tw.sandbox2d.groups.redLoot).toBe("大紅物資");
    expect(tw.sandbox2d.groups.event).toBe("活動標記");
    expect(ru.sandbox2d.groups.loot).toBe("Точки добычи");
    expect(ru.sandbox2d.groups.extraction).toBe("Точки эвакуации");
    expect(ru.sandbox2d.groups.redLoot).toBe("Красный лут");
    expect(ru.sandbox2d.groups.event).toBe("Метки событий");
  });

  it("楼层标签规则占位符四语言一致（站点 -1F/1F/2F 实测口径）", () => {
    expect(zh.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(en.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(ru.sandbox2d.floorLabel).toBe("{{floor}}F");
    expect(tw.sandbox2d.floorLabel).toBe("{{floor}}F");
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
    for (const dict of [zh, en, ru, tw]) {
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
    expect(ru.toolbar.view3d).toBe("3D-песочница");
    expect(tw.toolbar.view2d).toBe("2D 沙盤");
  });
});

describe("语言持久化恢复（readStoredLanguage）", () => {
  it("四语言存量值直接兼容；非法/缺失回退默认 zh", () => {
    for (const code of SUPPORTED_LANGUAGES) {
      storage.set(LANGUAGE_STORAGE_KEY, code);
      expect(readStoredLanguage()).toBe(code);
    }
    storage.set(LANGUAGE_STORAGE_KEY, "ja");
    expect(readStoredLanguage()).toBe("zh");
    storage.set(LANGUAGE_STORAGE_KEY, "ko");
    expect(readStoredLanguage()).toBe("zh");
    storage.delete(LANGUAGE_STORAGE_KEY);
    expect(readStoredLanguage()).toBe("zh");
  });
});

/** 装桩 window.location.search（?lang= 参数来源）。 */
function setUrl(search: string): void {
  stubGlobal("window", {
    location: { search },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

/** 装桩 navigator.language（浏览器语言检测来源）。 */
function setNavigator(language: string | undefined): void {
  if (language === undefined) {
    stubGlobal("navigator", {});
  } else {
    stubGlobal("navigator", { language });
  }
}

describe("初始语言解析链（?lang= > 存档 > 浏览器语言 > 默认 zh）", () => {
  // 记录原始全局引用，套件末尾还原（stubGlobal 只装桩不清桩）。
  const hadWindow = "window" in globalThis;
  const hadNavigator = "navigator" in globalThis;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

  it("语言码归一：小写前两字符（zh-CN→zh、en-US→en）", () => {
    expect(normalizeLanguageCode("zh-CN")).toBe("zh");
    expect(normalizeLanguageCode("en-US")).toBe("en");
    expect(normalizeLanguageCode(" RU ")).toBe("ru");
    expect(normalizeLanguageCode("tw")).toBe("tw");
  });

  it("?lang= 合法值最优先（覆盖存档与浏览器语言）", () => {
    storage.set(LANGUAGE_STORAGE_KEY, "zh");
    setNavigator("en-US");
    setUrl("?lang=ru");
    expect(readUrlLanguage()).toBe("ru");
    expect(resolveInitialLanguage()).toBe("ru");

    setUrl("?lang=tw");
    expect(readUrlLanguage()).toBe("tw");
    expect(resolveInitialLanguage()).toBe("tw");

    // 区域前缀归一：zh-CN 命中 zh。
    setUrl("?lang=zh-CN");
    expect(readUrlLanguage()).toBe("zh");
    expect(resolveInitialLanguage()).toBe("zh");
  });

  it("?lang= 非法值按口径落默认 zh（不再看存档/浏览器）", () => {
    storage.set(LANGUAGE_STORAGE_KEY, "en");
    setNavigator("ru");
    setUrl("?lang=fr");
    expect(readUrlLanguage()).toBeNull();
    expect(resolveInitialLanguage()).toBe("zh");
  });

  it("无参数：存档优先，其次浏览器语言，最后默认 zh", () => {
    setUrl("");
    setNavigator("en-US");
    storage.set(LANGUAGE_STORAGE_KEY, "ru");
    expect(resolveInitialLanguage()).toBe("ru");

    storage.delete(LANGUAGE_STORAGE_KEY);
    expect(resolveInitialLanguage()).toBe("en");

    setNavigator("ru");
    expect(resolveInitialLanguage()).toBe("ru");

    setNavigator("ja");
    expect(resolveInitialLanguage()).toBe("zh");

    setNavigator(undefined);
    expect(resolveInitialLanguage()).toBe("zh");
  });

  it("浏览器语言检测：前两字符归一，不支持语言返回 null", () => {
    setNavigator("ru-RU");
    expect(detectNavigatorLanguage()).toBe("ru");
    setNavigator("zh-TW");
    // zh-TW 前两字符归一为 zh（tw 仅经 ?lang=tw 直接命中，与入口参数口径一致）。
    expect(detectNavigatorLanguage()).toBe("zh");
    setNavigator("ko-KR");
    expect(detectNavigatorLanguage()).toBeNull();
  });

  it("无 window/navigator（SSR/测试）时静默回退，套件收尾还原全局桩", () => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "navigator");
    expect(readUrlLanguage()).toBeNull();
    expect(detectNavigatorLanguage()).toBeNull();
    storage.delete(LANGUAGE_STORAGE_KEY);
    expect(resolveInitialLanguage()).toBe("zh");

    // 还原本套件动过的全局桩，避免影响后续用例/测试文件。
    if (hadWindow && originalWindow !== undefined) {
      stubGlobal("window", originalWindow);
    }
    if (hadNavigator && originalNavigator !== undefined) {
      stubGlobal("navigator", originalNavigator);
    }
    expect(true).toBe(true);
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

  it("changeLanguage 切换四语言并联动 html lang（zh 用 zh-CN、tw 用 zh-TW）", async () => {
    await changeLanguage("ru");
    expect(i18next.language).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(i18next.t("sandbox2d.title")).toBe("2D-песочница");

    await changeLanguage("tw");
    expect(i18next.language).toBe("tw");
    expect(document.documentElement.lang).toBe("zh-TW");
    expect(i18next.t("sandbox2d.groups.redLoot")).toBe("大紅物資");

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
