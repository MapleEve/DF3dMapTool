import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  polylineLength,
  useRouteStore,
  type RecordSession,
  type StoredCustomRoute,
} from "@/state/routeStore";
import { useUiStore } from "@/state/uiStore";
import type { Vec3 } from "@/common/geometry";

/**
 * 自录 UI：录制面板（300x550 右侧）+ 保存对话框（400x400）。
 *
 * 结构口径上游实测锚定：
 * - 「录制中」20px + 红点 30x30 #FF1717；
 * - 时间/标记点数量/路径点数量/距离 20px 行；「录制模式：」20px；
 * - 警告/操作提示 20px 红；「长按结束导航」12px；
 * - 保存对话框：标题 26px、输入框 390x48（placeholder 白@0.5）、
 *   保存/取消/取消(点2次) 20px 绿字。
 * 内容组件（RecordPanelView/RouteSaveDialog）为受控形态，SSR 冒烟与实装共用。
 */
export function RouteRecording() {
  const record = useRouteStore((state) => state.record);
  const [draft, setDraft] = useState<StoredCustomRoute | null>(null);
  // 计时只随会话起点走：interval 依赖 startedAt 而非 record 对象本身——
  // 采样每 200ms 产生新 record 对象（pushRecordSample），依赖对象会不断
  // 清理重建 interval，导致录制进行中读数冻结、静止后才跳变补齐。
  // 读数按会话键控（属当前会话才采用，新会话首拍前按 0 呈现）；
  // 渲染期不调 Date.now（react/purity），effect 内不同步 setState
  // （react/set-state-in-effect）。
  const startedAt = record?.startedAt ?? null;
  const [elapsedState, setElapsedState] = useState<{ startedAt: number; value: number } | null>(
    null,
  );
  const elapsed =
    startedAt !== null && elapsedState?.startedAt === startedAt ? elapsedState.value : 0;

  // 录制计时（面板读数随秒推进）。
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const handle = window.setInterval(() => {
      setElapsedState({ startedAt, value: (Date.now() - startedAt) / 1000 });
    }, 500);
    return () => window.clearInterval(handle);
  }, [startedAt]);

  if (record === null && draft === null) {
    return null;
  }
  if (draft !== null) {
    return <RouteSaveDialog draft={draft} onDone={() => setDraft(null)} />;
  }
  return (
    <RecordPanelView
      record={record}
      elapsed={elapsed}
      onStop={() => {
        const stopped = useRouteStore.getState().stopRecord();
        if (stopped !== null) {
          setDraft(stopped);
        }
      }}
    />
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** 当前相机注视点（标注落点；即时读取 HUD 节流读数）。 */
function cameraTargetNow(): Vec3 | null {
  const hud = useUiStore.getState().cameraHud;
  return hud === null ? null : hud.position;
}

export function RecordPanelView({
  record,
  elapsed,
  onStop,
}: {
  record: RecordSession | null;
  elapsed: number;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const addRecordMarker = useRouteStore((state) => state.addRecordMarker);
  const discardRecord = useRouteStore((state) => state.discardRecord);
  const [markerName, setMarkerName] = useState("");

  if (record === null) {
    return null;
  }
  const distance = polylineLength(record.points);
  const handleAddMarker = () => {
    const target = cameraTargetNow();
    if (markerName.trim() === "" || target === null) {
      return;
    }
    addRecordMarker(markerName, target);
    setMarkerName("");
  };

  return (
    <section className="route-record-panel" role="dialog" aria-label={t("route.recording.status")}>
      <div className="route-record-status">
        <span className="route-record-dot" aria-hidden="true" />
        <span className="route-record-status-text">{t("route.recording.status")}</span>
      </div>
      <div className="route-record-stats">
        <div className="route-record-row">
          {t("route.recording.time", { value: formatClock(elapsed) })}
        </div>
        <div className="route-record-row">
          {t("route.recording.markerCount", { value: String(record.markers.length) })}
        </div>
        <div className="route-record-row">
          {t("route.recording.pointCount", { value: String(record.points.length) })}
        </div>
        <div className="route-record-row">
          {t("route.recording.distance", { value: `${Math.round(distance)}m` })}
        </div>
      </div>
      <div className="route-record-mode">{t("route.recording.mode")}</div>
      <div className="route-record-input">
        <input
          type="text"
          value={markerName}
          placeholder={t("route.recording.markerPlaceholder")}
          onChange={(event) => setMarkerName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleAddMarker();
            }
          }}
        />
        <button type="button" className="route-record-add-marker" onClick={handleAddMarker}>
          {t("route.recording.addMarker")}
        </button>
      </div>
      <p className="route-record-warning">{t("route.recording.warning")}</p>
      <p className="route-record-hint">{t("route.recording.hint")}</p>
      <p className="route-record-stop-hint">{t("route.holdToEnd")}</p>
      <div className="route-record-actions">
        <button type="button" className="route-record-stop" onClick={onStop}>
          {t("route.recording.stop")}
        </button>
        <button type="button" className="route-record-cancel" onClick={discardRecord}>
          {t("route.saveDialog.cancel")}
        </button>
      </div>
    </section>
  );
}

export function RouteSaveDialog({
  draft,
  onDone,
}: {
  draft: StoredCustomRoute;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const saveCustomRoute = useRouteStore((state) => state.saveCustomRoute);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cancelArmed, setCancelArmed] = useState(false);

  const handleSave = () => {
    saveCustomRoute(name, description, draft);
    onDone();
  };
  // 取消按钮为「点 2 次」防误触：初始标注「取消(点2次)」，第一次点击进入待确认
  // （标签转「取消」），第二次点击才放弃保存。
  const handleCancel = () => {
    if (cancelArmed) {
      onDone();
    } else {
      setCancelArmed(true);
    }
  };

  return (
    <div className="route-save-backdrop">
      <section className="route-save-dialog" role="dialog" aria-label={t("route.saveDialog.title")}>
        <h3 className="route-save-title">{t("route.saveDialog.title")}</h3>
        <input
          type="text"
          className="route-save-input"
          value={name}
          placeholder={t("route.saveDialog.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          type="text"
          className="route-save-input"
          value={description}
          placeholder={t("route.saveDialog.descPlaceholder")}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="route-save-actions">
          <button type="button" className="route-save-button" onClick={handleSave}>
            {t("route.saveDialog.save")}
          </button>
          <button type="button" className="route-save-cancel" onClick={handleCancel}>
            {cancelArmed ? t("route.saveDialog.cancel") : t("route.saveDialog.cancelTwice")}
          </button>
        </div>
      </section>
    </div>
  );
}
