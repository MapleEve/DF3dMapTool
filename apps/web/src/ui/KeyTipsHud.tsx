import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHomeStore } from "./homeStore";
import { useUiStore } from "@/state/uiStore";
import { useViewStore } from "@/state/viewStore";

/**
 * 操作说明面板（#55 显隐桥）。
 *
 * 结构口径对齐上游 HUD 实测：面板 content 240x245.5、行 240x30
 * （键名 14px 白 + 说明 14px 白）、标题「操作说明」16px、
 * Tab 折叠钮 显示/隐藏操作说明 12px 白@0.698、边 #585758、行底 #0A0F11。
 * 键位行只列本应用真实存在的控制（轨道相机拖拽/右键/滚轮 + M/Esc/Tab）；
 * Q/F/R 等键位行随对应功能落地时在 ROWS 追加。
 */
export function KeyTipsHud() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const view = useViewStore((state) => state.view);
  const homeOpen = useHomeStore((state) => state.homeOpen);

  // Tab 键显隐（输入控件聚焦时不劫持）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      // 仅 3D 视图生效（2D 沙盘有自己的 Tab 焦点语义）。
      if (useViewStore.getState().view !== "3d") {
        return;
      }
      if (useHomeStore.getState().homeOpen || useUiStore.getState().bigmapOpen) {
        return;
      }
      event.preventDefault();
      setExpanded((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (view !== "3d" || homeOpen) {
    return null;
  }

  const rows: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
    { key: t("keytips.keyDrag"), label: t("keytips.rotate") },
    { key: t("keytips.keyRightDrag"), label: t("keytips.pan") },
    { key: t("keytips.keyWheel"), label: t("keytips.zoom") },
    { key: t("keytips.keyM"), label: t("keytips.bigmap") },
    { key: t("keytips.keyEsc"), label: t("keytips.settings") },
    { key: t("keytips.keyTab"), label: expanded ? t("keytips.hide") : t("keytips.show") },
  ];

  if (!expanded) {
    return (
      <button
        type="button"
        className="keytips-collapsed"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
      >
        {t("keytips.show")}
      </button>
    );
  }

  return (
    <section className="keytips" aria-label={t("keytips.title")}>
      <h2 className="keytips-title">{t("keytips.title")}</h2>
      <ul className="keytips-rows">
        {rows.map((row) => (
          <li key={row.key} className="keytips-row">
            <span className="keytips-key">{row.key}</span>
            <span className="keytips-desc">{row.label}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="keytips-toggle"
        onClick={() => setExpanded(false)}
        aria-expanded
      >
        {t("keytips.hide")}
      </button>
    </section>
  );
}
