import { beforeEach, describe, expect, it } from "vitest";
import { stubGlobal } from "@/testing/globals";

// node 测试环境无 localStorage：先装桩再装载 store（每个测试文件独立模块图）
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

import type { CollectionData, CollectionRoll } from "@/data/routes";

const { useCollectionStore, rollCollectionItems, readFavorites, FAVORITES_STORAGE_KEY } =
  await import("./collectionStore");
const { loadCollectionData } = await import("@/data/routes");

function testData(): CollectionData {
  const items = [
    { id: "a", name: "物品甲", nameEn: "Item A", quality: 2, subTitle: "", description: "" },
    { id: "b", name: "物品乙", nameEn: "Item B", quality: 4, subTitle: "副标题", description: "" },
    { id: "c", name: "物品丙", nameEn: "Item C", quality: 6, subTitle: "", description: "" },
  ];
  return {
    items,
    itemById: new Map(items.map((item) => [item.id, item])),
    rollById: new Map<number, CollectionRoll>([
      [
        1001,
        { id: 1001, rollCollections: ["a", "b", "c"], rollWeights: [5, 5, 5], rollMaxNumber: 2 },
      ],
      [
        1002,
        { id: 1002, rollCollections: ["a", "missing"], rollWeights: [1, 1], rollMaxNumber: 3 },
      ],
    ]),
    poiRollId: new Map([["poi1", 1001]]),
  };
}

describe("收藏 roll 抽取", () => {
  it("确定性 rng 抽取：数量受 rollMaxNumber 与池大小约束、不重复", () => {
    const data = testData();
    const roll = data.rollById.get(1001)!;
    // rng=0 → 总是选池首
    const items = rollCollectionItems(roll, data, () => 0);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("a");
    expect(items[1].id).toBe("b");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("池中缺失物品被跳过，数量以有效池为准", () => {
    const data = testData();
    const roll = data.rollById.get(1002)!;
    const items = rollCollectionItems(roll, data, () => 0);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a");
  });

  it("权重为零的物品不参与抽取", () => {
    const data = testData();
    const roll: CollectionRoll = {
      id: 1003,
      rollCollections: ["a", "b"],
      rollWeights: [0, 1],
      rollMaxNumber: 1,
    };
    const items = rollCollectionItems(roll, data, () => 0.99);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });
});

describe("收藏面板 store", () => {
  beforeEach(() => {
    storage.clear();
    useCollectionStore.setState({
      open: false,
      poiId: null,
      rollId: null,
      items: [],
      selectedItemId: null,
      favoritesView: false,
      favorites: [],
      data: null,
      dataStatus: "idle",
    });
  });

  it("openPanel 抽取当前 roll 内容；缺失 roll 表呈现空态", () => {
    const data = testData();
    const store = useCollectionStore.getState();
    store.openPanel("poi1", 1001, data);
    expect(useCollectionStore.getState().open).toBe(true);
    expect(useCollectionStore.getState().items).toHaveLength(2);
    // roll 表缺失（数据缺口）：空态、不编造内容
    store.openPanel("poi2", 9999, data);
    expect(useCollectionStore.getState().items).toHaveLength(0);
  });

  it("reroll 按当前 roll 表重抽（确定性 rng 校验）", () => {
    const data = testData();
    useCollectionStore.setState({ data, rollId: 1001, open: true });
    useCollectionStore.getState().reroll(() => 0);
    expect(useCollectionStore.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("收藏标记写入 localStorage 并可取消", () => {
    const store = useCollectionStore.getState();
    store.toggleFavorite("a");
    expect(useCollectionStore.getState().favorites).toEqual(["a"]);
    expect(JSON.parse(storage.get(FAVORITES_STORAGE_KEY)!)).toEqual(["a"]);
    store.toggleFavorite("a");
    expect(useCollectionStore.getState().favorites).toEqual([]);
  });

  it("readFavorites 脏数据容忍", () => {
    storage.set(FAVORITES_STORAGE_KEY, "not-json");
    expect(readFavorites()).toEqual([]);
  });
});

describe("loadCollectionData（数据层契约）", () => {
  it("容器未随应用分发时归类为不可用", async () => {
    stubGlobal("fetch", () => Promise.resolve(new Response("not found", { status: 404 })));
    const { resetRouteDataCache } = await import("@/data/routes");
    resetRouteDataCache();
    await expect(loadCollectionData()).rejects.toBeInstanceOf(Error);
  });
});
