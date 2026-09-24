import type { TranslationSchema } from './zh';

/** English resources. Must stay structurally identical to zh.ts. */
export const en: TranslationSchema = {
  app: {
    title: 'DF3dMapTool',
    tagline: 'Open-source 3D tactical map viewer',
  },
  common: {
    close: 'Close',
  },
  maps: {
    az3: 'AZ3',
    brakkesh: 'Brakkesh',
    damiris: 'Zero Dam',
    forrest: 'Layali Grove',
    spacecenter: 'Space City',
    tideprison: 'Tide Prison',
  },
  floor: {
    label: 'Floor',
    floorName: 'Floor {{floor}}',
    basement: 'Basement {{floor}}',
  },
  poiCategory: {
    extract: 'Extraction',
    supply: 'Supply',
    objective: 'Objective',
    landmark: 'Landmark',
    hazard: 'Hazard',
    spawn: 'Spawn',
  },
  poi: {
    allFloors: 'All floors',
    locate: 'Locate',
    close: 'Close',
    noDescription: 'No description yet',
  },
  toolbar: {
    mapSelect: 'Select map',
    floorSelect: 'Floor',
    language: 'Switch language',
    openBigmap: 'Big map (M)',
    closeBigmap: 'Close (M)',
    toggleSidebar: 'Sidebar',
  },
  switcher: {
    preparing: 'Data pack in preparation',
    preparingNotice: 'The data pack for {{map}} is in preparation — stay tuned',
    retry: 'Retry',
  },
  sidebar: {
    title: 'Points of interest',
    searchPlaceholder: 'Search points of interest…',
    clearSearch: 'Clear',
    categories: 'Categories',
    showAll: 'Show all',
    hideAll: 'Hide all',
    resultCount: '{{count}} results',
    emptyWhenReady: 'No points of interest match the current filters',
    needMapData: 'Points of interest appear once map data is loaded',
    hintFloor: 'Current floor: {{floor}}; floor-0 markers show on every floor',
  },
  bigmap: {
    title: 'Overhead map',
    hint: 'M to toggle · wheel to zoom · drag to pan · right-click to drop a marker',
    needCalibration: 'No overhead calibration data for this map yet',
    overviewFloor: 'Overview',
    floorTitle: 'Floor switch',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetView: 'Reset',
  },
  hud: {
    worldCoords: 'World coords',
    north: 'North',
    screenshot: 'Screenshot',
  },
  settings: {
    title: 'Settings',
    quality: 'Quality',
    qualityHint: 'Quality caps the render resolution (pixel ratio); changes apply immediately.',
    language: 'Language',
    qualityLevels: {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    },
  },
  status: {
    idle: 'Waiting',
    loading: 'Loading map data…',
    ready: 'Ready',
    placements: '{{count}} placements',
  },
  errors: {
    unavailable: 'Map data pack is missing or not shipped with the app',
    corrupt: 'Map data pack failed integrity verification and may be damaged',
    unknown: 'An unknown error occurred',
  },
};
