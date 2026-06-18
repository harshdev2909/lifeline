/**
 * voiceAudio.ts — browser mic capture and PCM playback for the live voice loop.
 *
 * Mic: capture via Web Audio, downsample to 16 kHz mono, convert to s16le, and
 * hand each frame to a callback (the bridge streams it as a binary WS frame).
 * Playback: queue the Int16 PCM frames the bridge streams back (Supertonic at
 * 44.1 kHz) and schedule them gaplessly. Everything stays on the machine — the
 * only destination is the localhost bridge.
 */
const STT_RATE = 16000;

export interface MicStream {
  stop(): void;
  /** Live input level 0..1 for the meter (updated as audio flows). */
  level(): number;
}

export async function startMic(onFrame: (pcm: ArrayBuffer) => void): Promise<MicStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  let lvl = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
    lvl = peak;
    const down = downsample(input, ctx.sampleRate, STT_RATE);
    onFrame(floatToS16(down));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
    level: () => lvl,
  };
}

function downsample(buffer: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const outLen = Math.floor(buffer.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += buffer[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function floatToS16(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Schedules incoming Int16 PCM frames for gapless playback. */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private readonly rate: number;

  constructor(rate = 44100) {
    this.rate = rate;
  }

  private ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.nextTime = 0;
    }
    void this.ctx.resume();
    return this.ctx;
  }

  enqueue(pcm: ArrayBuffer): void {
    const ctx = this.ensure();
    const int16 = new Int16Array(pcm);
    if (!int16.length) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buffer = ctx.createBuffer(1, f32.length, this.rate);
    buffer.copyToChannel(f32, 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.nextTime);
    node.start(at);
    this.nextTime = at + buffer.duration;
    this.nodes.add(node);
    node.onended = () => this.nodes.delete(node);
  }

  /** Stop playback immediately (barge-in / interrupt). */
  stop(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.clear();
    this.nextTime = this.ctx ? this.ctx.currentTime : 0;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
