import { useTranslation } from "react-i18next";
import type { Vec3 } from "@/common/geometry";
import { useNavStore } from "@/state/navStore";

/** 路径小视图尺寸（px），北朝上，世界 XZ 等比缩放。 */
const VIEW_SIZE = 120;

/**
 * 寻路 HUD：加载/不可用/无解状态提示 + 就绪时显示路径长度与俯视小视图。
 * 悬浮于视口右上；关闭按钮清空当前路径。
 */
export function NavPathHud() {
  const { t } = useTranslation();
  const status = useNavStore((state) => state.status);
  const targetLabel = useNavStore((state) => state.targetLabel);
  const path = useNavStore((state) => state.path);
  const distance = useNavStore((state) => state.distance);
  const clear = useNavStore((state) => state.clear);

  if (status === "idle") {
    return null;
  }

  return (
    <aside className="nav-path-hud" role="status">
      <header className="nav-path-hud-header">
        <strong>{t("nav.title")}</strong>
        <button type="button" onClick={clear} aria-label={t("nav.close")}>
          ×
        </button>
      </header>
      {status === "loading" ? <p>{t("nav.loading")}</p> : null}
      {status === "unavailable" ? <p>{t("nav.unavailable")}</p> : null}
      {status === "unreachable" ? (
        <p>{t("nav.unreachable", { target: targetLabel ?? "" })}</p>
      ) : null}
      {status === "ready" && path !== null && distance !== null ? (
        <>
          <p className="nav-path-hud-target">{t("nav.toTarget", { target: targetLabel ?? "" })}</p>
          <p className="nav-path-hud-distance">
            {t("nav.distance", { distance: Math.round(distance) })}
          </p>
          <MiniPathView path={path} />
        </>
      ) : null}
    </aside>
  );
}

/** 俯视小视图：世界 XZ 归一化到固定方框，北（-Z）朝上。 */
function MiniPathView({ path }: { path: readonly Vec3[] }) {
  if (path.length === 0) {
    return null;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const scale = (VIEW_SIZE - 16) / span;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const points = path
    .map(
      (p) =>
        `${((p.x - cx) * scale + VIEW_SIZE / 2).toFixed(1)},${((p.z - cz) * scale + VIEW_SIZE / 2).toFixed(1)}`,
    )
    .join(" ");
  const last = path[path.length - 1];
  return (
    <svg
      className="nav-path-miniview"
      width={VIEW_SIZE}
      height={VIEW_SIZE}
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="#36d399"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <circle
        cx={(path[0].x - cx) * scale + VIEW_SIZE / 2}
        cy={(path[0].z - cz) * scale + VIEW_SIZE / 2}
        r={3}
        fill="#8fd7ff"
      />
      <circle
        cx={(last.x - cx) * scale + VIEW_SIZE / 2}
        cy={(last.z - cz) * scale + VIEW_SIZE / 2}
        r={3}
        fill="#ffc65c"
      />
    </svg>
  );
}
