/**
 * DMAP 统一错误类型。
 *
 * 所有错误都携带稳定的 `code` 字符串，调用方可据此分支处理而无需解析错误文案。
 */

export class DmapError extends Error {
  /** 稳定错误码，例如 `bad_header`、`integrity_check_failed`。 */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DmapError";
    this.code = code;
  }
}

/** 容器头不合法：magic 错误、版本不支持、长度截断、字段越界、清单不合法。 */
export class DmapFormatError extends DmapError {
  constructor(
    code: "bad_header" | "unsupported_version" | "truncated" | "bad_bundle" | "bad_manifest",
    message: string,
  ) {
    super(code, message);
    this.name = "DmapFormatError";
  }
}

/** 密钥材料不合法：段数/段长不符。 */
export class DmapKeyError extends DmapError {
  constructor(message: string) {
    super("bad_key_material", message);
    this.name = "DmapKeyError";
  }
}

/** 载荷完整性校验失败：数据被篡改或密钥不匹配。 */
export class DmapIntegrityError extends DmapError {
  constructor(message: string) {
    super("integrity_check_failed", message);
    this.name = "DmapIntegrityError";
  }
}

/** 请求的条目在数据包中不存在。 */
export class DmapEntryError extends DmapError {
  readonly entryName: string;

  constructor(entryName: string) {
    super("entry_not_found", `条目不存在: ${entryName}`);
    this.name = "DmapEntryError";
    this.entryName = entryName;
  }
}
