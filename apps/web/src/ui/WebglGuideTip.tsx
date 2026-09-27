import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * WebGL 引导提示（#65）。
 *
 * 平台/客户端条件的引导面板：浏览器无法创建 WebGL 上下文时出现，
 * 说明 3D 视图不可用并引导换用支持 WebGL 的现代浏览器（2D 沙盘不受影响）。
 * 出现条件 = WebGL 支持探测失败（无 WebGL / 上下文创建异常）；
 * 面板为顶部条位警示（不遮操作，可切 2D 沙盘继续使用），点「知道了」
 * 关闭后本会话不再出现。无 WebGL 时启动流程会落到错误态（boot 屏解除），
 * 引导随后常驻直至关闭。
 */

/** WebGL 支持探测结果（进程内缓存；探测一次即可）。 */
let cachedSupport: boolean | null = null;

/**
 * 探测当前浏览器能否创建 WebGL 上下文：
 * webgl2 → webgl → experimental-webgl 逐级尝试；任一命中即视为可用。
 * SSR/测试环境无 canvas 时按可用处理（探测语义只关心真实浏览器降级）。
 */
export function webglSupported(): boolean {
  if (cachedSupport !== null) {
    return cachedSupport;
  }
  if (typeof document === "undefined") {
    return true;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    cachedSupport = gl !== null;
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/** 测试辅助：重置探测缓存。 */
export function resetWebglSupportCache(): void {
  cachedSupport = null;
}

export function WebglGuideTip() {
  const { t } = useTranslation();
  // 首渲染直接派生探测结果（进程内缓存；SSR/测试按可用），无需 effect 补拍。
  const [unsupported] = useState(() => !webglSupported());
  const [dismissed, setDismissed] = useState(false);

  if (!unsupported || dismissed) {
    return null;
  }

  return (
    <div className="webgl-guide" role="alertdialog" aria-label={t("webglGuide.title")}>
      <h2 className="webgl-guide-title">{t("webglGuide.title")}</h2>
      <p className="webgl-guide-body">{t("webglGuide.body")}</p>
      <button
        type="button"
        className="webgl-guide-dismiss"
        onClick={() => {
          setDismissed(true);
        }}
      >
        {t("webglGuide.dismiss")}
      </button>
    </div>
  );
}
