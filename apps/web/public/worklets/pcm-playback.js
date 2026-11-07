/**
 * Aulora system-audio playback worklet.
 *
 * Receives interleaved `Float32Array` PCM chunks over the message port, resamples
 * them from the source rate to the AudioContext rate, and writes the result into
 * the node's outputs so the graph can feed a `MediaStreamAudioDestinationNode`.
 *
 * This file is a plain ES module served from the app origin: the desktop shell's
 * CSP (`script-src 'self'`) refuses inline/blob worklet modules, so it must never
 * be bundled, inlined or rewritten as TypeScript.
 */

/* global sampleRate -- provided by AudioWorkletGlobalScope */
/* eslint-disable security/detect-object-injection -- every index is a bounded frame counter into a typed array; no key comes from outside the worklet */

/** Frames kept in the ring buffer: bounds playback latency regardless of input rate. */
const MAX_BUFFER_SECONDS = 0.3;

const FALLBACK_SAMPLE_RATE = 48000;

/** Contexts below this guard against a missing/zero `sampleRate` global. */
function contextSampleRate() {
  return typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : FALLBACK_SAMPLE_RATE;
}

function clampSample(value) {
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}

export class PcmPlaybackProcessor extends AudioWorkletProcessor {
  /** AudioContext rate; every queued frame is already at this rate. */
  #contextRate = FALLBACK_SAMPLE_RATE;
  /** Rate of the incoming PCM, set by the last `header` message. */
  #sourceRate = FALLBACK_SAMPLE_RATE;
  /** Channel count of the incoming interleaved PCM. */
  #sourceChannels = 1;
  /** Source frames advanced per output frame (`sourceRate / contextRate`). */
  #step = 1;

  /** Ring buffer of interleaved stereo frames, `#capacity` frames long. */
  #buffer = new Float32Array(0);
  #capacity = 0;
  #readIndex = 0;
  #writeIndex = 0;
  #framesBuffered = 0;

  /** Soft gain applied on output; kept at unity. */
  #gain = 1;

  /** Previous source frame and the fractional position of the next output sample. */
  #previousLeft = 0;
  #previousRight = 0;
  #position = 0;
  #hasPrevious = false;

  constructor() {
    super();
    this.#contextRate = contextSampleRate();
    this.#sourceRate = this.#contextRate;
    this.#capacity = Math.max(1, Math.ceil(this.#contextRate * MAX_BUFFER_SECONDS));
    this.#buffer = new Float32Array(this.#capacity * 2);
    this.port.onmessage = (event) => this.#handleMessage(event);
  }

  #handleMessage(event) {
    const data = event === null || event === undefined ? null : event.data;
    if (data === null || typeof data !== "object") {
      return;
    }
    switch (data.type) {
      case "header": {
        const channels = Math.floor(Number(data.channels));
        const rate = Number(data.sampleRate);
        this.#sourceChannels = Number.isFinite(channels) && channels >= 1 ? channels : 1;
        this.#sourceRate = Number.isFinite(rate) && rate > 0 ? rate : this.#contextRate;
        this.#step = this.#sourceRate / this.#contextRate;
        this.#reset();
        break;
      }
      case "pcm": {
        if (data.pcm instanceof Float32Array) {
          this.#enqueueInterleaved(data.pcm);
        }
        break;
      }
      case "flush": {
        this.#reset();
        break;
      }
      default:
        break;
    }
  }

  /** Drops buffered audio and the seam state so a following chunk starts clean. */
  #reset() {
    this.#readIndex = 0;
    this.#writeIndex = 0;
    this.#framesBuffered = 0;
    this.#previousLeft = 0;
    this.#previousRight = 0;
    this.#position = 0;
    this.#hasPrevious = false;
  }

  /**
   * Resamples interleaved PCM into the stereo ring buffer. Linear interpolation
   * carries the previous frame and fractional position across chunks, so chunk
   * seams do not click.
   */
  #enqueueInterleaved(pcm) {
    const channels = this.#sourceChannels;
    const frames = Math.floor(pcm.length / channels);
    let index = 0;
    if (!this.#hasPrevious) {
      if (frames === 0) {
        return;
      }
      this.#previousLeft = pcm[0];
      this.#previousRight = channels >= 2 ? pcm[1] : pcm[0];
      this.#hasPrevious = true;
      this.#position = 0;
      // Position zero depends only on the previous frame, so emit it now: no
      // lookahead is needed and the stream does not lose its first sample.
      this.#emitPrevious();
      index = 1;
    }
    for (; index < frames; index += 1) {
      const base = index * channels;
      const left = pcm[base];
      const right = channels >= 2 ? pcm[base + 1] : left;
      while (this.#position < 1) {
        const position = this.#position;
        this.#push(
          this.#previousLeft + (left - this.#previousLeft) * position,
          this.#previousRight + (right - this.#previousRight) * position,
        );
        this.#position += this.#step;
      }
      this.#position -= 1;
      this.#previousLeft = left;
      this.#previousRight = right;
      if (this.#position === 0) {
        this.#emitPrevious();
      }
    }
  }

  #emitPrevious() {
    this.#push(this.#previousLeft, this.#previousRight);
    this.#position += this.#step;
  }

  #push(left, right) {
    if (this.#framesBuffered === this.#capacity) {
      // Overrun: advance the read cursor so the oldest frame is overwritten.
      this.#readIndex = (this.#readIndex + 1) % this.#capacity;
      this.#framesBuffered -= 1;
    }
    const offset = this.#writeIndex * 2;
    this.#buffer[offset] = left;
    this.#buffer[offset + 1] = right;
    this.#writeIndex = (this.#writeIndex + 1) % this.#capacity;
    this.#framesBuffered += 1;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }
    const leftChannel = output[0];
    const rightChannel = output.length > 1 ? output[1] : null;
    const frames = leftChannel ? leftChannel.length : 0;
    const gain = this.#gain;
    for (let frame = 0; frame < frames; frame += 1) {
      let left = 0;
      let right = 0;
      if (this.#framesBuffered > 0) {
        const offset = this.#readIndex * 2;
        left = this.#buffer[offset];
        right = this.#buffer[offset + 1];
        this.#readIndex = (this.#readIndex + 1) % this.#capacity;
        this.#framesBuffered -= 1;
      }
      leftChannel[frame] = clampSample(left * gain);
      if (rightChannel) {
        rightChannel[frame] = clampSample(right * gain);
      }
    }
    return true;
  }
}

// The worklet scope registers the processor; tests import this module without
// an audio scope and register nothing.
if (typeof registerProcessor === "function") {
  registerProcessor("aulora-pcm", PcmPlaybackProcessor);
}
