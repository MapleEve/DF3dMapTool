import { describe, expect, it } from 'vitest';
import { categoriesFromTypeConfig, isBuiltinPoiCategoryId, POI_CATEGORIES } from './categories';

describe('categoriesFromTypeConfig', () => {
  it('按类型配置派生分类：id/label/order 一一对应', () => {
    const categories = categoriesFromTypeConfig([
      { TypeId: 1, Name: '物资点', Name_Key: 'LANG_1' },
      { TypeId: 6, Name: '出生点', Name_Key: 'LANG_6' },
      { TypeId: 7, Name: '撤离点', Name_Key: 'LANG_7' },
    ]);
    expect(categories.map((category) => category.id)).toEqual(['t1', 't6', 't7']);
    expect(categories.map((category) => category.label)).toEqual(['物资点', '出生点', '撤离点']);
    expect(categories.map((category) => category.order)).toEqual([1, 6, 7]);
  });

  it('主题色按 TypeId 从调色板取色且不越界', () => {
    const categories = categoriesFromTypeConfig(
      Array.from({ length: 12 }, (_, index) => ({ TypeId: index + 1, Name: `T${index + 1}` })),
    );
    const colors = new Set(categories.map((category) => category.color));
    expect(colors.size).toBeLessThanOrEqual(9);
    for (const category of categories) {
      expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('内置兜底分类', () => {
  it('六个内置分类且 ID 为合法字面量', () => {
    expect(POI_CATEGORIES).toHaveLength(6);
    for (const category of POI_CATEGORIES) {
      expect(isBuiltinPoiCategoryId(category.id)).toBe(true);
    }
  });

  it('数据包派生的 id 不属于内置集合', () => {
    expect(isBuiltinPoiCategoryId('t6')).toBe(false);
  });
});
