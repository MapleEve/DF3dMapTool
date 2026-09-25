import { buildNavmeshData, type NavmeshData } from "./navmeshData";

/**
 * 导航网格构建 Worker：接收文档 base64 载荷（字符串投递），解码 →
 * buildNavmeshData 重计算 → 产物 TypedArray 以 transferable 回传。
 *
 * 协议（seq 配对请求与响应）：
 * - 请求 { type: "build", seq, vertexData, polygonData }
 * - 响应 { type: "built", seq, data }（buffers 已转移）| { type: "error", seq, message }
 */

export interface NavmeshWorkerRequest {
  readonly type: "build";
  readonly seq: number;
  readonly vertexData: string;
  readonly polygonData: string;
}

export type NavmeshWorkerResponse =
  | { readonly type: "built"; readonly seq: number; readonly data: NavmeshData }
  | { readonly type: "error"; readonly seq: number; readonly message: string };

function decodeBase64Bytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function transferListOf(data: NavmeshData): ArrayBuffer[] {
  return [
    data.vertices.buffer as ArrayBuffer,
    data.triVerts.buffer as ArrayBuffer,
    data.centroids.buffer as ArrayBuffer,
    data.neighborsOffset.buffer as ArrayBuffer,
    data.neighbors.buffer as ArrayBuffer,
    data.cellKeys.buffer as ArrayBuffer,
    data.cellBucketOffset.buffer as ArrayBuffer,
    data.cellBuckets.buffer as ArrayBuffer,
  ];
}

function handleMessage(event: MessageEvent<NavmeshWorkerRequest>): void {
  const request = event.data;
  if (request?.type !== "build") {
    return;
  }
  try {
    const vertexBytes = decodeBase64Bytes(request.vertexData);
    const polygonBytes = decodeBase64Bytes(request.polygonData);
    const vertices = new Float32Array(
      vertexBytes.buffer,
      vertexBytes.byteOffset,
      vertexBytes.byteLength / 4,
    );
    const indices = new Uint32Array(
      polygonBytes.buffer,
      polygonBytes.byteOffset,
      polygonBytes.byteLength / 4,
    );
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] >= vertices.length / 3) {
        throw new RangeError(`导航数据顶点索引越界: ${indices[i]}`);
      }
    }
    const data = buildNavmeshData(vertices, indices);
    const response: NavmeshWorkerResponse = { type: "built", seq: request.seq, data };
    // Worker 上下文的 postMessage(message, {transfer}) 无 targetOrigin 语义（窗口专有参数）。
    // oxlint-disable-next-line require-post-message-target-origin
    self.postMessage(response, { transfer: transferListOf(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: NavmeshWorkerResponse = { type: "error", seq: request.seq, message };
    // oxlint-disable-next-line require-post-message-target-origin
    self.postMessage(response);
  }
}

self.addEventListener("message", handleMessage as (event: MessageEvent) => void);
