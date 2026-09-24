export {
  DmapError,
  DmapEntryError,
  DmapFormatError,
  DmapIntegrityError,
  DmapKeyError,
} from './errors.js';
export type { DmapKeyMaterial, DmapKeySource } from './key.js';
export {
  deriveKey,
  deriveRawKeyBytes,
  isDmapKeyMaterial,
  resolveAesKey,
  KEY_BYTES,
  SEGMENT_BYTES,
  SEGMENT_COUNT,
} from './key.js';
export type { DmapHeader } from './container.js';
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
} from './container.js';
export type { BundleEntry, DmapcIndex, DmapcIndexEntry, UnpackedBundle } from './bundle.js';
export { DMAPC_GENERATOR, packBundle, readEntryData, unpackBundle } from './bundle.js';
export type { DmapWriteOptions } from './writer.js';
export { DmapWriter } from './writer.js';
export type { DmapEntryInfo } from './loader.js';
export { DmapLoader } from './loader.js';
