import { openMapBundle } from "../assets";
import { navMeshFromDoc, type NavMesh, type NavmeshDoc } from "./navmesh";

/** 加密导航容器内的数据条目名。 */
export const NAVMESH_ENTRY = "navmesh.json";

/**
 * 打开一张地图的加密导航数据容器并解析为可寻路 NavMesh。
 * 数据包未随应用分发（HTTP 404）返回 null；格式/校验错误向上抛出。
 */
export async function openNavMesh(url: string): Promise<NavMesh | null> {
  const loader = await openMapBundle(url);
  if (!loader.has(NAVMESH_ENTRY)) {
    return null;
  }
  const doc = loader.readJson<NavmeshDoc>(NAVMESH_ENTRY);
  return navMeshFromDoc(doc);
}
