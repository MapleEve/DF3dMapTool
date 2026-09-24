export {
  DmapError,
  DmapEntryError,
  DmapFormatError,
  DmapIntegrityError,
  DmapKeyError,
} from "./errors.js";
export type { DmapKeyMaterial, DmapKeySource } from "./key.js";
export {
  deriveKey,
  deriveRawKeyBytes,
  isDmapKeyMaterial,
  resolveAesKey,
  KEY_BYTES,
  SEGMENT_BYTES,
  SEGMENT_COUNT,
} from "./key.js";
export type { DmapHeader } from "./container.js";
export {
  decodeHeader,
  encodeHeader,
  FORMAT_VERSION,
  HEADER_BYTES,
  IV_BYTES,
  MAGIC_BYTES,
  randomIv,
  sealPayload,
  TAG_BYTES,
  unsealPayload,
} from "./container.js";
export type { BundleEntry, DmapcIndex, DmapcIndexEntry, UnpackedBundle } from "./bundle.js";
export { DMAPC_GENERATOR, packBundle, readEntryData, unpackBundle } from "./bundle.js";
export type { DmapWriteOptions } from "./writer.js";
export { DmapWriter } from "./writer.js";
export type { DmapEntryInfo } from "./loader.js";
export { DmapLoader } from "./loader.js";
export type {
  DmapChunkRef,
  DmapMapCounts,
  DmapMapManifest,
  DmapMapManifestEntries,
} from "./manifest.js";
export {
  CHUNK_ENTRY_NAME,
  MAP_MANIFEST_ENTRY,
  MAP_MANIFEST_FORMAT,
  parseMapManifest,
} from "./manifest.js";
export type { DmapMapPackageOptions } from "./shard.js";
export { DmapMapPackage } from "./shard.js";
export type { TaskPoolOptions } from "./pool.js";
export { TaskCancelledError, TaskPool } from "./pool.js";
export { StreamProgressAggregator } from "./progress.js";
