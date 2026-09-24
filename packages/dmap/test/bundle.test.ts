import { describe, expect, it } from 'vitest';
import {
  DMAPC_GENERATOR,
  packBundle,
  readEntryData,
  unpackBundle,
  type BundleEntry,
} from '../src/index.js';
import { DmapEntryError, DmapFormatError } from '../src/index.js';
import { hexBytes, toHex } from './helpers.js';

const ENTRIES: BundleEntry[] = [
  { name: 'manifest.json', mime: 'application/json', data: hexBytes('7b2261223a317d') },
  { name: 'meshes/wall.glb', mime: 'model/gltf-binary', data: hexBytes('00ff10aa55ff00ee') },
  { name: 'tiles/ground.png', mime: 'image/png', data: new Uint8Array(0) },
  {
    name: 'notes.txt',
    mime: 'text/plain; charset=utf-8',
    data: new TextEncoder().encode('战术地图'),
  },
];

describe('GLB 打包与还原', () => {
  it('往返保留全部条目内容', () => {
    const glb = packBundle(ENTRIES);
    const bundle = unpackBundle(glb);

    expect(bundle.entries.map((entry) => entry.name)).toEqual(ENTRIES.map((entry) => entry.name));
    expect(toHex(readEntryData(bundle, 'meshes/wall.glb'))).toBe('00ff10aa55ff00ee');
    expect(readEntryData(bundle, 'tiles/ground.png').length).toBe(0);
    expect(new TextDecoder().decode(readEntryData(bundle, 'notes.txt'))).toBe('战术地图');
    expect(JSON.parse(new TextDecoder().decode(readEntryData(bundle, 'manifest.json')))).toEqual({
      a: 1,
    });
  });

  it('dmapc 索引字段与数据偏移正确', () => {
    const bundle = unpackBundle(packBundle(ENTRIES));
    const manifest = bundle.entries.find((entry) => entry.name === 'manifest.json');
    expect(manifest?.mime).toBe('application/json');
    expect(manifest?.byteOffset).toBe(0);
    expect(manifest?.byteLength).toBe(7);
    const mesh = bundle.entries.find((entry) => entry.name === 'meshes/wall.glb');
    expect(mesh?.byteOffset).toBe(7);
    expect(mesh?.byteLength).toBe(8);
  });

  it('输出总长为 4 的倍数（GLB 对齐要求）', () => {
    const glb = packBundle(ENTRIES);
    expect(glb.length % 4).toBe(0);
    const view = new DataView(glb.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(8, true)).toBe(glb.length);
  });

  it('重复条目名被拒绝', () => {
    expect(() =>
      packBundle([
        { name: 'a.json', mime: 'application/json', data: new Uint8Array(1) },
        { name: 'a.json', mime: 'application/json', data: new Uint8Array(2) },
      ]),
    ).toThrow(DmapFormatError);
  });

  it('空条目名被拒绝', () => {
    expect(() =>
      packBundle([{ name: '', mime: 'application/json', data: new Uint8Array(1) }]),
    ).toThrow(DmapFormatError);
  });

  it('还原后可按名称读取，未知名称抛出 DmapEntryError', () => {
    const bundle = unpackBundle(packBundle(ENTRIES));
    expect(() => readEntryData(bundle, 'missing.bin')).toThrow(DmapEntryError);
  });

  it('generator 标识固定', () => {
    expect(DMAPC_GENERATOR).toBe('dmap-writer/1');
  });
});
