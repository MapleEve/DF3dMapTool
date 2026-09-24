/** 中文文案（默认语言）。en.ts 的结构与本文件严格同构。 */
export const zh = {
  app: {
    title: 'DF3dMapTool',
    tagline: '开源 3D 战术地图查看器',
  },
  common: {
    close: '关闭',
  },
  maps: {
    az3: 'AZ3',
    brakkesh: '巴克什',
    damiris: '零号大坝',
    forrest: '长弓溪谷',
    spacecenter: '航天基地',
    tideprison: '潮汐监狱',
  },
  floor: {
    label: '楼层',
    floorName: '{{floor}} 层',
    basement: '地下 {{floor}} 层',
  },
  poiCategory: {
    extract: '撤离点',
    supply: '物资',
    objective: '任务目标',
    landmark: '地标',
    hazard: '危险区域',
    spawn: '出生点',
  },
  poi: {
    allFloors: '全楼层',
    locate: '定位',
    close: '关闭',
    noDescription: '暂无描述',
  },
  toolbar: {
    mapSelect: '选择地图',
    floorSelect: '楼层',
    language: '切换语言',
    openBigmap: '大地图 (M)',
    closeBigmap: '关闭 (M)',
    toggleSidebar: '侧栏',
  },
  switcher: {
    preparing: '数据包准备中',
    preparingNotice: '《{{map}}》数据包准备中，敬请期待',
    retry: '重试',
  },
  sidebar: {
    title: '兴趣点',
    searchPlaceholder: '搜索兴趣点…',
    clearSearch: '清空',
    categories: '分类',
    showAll: '全选',
    hideAll: '全不选',
    resultCount: '{{count}} 个结果',
    emptyWhenReady: '当前筛选下没有兴趣点',
    needMapData: '加载地图数据后展示兴趣点',
    hintFloor: '当前楼层：{{floor}}；楼层 0 的标注在各层均显示',
  },
  bigmap: {
    title: '俯视地图',
    hint: 'M 键开关 · 滚轮缩放 · 拖拽平移 · 右键落标记',
    needCalibration: '当前地图暂无俯视标定数据',
    overviewFloor: '全图',
    floorTitle: '楼层切换',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetView: '复位',
  },
  hud: {
    worldCoords: '世界坐标',
    north: '北',
    screenshot: '截图',
  },
  settings: {
    title: '设置',
    quality: '画质',
    qualityHint: '画质影响渲染分辨率（像素比上限），更改即时生效。',
    language: '语言',
    qualityLevels: {
      low: '低',
      medium: '中',
      high: '高',
    },
  },
  status: {
    idle: '待加载',
    loading: '地图数据加载中…',
    ready: '就绪',
    placements: '摆放 {{count}}',
  },
  errors: {
    unavailable: '地图数据包不存在或尚未随应用分发',
    corrupt: '地图数据包校验失败，文件可能已损坏',
    unknown: '发生未知错误',
  },
} as const;

/** 结构同 zh，但值放宽为 string（供 en.ts 与 i18next 类型增强使用）。 */
type WidenStrings<T> = { [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]> };

export type TranslationSchema = WidenStrings<typeof zh>;
