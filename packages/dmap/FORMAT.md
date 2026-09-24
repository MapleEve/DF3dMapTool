# DMAP 容器格式规范

DMAP 是 DF3dMapTool 的内置地图数据包格式：一个 `.dmap` 文件自包含一张地图所需的
GLB 几何、贴图与 JSON 配置，并整体以 AES-256-GCM 加密与完整性保护。
本包提供该格式的 Node 侧写入器（`DmapWriter`）与浏览器/Node 通用加载器（`DmapLoader`），
两端共用同一份规范实现，保证写入的文件可被应用原样加载。

## 1. 容器布局

```
偏移   长度   字段
0      4      magic      ASCII "DMAP"（0x44 0x4D 0x41 0x50）
4      4      version    u32 LE，当前为 1
8      4      flags      u32 LE，特性位段，保留，当前恒为 0
12     12     iv         AES-GCM 随机向量（每次写入随机生成）
24     N      payload    AES-256-GCM 密文 + 16 字节认证标签（标签追加在密文尾部）
```

- 加密算法：AES-256-GCM，认证标签 128 bit。
- additionalData = 完整 24 字节容器头。头中任何字节（含 version/flags/iv）被篡改，
  载荷校验都会失败，因此头本身无需单独校验和。
- 密文长度 = 明文长度 + 16 字节标签；文件总长 = 24 + 密文长度。

## 2. 载荷：GLB 容器 + dmapc 索引

明文载荷是一个符合 GLB 规范的二进制容器：

```
12B   GLB 头：magic "glTF" + version 2 + totalLength
JSON chunk（type "JSON"，空格补齐到 4 字节对齐）
BIN  chunk（type "BIN\0"，0x00 补齐到 4 字节对齐）
```

JSON chunk 即 **dmapc 索引**：

```json
{
  "asset": { "version": "2.0", "generator": "dmap-writer/1" },
  "dmapc": {
    "entries": [
      { "name": "manifest.json", "mime": "application/json", "byteOffset": 0, "byteLength": 512 }
    ]
  }
}
```

- `byteOffset` 相对 BIN chunk 数据起点。
- `name` 在容器内唯一；`mime` 为条目的 IANA 类型（GLB、PNG、JSON 等）。
- BIN chunk 内按索引顺序连续存放条目原始字节，不做二次加密（外层已整体加密）。

## 3. 密钥派生

AES-256 密钥不由明文形式存放，而是拆成 4 段密钥材料分发：

```
输入：segments[0..3]（各 8 字节）、tables[0..3]（各 8 字节常量表）
1. mixed[i] = segments[i] XOR tables[i]          （逐字节）
2. material = mixed[0] ‖ mixed[1] ‖ mixed[2] ‖ mixed[3]   （32 字节）
3. aesKey   = SHA-256(material)                  （32 字节，导入为不可导出的 CryptoKey）
```

- 派生过程无随机性：相同材料永远派生相同密钥。
- 段与常量表由宿主应用以内置模块形式提供（`apps/web/src/engine/dmapKey.ts`），
  本包不内置任何密钥；写入器与加载器接受 `DmapKeyMaterial` 或已派生的 `CryptoKey`。
- 保护等级：容器提供可靠的防篡改保护（GCM 认证标签 + AAD 绑定容器头）与
  威慑级防提取——密钥材料随客户端分发，可阻止一般性提取手段，
  不针对蓄意的密钥还原分析，请勿将该容器用于对抗性机密保护场景。

## 4. 读取流程（`DmapLoader.open`）

1. 长度检查：至少 `24 + 16` 字节。
2. 解析容器头：magic、version（不支持即报错）。
3. 派生 AES-256 密钥。
4. AES-GCM 校验并还原载荷（头字节作为 additionalData 一并校验）。
5. 解析 GLB：JSON chunk 还原 dmapc 索引，BIN chunk 为数据区。
6. 之后 `read` / `readText` / `readJson` 按名称取条目，`list` 枚举条目。

任何一步失败抛出带稳定错误码的 `DmapError` 子类：
`bad_header` / `unsupported_version` / `truncated` / `bad_bundle` / `bad_key_material` /
`integrity_check_failed` / `entry_not_found`。

## 5. 版本策略

- `version` 字段单调递增；加载器只接受自己支持的版本集合（当前为 1）。
- `flags` 位段用于向后兼容的可选特性，未识别位应忽略。
