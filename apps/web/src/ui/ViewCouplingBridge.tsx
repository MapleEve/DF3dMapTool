import { useEffect } from "react";
import { applySandboxGroupsToPoiFilter, useViewCoupling } from "@/state/viewCoupling";

/**
 * 双视图耦合桥（不渲染任何内容，随 App 常驻）：
 * 消费 2D 侧发起的组级筛选变化（viewCoupling.lastSource === "sandbox"），
 * 经粗类映射写入 3D 侧 poiFilterStore（只动 extract/supply/spawn 三个粗类）。
 *
 * 反方向（3D→2D）不经全局订阅：3D 侧栏的勾选处理器在变更后显式调用
 * viewCoupling.syncFromPoiFilter，2D 侧自行订阅 groupVisible 应用——
 * 双向都只在用户动作处发起，天然无回环。
 */
export function ViewCouplingBridge() {
  useEffect(() => {
    return useViewCoupling.subscribe((state, prev) => {
      if (state.lastSource !== "sandbox" || state.groupVisible === prev.groupVisible) {
        return;
      }
      applySandboxGroupsToPoiFilter(state.groupVisible);
    });
  }, []);
  return null;
}
