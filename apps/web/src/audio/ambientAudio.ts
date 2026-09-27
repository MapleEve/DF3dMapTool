/**
 * 场景环境音引擎（音量设置项的真实效果，WebAudio 实时合成，无外部音频素材）。
 *
 * - AudioContext 惰性创建：只在用户手势上下文里调用（设置滑条输入/首次交互监听），
 *   规避浏览器自动播放策略的挂起告警；创建失败（无 WebAudio）静默降级为无操作；
 * - 声景两层，整体极轻：
 *   · 风——4 秒循环棕噪声（白噪声积分平滑）→ 320Hz 低通 → 0.03Hz 慢速幅度起伏；
 *   · 垫——55Hz 与 55.7Hz 双正弦微失谐拍频，极低电平；
 * - 音量 0-100 → 主增益感知映射（幂曲线 + 上限），0 为静音；
 * - 全部节点常驻（启动一次），运行期只动主增益——避免频繁建拆节点。
 */

/** 音量百分数 → 主增益（感知幂曲线；0 静音，100 ≈ 0.5 上限）。 */
export function volumeToGain(volumePercent: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(volumePercent) ? volumePercent : 0));
  return (clamped / 100) ** 1.8 * 0.5;
}

/** 棕噪声缓冲（4 秒循环；白噪声逐样本积分 + 漏泄，防直流漂移）。 */
function createBrownNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 4;
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, seconds * sampleRate, sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

interface AmbientNodes {
  readonly master: GainNode;
}

let ctx: AudioContext | null = null;
let nodes: AmbientNodes | null = null;
let startAttempted = false;

/** 按需创建 AudioContext 与声景节点（幂等；失败返回 null）。 */
function ensureEngine(): AmbientNodes | null {
  if (nodes !== null) {
    return nodes;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) {
      return null;
    }
    const audioCtx = ctx ?? new Ctor();
    ctx = audioCtx;

    const master = audioCtx.createGain();
    master.gain.value = 0;
    master.connect(audioCtx.destination);

    // 风层：棕噪声循环 → 低通 → 幅度 LFO。
    const noise = audioCtx.createBufferSource();
    noise.buffer = createBrownNoiseBuffer(audioCtx);
    noise.loop = true;
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 320;
    const windGain = audioCtx.createGain();
    windGain.gain.value = 0.4;
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.03;
    const lfoDepth = audioCtx.createGain();
    lfoDepth.gain.value = 0.18;
    lfo.connect(lfoDepth);
    lfoDepth.connect(windGain.gain);
    noise.connect(lowpass);
    lowpass.connect(windGain);
    windGain.connect(master);
    noise.start();
    lfo.start();

    // 垫层：双正弦微失谐拍频。
    const droneA = audioCtx.createOscillator();
    droneA.frequency.value = 55;
    const droneB = audioCtx.createOscillator();
    droneB.frequency.value = 55.7;
    const droneGain = audioCtx.createGain();
    droneGain.gain.value = 0.05;
    droneA.connect(droneGain);
    droneB.connect(droneGain);
    droneGain.connect(master);
    droneA.start();
    droneB.start();

    nodes = { master };
    return nodes;
  } catch {
    return null;
  }
}

/** 恢复被自动播放策略挂起的上下文（手势上下文内调用）。 */
function resumeIfSuspended(): void {
  if (ctx !== null && ctx.state === "suspended") {
    void ctx.resume().catch(() => {
      // 恢复失败保持静默（下次手势/音量调整再试）。
    });
  }
}

/**
 * 启动环境音（首次用户手势调用）：创建引擎、应用当前音量并恢复上下文。
 * 重复调用幂等；无 WebAudio/创建失败静默降级。
 */
export function startAmbientAudio(volumePercent: number): void {
  startAttempted = true;
  const engine = ensureEngine();
  if (engine === null) {
    return;
  }
  resumeIfSuspended();
  applyGain(engine, volumePercent);
}

/**
 * 应用音量（0-100）：滑条输入实时调用。调用点均在用户手势上下文内
 * （设置滑条输入），按需创建引擎并恢复被自动播放策略挂起的上下文；
 * 已在运行则即时改主增益。
 */
export function applyAmbientVolume(volumePercent: number): void {
  const engine = ensureEngine();
  if (engine === null) {
    return;
  }
  resumeIfSuspended();
  applyGain(engine, volumePercent);
}

function applyGain(engine: AmbientNodes, volumePercent: number): void {
  const audioCtx = ctx;
  if (audioCtx === null) {
    return;
  }
  engine.master.gain.setTargetAtTime(volumeToGain(volumePercent), audioCtx.currentTime, 0.05);
}

/** 测试辅助：是否已尝试启动 + 引擎是否就绪。 */
export function ambientAudioState(): { started: boolean; engineReady: boolean } {
  return { started: startAttempted, engineReady: nodes !== null };
}

/** 测试辅助：重置模块态（不销毁已建上下文——真实上下文由页面生命周期管理）。 */
export function resetAmbientAudioForTest(): void {
  startAttempted = false;
}
