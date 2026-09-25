/**
 * 瓦片/叠加层位图加载（LRU 缓存 + 并发池 6 + 失败重试 1 次）。
 *
 * 缓存按数据包持有（Map<package, Map<path, HTMLImageElement>>）——切图即整体释放，
 * 不跨图复用（az3 换层为瞬时换源，同为瞬时，不做过渡）。
 *
 * object URL 的所有权在数据包（getObjectUrl 按包缓存、同一条目共享同一 URL）：
 * 画布解码与 DOM <img>（侧栏图标/详情面板）会拿到**同一 URL**，因此解码完成后
 * **不得 revoke**——否则后取方（或 LRU 淘汰后重解码方）拿到已失效 URL 报
 * ERR_FILE_NOT_FOUND。URL 随包生存（与 3D 侧 getIconObjectUrl 同一模式）。
 */

import { useEffect, useRef, useState } from "react";
import type { Sandbox2dPackage } from "./loadSandbox2d";

/** 单图并发池（引擎口径）。 */
const LOAD_CONCURRENCY = 6;
/** 重试次数（引擎口径：失败重试 1 次）。 */
const RETRY_COUNT = 1;
/** 每包位图 LRU 上限（z3 全图 84 张 + 叠加 + 换层余量）。 */
const LRU_LIMIT = 192;

const imageCaches = new WeakMap<Sandbox2dPackage, Map<string, Promise<HTMLImageElement | null>>>();

function cacheFor(pkg: Sandbox2dPackage): Map<string, Promise<HTMLImageElement | null>> {
  let cache = imageCaches.get(pkg);
  if (cache === undefined) {
    cache = new Map();
    imageCaches.set(pkg, cache);
  }
  return cache;
}

function loadImage(pkg: Sandbox2dPackage, file: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = pkg.getObjectUrl(file);
    if (url === undefined) {
      resolve(null);
      return;
    }
    const image = new Image();
    // URL 为包级共享缓存（见头注释），解码后不 revoke。
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => resolve(null));
    image.src = url;
  });
}

/** 读取一张位图（带缓存；不存在的条目解析为 null 占位）。 */
export function loadSandboxImage(
  pkg: Sandbox2dPackage,
  file: string,
): Promise<HTMLImageElement | null> {
  const cache = cacheFor(pkg);
  const hit = cache.get(file);
  if (hit !== undefined) {
    // LRU 触碰
    cache.delete(file);
    cache.set(file, hit);
    return hit;
  }
  const pending = (async () => {
    let last: HTMLImageElement | null = null;
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
      last = await loadImage(pkg, file);
      if (last !== null) {
        return last;
      }
    }
    return last;
  })();
  cache.set(file, pending);
  // LRU 淘汰
  if (cache.size > LRU_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  return pending;
}

/**
 * 给定清单按并发池加载；全部就绪（或失败置空）后触发重绘。
 * 返回当前已就绪的位图表（path → image），加载中先渲染已就绪部分（瓦片渐进上屏）。
 */
export function useSandboxImages(
  pkg: Sandbox2dPackage | null,
  files: readonly string[],
): ReadonlyMap<string, HTMLImageElement> {
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map());
  const versionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const collected = new Map<string, HTMLImageElement>();
    const flush = () => {
      if (!cancelled && collected.size > 0) {
        setImages(new Map(collected));
      }
    };
    (async () => {
      // 异步边界后更新状态（effect 体内不同步 setState）
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      if (pkg === null || files.length === 0) {
        setImages(new Map());
        return;
      }
      const version = versionRef.current + 1;
      versionRef.current = version;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(LOAD_CONCURRENCY, files.length) }, async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= files.length || cancelled) {
            return;
          }
          const file = files[index];
          const image = await loadSandboxImage(pkg, file);
          if (cancelled) {
            return;
          }
          if (image !== null) {
            collected.set(file, image);
            flush();
          }
        }
      });
      await Promise.all(workers);
      if (!cancelled) {
        setImages(new Map(collected));
      }
    })();
    return () => {
      cancelled = true;
    };
    // files 身份由调用方 memo 化（tilesForViewport 结果）
  }, [pkg, files]);

  return images;
}
