import { describe, expect, it } from 'vitest';
import {
  decodeHeader,
  encodeHeader,
  FORMAT_VERSION,
  DmapLoader,
  DmapWriter,
  DmapEntryError,
  DmapFormatError,
  DmapIntegrityError,
  HEADER_BYTES,
  type DmapKeyMaterial,
} from '../src/index.js';
import { deriveRawKeyBytes } from '../src/index.js';
import { hexBytes, toHex } from './helpers.js';

const TEST_MATERIAL: DmapKeyMaterial = {
  segments: ['0001020304050607', '08090a0b0c0d0e0f', 'f0f1f2f3f4f5f6f7', 'e0e1e2e3e4e5e6e7'].map(
    hexBytes,
  ),
  tables: ['0f0e0d0c0b0a0908', 'f1f0f1f0f1f0f1f0', '123456789abcdef0', 'deadbeefcafebabe'].map(
    hexBytes,
  ),
};

const OTHER_MATERIAL: DmapKeyMaterial = {
  segments: ['1111111111111111', '2222222222222222', '3333333333333333', '4444444444444444'].map(
    hexBytes,
  ),
  tables: TEST_MATERIAL.tables,
};

const FIXED_IV = hexBytes('0a0b0c0d0e0f101112131415');

async function writeSampleContainer(
  material: DmapKeyMaterial = TEST_MATERIAL,
): Promise<Uint8Array> {
  return DmapWriter.create()
    .addJson('manifest.json', { mapId: 101, entries: 3 })
    .addText('notes.txt', '内置地图数据包')
    .add('meshes/sample.glb', 'model/gltf-binary', hexBytes('46546c6702000100'))
    .write(material, { iv: FIXED_IV });
}

describe('容器写入 → 加载往返', () => {
  it('roundtrip 保留全部条目与元信息', async () => {
    const container = await writeSampleContainer();
    const loader = await DmapLoader.open(container, TEST_MATERIAL);

    expect(loader.formatVersion).toBe(1);
    expect(loader.flags).toBe(0);
    expect(loader.entryCount).toBe(3);
    expect(loader.has('manifest.json')).toBe(true);
    expect(loader.has('nope.json')).toBe(false);
    expect(loader.readJson<{ mapId: number }>('manifest.json')).toEqual({ mapId: 101, entries: 3 });
    expect(loader.readText('notes.txt')).toBe('内置地图数据包');
    expect(toHex(loader.read('meshes/sample.glb'))).toBe('46546c6702000100');
    expect(loader.list()).toEqual([
      { name: 'manifest.json', mime: 'application/json', byteLength: 25 },
      { name: 'notes.txt', mime: 'text/plain; charset=utf-8', byteLength: 21 },
      { name: 'meshes/sample.glb', mime: 'model/gltf-binary', byteLength: 8 },
    ]);
  });

  it('read 返回副本，修改不影响后续读取', async () => {
    const loader = await DmapLoader.open(await writeSampleContainer(), TEST_MATERIAL);
    const bytes = loader.read('meshes/sample.glb');
    bytes.fill(0);
    expect(toHex(loader.read('meshes/sample.glb'))).toBe('46546c6702000100');
  });

  it('相同材料与 IV 的两次写入逐字节一致（确定性）', async () => {
    const first = await writeSampleContainer();
    const second = await writeSampleContainer();
    expect(toHex(first)).toBe(toHex(second));
  });

  it('未命中条目抛出 DmapEntryError', async () => {
    const loader = await DmapLoader.open(await writeSampleContainer(), TEST_MATERIAL);
    expect(() => loader.read('missing.txt')).toThrow(DmapEntryError);
  });
});

describe('容器头校验', () => {
  it('magic 错误抛出 bad_header', async () => {
    const container = await writeSampleContainer();
    const forged = container.slice();
    forged[0] = 0x58;
    await expect(DmapLoader.open(forged, TEST_MATERIAL)).rejects.toThrow(DmapFormatError);
  });

  it('版本不支持抛出 unsupported_version', async () => {
    const container = await writeSampleContainer();
    const forged = container.slice();
    new DataView(forged.buffer).setUint32(4, 99, true);
    await expect(DmapLoader.open(forged, TEST_MATERIAL)).rejects.toThrow(DmapFormatError);
  });

  it('容器过短抛出 truncated', async () => {
    await expect(DmapLoader.open(new Uint8Array(10), TEST_MATERIAL)).rejects.toThrow(
      DmapFormatError,
    );
  });

  it('encodeHeader/decodeHeader 往返保留 version/flags/iv', () => {
    const iv = hexBytes('0a0b0c0d0e0f101112131415');
    const header = decodeHeader(encodeHeader({ version: FORMAT_VERSION, flags: 7, iv }));
    expect(header.version).toBe(FORMAT_VERSION);
    expect(header.flags).toBe(7);
    expect(toHex(header.iv)).toBe('0a0b0c0d0e0f101112131415');
  });
});

describe('篡改检测', () => {
  it('密文区任一字节被翻转即校验失败', async () => {
    const container = await writeSampleContainer();
    for (const offset of [
      HEADER_BYTES,
      container.length - 1,
      Math.floor((HEADER_BYTES + container.length) / 2),
    ]) {
      const forged = container.slice();
      forged[offset] ^= 0x01;
      await expect(DmapLoader.open(forged, TEST_MATERIAL)).rejects.toThrow(DmapIntegrityError);
    }
  });

  it('头部 version 字节被篡改在头校验即被拒绝', async () => {
    const container = await writeSampleContainer();
    const forged = container.slice();
    forged[4] ^= 0x01;
    await expect(DmapLoader.open(forged, TEST_MATERIAL)).rejects.toThrow(DmapFormatError);
  });

  it('头部 flags/iv 被篡改即校验失败（additionalData 绑定）', async () => {
    const container = await writeSampleContainer();
    for (const offset of [8, 12, HEADER_BYTES - 1]) {
      const forged = container.slice();
      forged[offset] ^= 0x01;
      await expect(DmapLoader.open(forged, TEST_MATERIAL)).rejects.toThrow(DmapIntegrityError);
    }
  });

  it('尾部截断抛出完整性错误', async () => {
    const container = await writeSampleContainer();
    await expect(
      DmapLoader.open(container.slice(0, container.length - 4), TEST_MATERIAL),
    ).rejects.toThrow(DmapIntegrityError);
  });

  it('密钥不匹配抛出完整性错误', async () => {
    const container = await writeSampleContainer();
    await expect(DmapLoader.open(container, OTHER_MATERIAL)).rejects.toThrow(DmapIntegrityError);
  });

  it('派生材料逐字节可复现（resolveAesKey 输入一致性）', async () => {
    const first = deriveRawKeyBytes(TEST_MATERIAL);
    const second = deriveRawKeyBytes({
      segments: TEST_MATERIAL.segments.map((segment) => segment.slice()),
      tables: TEST_MATERIAL.tables.map((table) => table.slice()),
    });
    expect(toHex(first)).toBe(toHex(second));
  });
});
