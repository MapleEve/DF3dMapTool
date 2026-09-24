/**
 * WebCrypto 边界适配。
 *
 * DOM 类型里 BufferSource 只接受 ArrayBuffer 支撑的视图（Uint8Array<ArrayBuffer>），
 * 而本包对外签名使用宽松的 Uint8Array（ArrayBufferLike）以方便调用方传入各类视图。
 * 在零拷贝可行（整段 ArrayBuffer 的完整视图）时直接复用，否则做一次边界拷贝。
 */
export type CryptoBytes = Uint8Array<ArrayBuffer>;

export function toCryptoBytes(bytes: Uint8Array): CryptoBytes {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes as CryptoBytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
