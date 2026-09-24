<sub>🌐 <b>简体中文</b> · <a href="README.en.md">English</a></sub>

<div align="center">

# DF3dMapTool 🗺️

> _「为《三角洲行动》玩家打造的开源 3D 战术地图查看器——6 张可切换地图、POI 标注检索、2D 俯视覆盖层。」_

<a href="https://github.com/MapleEve/DF3dMapTool/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/MapleEve/DF3dMapTool/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI" /></a>
<img src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node ≥ 22" />
<img src="https://img.shields.io/badge/pnpm-workspace-F9AD00?style=flat-square&logo=pnpm&logoColor=black" alt="pnpm workspace" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/three.js-latest-049EF4?style=flat-square&logo=threedotjs&logoColor=white" alt="three.js" />

<br>

[快速开始](#快速开始) · [功能特性](#功能特性) · [架构](#架构) · [地图数据包](#地图数据包) · [路线图](#路线图)

</div>

---

## 项目简介

DF3dMapTool 是面向《三角洲行动》玩家的开源 3D 战术地图查看器。
它以浏览器为运行环境、three.js 为渲染引擎，**内置地图数据包**开箱即用：

- **6 张可切换地图**：零号大坝、长弓溪谷、巴克什、潮汐监狱、AZ3、航天基地
  （数据包随仓逐步提供，当前为 AZ3）；
- **POI 标注与检索**：按分类筛选、按楼层归属、按名称模糊搜索；
- **2D 俯视覆盖层**：官方烘焙底图 + 线性投影，与 3D 场景共享同一世界坐标系；
- **中英双语界面**：中文默认，一键切换 English。

---

## 功能特性

| 功能                     | 说明                                                    | 状态  |
| ------------------------ | ------------------------------------------------------- | ----- |
| DMAP 加密数据包          | AES-256-GCM 加密 + 完整性校验（防篡改、威慑级防提取）   | ✅    |
| 3D 场景骨架              | three.js 场景管理器、图层生命周期、渲染循环             | ✅    |
| 地图注册表               | MapId ↔ 资产代号 ↔ 显示名，楼层标定                     | ✅    |
| 坐标变换                 | 欧拉角（Y-X-Z）→ 四元数 → 坐标系镜像，全数据统一        | ✅    |
| 2D 投影                  | 世界 ↔ 底图像素双向映射、区域显示坐标                   | ✅    |
| 双语界面                 | 中文 / English 全量文案                                 | ✅    |
| 3D 场景与轨道相机        | 数据包 → 场景图层 → 轨道相机浏览、楼层显隐、定位飞行    | ✅    |
| POI 层                   | 图标渲染、悬浮提示、详情面板、类型筛选与检索            | ✅    |
| 2D 俯视覆盖层            | 底图绘制、楼层切换、标记放置、缩放、区域标注            | ✅    |
| 2D 标记传送与 HUD 小地图 | 2D 标记 → 3D 定位传送、HUD 小地图                       | 🚧 M2 |
| 相机设置项               | FOV / 灵敏度 / 回出生点设置界面                         | 🚧 M2 |
| 多图切换                 | 6 图互切、模式选择                                      | 🚧 M3 |
| 打磨                     | 移动端适配、性能（合批/LOD/渲染距离）、加载体验         | 🚧 M4 |

---

## 快速开始

环境要求：Node.js ≥ 22、pnpm ≥ 10。

```bash
git clone https://github.com/MapleEve/DF3dMapTool.git
cd DF3dMapTool
pnpm install
pnpm dev
```

浏览器打开 <http://localhost:5173> 即可。

常用命令：

| 命令             | 说明                                     |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | 启动开发服务器                           |
| `pnpm build`     | 全 workspace 构建（类型检查 + 产物输出） |
| `pnpm test`      | 运行全部单元测试（vitest）               |
| `pnpm lint`      | ESLint 检查                              |
| `pnpm typecheck` | TypeScript 严格类型检查                  |
| `pnpm format`    | Prettier 格式化                          |

---

## 架构

pnpm monorepo，两个包：

```
DF3dMapTool/
├── apps/web                 React 19 + Vite + three.js 应用
│   └── src/
│       ├── engine/          three.js 场景管理器、DMAP 加载接线、内置密钥
│       ├── map/             地图注册表、坐标变换（Y-X-Z 欧拉 → 四元数 → 镜像）
│       ├── poi/             POI 模型、分类、筛选与检索
│       ├── bigmap/          2D 俯视投影（世界 ↔ 像素）
│       ├── data/            数据包加载与 manifest 校验
│       ├── state/           Zustand 状态（地图/楼层/POI 筛选/搜索/UI 显隐）
│       ├── i18n/            中文/English 文案
│       └── ui/              界面组件
└── packages/dmap            DMAP 容器格式
    ├── src/writer.ts        Node 侧写入器（资产管线使用）
    ├── src/loader.ts        浏览器/Node 通用加载器（open / read 接口）
    └── FORMAT.md            容器格式规范
```

数据流：

```
DMAP 数据包（apps/web/public/assets/*.dmap）
  → DmapLoader（AES-256-GCM 校验 → GLB 载荷 → dmapc 索引）
    → manifest（地图/楼层/条目）
      → three.js 3D 视图（几何 + 摆放实例化）
      → 2D 俯视覆盖层（烘焙底图 + 线性投影，共享世界坐标）
```

---

## 地图数据包

应用使用自有加密容器格式 **DMAP** 分发内置地图数据包：

- 容器：`DMAP` magic + version + flags + 12 字节 IV + AES-256-GCM 密文（GLB 几何、
  贴图与 JSON 配置打包为一个 GLB 载荷，配 dmapc 索引）；
- 完整性：认证标签覆盖全部载荷，容器头（含 version/flags/IV）作为
  additionalData 一并绑定，任何字节被篡改都会加载失败；
- 密钥：32 字节密钥材料拆成 4 段与常量表异或、拼接后经 SHA-256 派生，
  以内置模块形式随应用分发，本仓库不出现明文密钥；
- 保护等级：容器防篡改（GCM 认证标签 + AAD 绑定容器头）真实有效；
  密钥材料随客户端分发，防提取为威慑级设计——用于阻止一般性提取手段，
  不针对蓄意的密钥还原分析；
- 详细字节布局与读取流程见 [packages/dmap/FORMAT.md](packages/dmap/FORMAT.md)。

数据包随仓库一同分发，位于 `apps/web/public/assets/`，克隆后开箱即用。
当前随仓提供 AZ3（零号大坝扩建）数据包，其余地图将随后续批次加入。

---

## 路线图

- **M1 单图核心**：AZ3 静态场景全量加载与漫游、POI 图标层、楼层显隐、地面底图对位
- **M2 全交互**：第一人称控制器、POI 检索/详情/传送、2D 俯视全家桶、导航路线
- **M3 多图**：6 图互切、模式选择、区域标注层
- **M4 打磨**：移动端、性能（合批/LOD/渲染距离）、加载体验、双语收尾

---

## 免责声明

本项目是面向玩家的第三方工具，与游戏官方无关。地图数据仅供在本程序内查看使用。

---

Copyright © 2026 Maple (MapleEve). All rights reserved.
未经许可，禁止复制、再分发与本程序之外的资产提取。
