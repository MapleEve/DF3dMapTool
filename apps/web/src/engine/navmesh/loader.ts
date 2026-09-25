import { openMapBundle } from "../assets";
import {
  NAVMESH_FORMAT,
  NavMesh,
  buildNavmeshData,
  navMeshFromDoc,
  type NavmeshDoc,
} from "./navmesh";
import type { NavmeshData } from "./navmeshData";
import type { NavmeshWorkerRequest, NavmeshWorkerResponse } from "./navmeshWorker";

/** 加密导航容器内的数据条目名。 */
export const NAVMESH_ENTRY = "navmesh.json";

/** Worker 构建失败回落主线程时在控制台如实标注。 */
export const NAVMESH_WORKER_FALLBACK_LOG = "[navmesh] Worker 构建不可用，回落主线程构建";

/**
 * 打开一张地图的加密导航数据容器并解析为可寻路 NavMesh。
 *
 * 构建移入 Web Worker（纯计算，无 OffscreenCanvas 依赖）：主线程只做
 * 容器下载/解密，邻接表/网格索引等重计算在 Worker 完成，产物 TypedArray
 * 零拷贝回传——主线程 0 阻塞（大图如潮汐监狱 64 万三角形不再冻结 UI）。
 * Worker 不可用（环境不支持/内部失败）时回落主线程同步构建，
 * console.warn 如实标注；两条路径构建结果一致（见 navmesh 测试）。
 *
 * 数据包未随应用分发（HTTP 404）返回 null；格式/校验错误向上抛出。
 */
export async function openNavMesh(url: string): Promise<NavMesh | null> {
  const loader = await openMapBundle(url);
  if (!loader.has(NAVMESH_ENTRY)) {
    return null;
  }
  const doc = loader.readJson<NavmeshDoc>(NAVMESH_ENTRY);
  if (doc.format !== NAVMESH_FORMAT) {
    throw new RangeError(`导航数据 format 应为 ${NAVMESH_FORMAT}`);
  }
  try {
    const data = await buildInWorker(doc);
    if (data.triangleCount === 0) {
      return null;
    }
    return new NavMesh(data);
  } catch (error) {
    if (error instanceof RangeError) {
      throw error;
    }
    // Worker 不可用/内部失败：主线程同步构建（结果一致），控制台如实标注。
    console.warn(NAVMESH_WORKER_FALLBACK_LOG, error);
    return navMeshFromDoc(doc);
  }
}

/** Worker 单例（按需创建；环境不支持或出错后置坏，后续走主线程）。 */
let workerInstance: Worker | null = null;
let workerBroken = false;
let requestSeq = 0;
const pending = new Map<
  number,
  { resolve: (data: NavmeshData) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken) {
    return null;
  }
  if (workerInstance !== null) {
    return workerInstance;
  }
  try {
    const worker = new Worker(new URL("./navmeshWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<NavmeshWorkerResponse>) => {
      const response = event.data;
      if (response === null || typeof response !== "object") {
        return;
      }
      const waiter = pending.get(response.seq);
      if (waiter === undefined) {
        return;
      }
      pending.delete(response.seq);
      if (response.type === "built") {
        waiter.resolve(response.data);
      } else {
        waiter.reject(new Error(response.message));
      }
    });
    worker.addEventListener("error", () => {
      markWorkerBroken();
    });
    workerInstance = worker;
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function markWorkerBroken(): void {
  workerBroken = true;
  for (const [, waiter] of pending) {
    waiter.reject(new Error("navmesh worker error"));
  }
  pending.clear();
  workerInstance?.terminate();
  workerInstance = null;
}

function buildInWorker(doc: NavmeshDoc): Promise<NavmeshData> {
  const worker = getWorker();
  if (worker === null) {
    return Promise.reject(new Error("navmesh worker unavailable"));
  }
  requestSeq += 1;
  const seq = requestSeq;
  return new Promise<NavmeshData>((resolve, reject) => {
    pending.set(seq, { resolve, reject });
    const request: NavmeshWorkerRequest = {
      type: "build",
      seq,
      vertexData: doc.vertexData,
      polygonData: doc.polygonData,
    };
    // Worker postMessage 无 targetOrigin 语义（窗口专有参数）。
    // oxlint-disable-next-line require-post-message-target-origin
    worker.postMessage(request);
  });
}

export { buildNavmeshData };
