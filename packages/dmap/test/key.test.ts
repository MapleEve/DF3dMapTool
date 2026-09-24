import { describe, expect, it } from 'vitest';
import {
  deriveKey,
  deriveRawKeyBytes,
  isDmapKeyMaterial,
  KEY_BYTES,
  SEGMENT_BYTES,
  SEGMENT_COUNT,
} from '../src/index.js';
import { DmapKeyError } from '../src/index.js';
import { hexBytes, sha256Hex, toHex } from './helpers.js';

// 专用测试材料（与随包内置密钥无关）
const TEST_SEGMENTS = [
  '0001020304050607',
  '08090a0b0c0d0e0f',
  'f0f1f2f3f4f5f6f7',
  'e0e1e2e3e4e5e6e7',
].map(hexBytes);
const TEST_TABLES = [
  '0f0e0d0c0b0a0908',
  'f1f0f1f0f1f0f1f0',
  '123456789abcdef0',
  'deadbeefcafebabe',
].map(hexBytes);

const material = { segments: TEST_SEGMENTS, tables: TEST_TABLES };

// 期望值由独立实现（OpenSSL）离线计算，交叉验证 WebCrypto 路径
const EXPECTED_MATERIAL_HEX = '0f0f0f0f0f0f0f0ff9f9fbfbfdfdffffe2c5a48b6e4928073e4c5c0c2e1b5c59';
const EXPECTED_DIGEST_HEX = '56bb5ac9135bf84e8a7a782a26a62ce3156fff3d58bb6f4123805216dd6c7a0c';

describe('密钥派生', () => {
  it('逐段异或并拼接为 32 字节中间材料，结果确定', () => {
    const first = deriveRawKeyBytes(material);
    const second = deriveRawKeyBytes(material);
    expect(first).toEqual(second);
    expect(first.length).toBe(KEY_BYTES);
    expect(toHex(first)).toBe(EXPECTED_MATERIAL_HEX);
  });

  it('材料逐字节改变则中间材料改变（每一位都参与）', () => {
    const flipped = {
      segments: material.segments.map((segment, index) => {
        if (index !== 2) {
          return segment;
        }
        const copy = segment.slice();
        copy[0] = segment[0] ^ 0x01;
        return copy;
      }),
      tables: material.tables,
    };
    expect(toHex(deriveRawKeyBytes(flipped))).not.toBe(EXPECTED_MATERIAL_HEX);
  });

  it('中间材料的 SHA-256 与离线已知值一致（OpenSSL 交叉验证）', async () => {
    const digest = await sha256Hex(deriveRawKeyBytes(material));
    expect(digest).toBe(EXPECTED_DIGEST_HEX);
  });

  it('派生得到可用的 AES-GCM CryptoKey', async () => {
    const key = await deriveKey(material);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain('encrypt');
  });

  it('非法材料抛出 DmapKeyError', () => {
    expect(() =>
      deriveRawKeyBytes({ segments: TEST_SEGMENTS.slice(0, 3), tables: TEST_TABLES }),
    ).toThrow(DmapKeyError);
    expect(() =>
      deriveRawKeyBytes({
        segments: TEST_SEGMENTS.map((segment) => segment.slice(0, SEGMENT_BYTES - 1)),
        tables: TEST_TABLES,
      }),
    ).toThrow(DmapKeyError);
  });

  it('isDmapKeyMaterial 校验段数与段长', () => {
    expect(isDmapKeyMaterial(material)).toBe(true);
    expect(isDmapKeyMaterial({ segments: [], tables: [] })).toBe(false);
    expect(isDmapKeyMaterial(null)).toBe(false);
    expect(isDmapKeyMaterial('DMAP')).toBe(false);
    expect(SEGMENT_COUNT).toBe(4);
    expect(SEGMENT_BYTES).toBe(8);
  });
});
