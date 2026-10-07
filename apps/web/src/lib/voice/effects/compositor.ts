import type { BackgroundBlur } from "@aulora/core";
import { SEGMENT_HEIGHT, SEGMENT_WIDTH } from "./segmenter";

/**
 * Draws the camera picture over a new background on the GPU: the person is kept
 * sharp and everything else is replaced by a blurred copy of the camera or by an
 * image. One full-screen triangle per pass, no vertex buffers.
 */
export type Backdrop =
  | { readonly kind: "blur"; readonly strength: BackgroundBlur }
  | { readonly kind: "image"; readonly image: CanvasImageSource };

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle that covers the screen.
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLUR = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  // Five taps with linear filtering make a nine-tap Gaussian.
  vec4 sum = texture(uTexture, vUv) * 0.2270270270;
  sum += texture(uTexture, vUv + uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uTexture, vUv - uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uTexture, vUv + uStep * 3.2307692308) * 0.0702702703;
  sum += texture(uTexture, vUv - uStep * 3.2307692308) * 0.0702702703;
  outColor = sum;
}`;

const COMPOSITE = `#version 300 es
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform sampler2D uBackdrop;
in vec2 vUv;
out vec4 outColor;
void main() {
  float person = smoothstep(0.35, 0.75, texture(uMask, vUv).r);
  vec3 front = texture(uVideo, vUv).rgb;
  vec3 back = texture(uBackdrop, vUv).rgb;
  outColor = vec4(mix(back, front, person), 1.0);
}`;

/** How many blur passes, and how far each one reaches, for each strength. */
function blurPlan(strength: BackgroundBlur): { readonly passes: number; readonly reach: number } {
  return strength === "light" ? { passes: 2, reach: 1 } : { passes: 4, reach: 1.6 };
}

/** The blur runs on a quarter-size copy: it is cheaper and just as smooth. */
const BLUR_SCALE = 4;

interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("Could not create a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed to compile");
  }
  return shader;
}

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const linked = gl.createProgram();
  gl.attachShader(linked, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(linked, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(linked);
  if (gl.getProgramParameter(linked, gl.LINK_STATUS) !== true) {
    throw new Error(gl.getProgramInfoLog(linked) ?? "Shader failed to link");
  }
  return linked;
}

/** Makes `shader` the one that draws next. */
function activate(gl: WebGL2RenderingContext, shader: WebGLProgram): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: `useProgram` is a WebGL call, not a React hook.
  gl.useProgram(shader);
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const created = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, created);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return created;
}

function target(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const color = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture: color, framebuffer };
}

export type FrameSource = TexImageSource;

export class Compositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly blurProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly video: WebGLTexture;
  private readonly mask: WebGLTexture;
  private readonly image: WebGLTexture;
  private ping: Target | null = null;
  private pong: Target | null = null;
  private width = 0;
  private height = 0;
  private backdrop: Backdrop = { kind: "blur", strength: "strong" };
  private imageDirty = true;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("WebGL 2 is not available");
    }
    this.gl = gl;
    this.blurProgram = program(gl, BLUR);
    this.compositeProgram = program(gl, COMPOSITE);
    this.vao = gl.createVertexArray();
    this.video = texture(gl);
    this.mask = texture(gl);
    this.image = texture(gl);
  }

  setBackdrop(backdrop: Backdrop): void {
    this.backdrop = backdrop;
    this.imageDirty = true;
  }

  /** Sets the output size and reallocates the blur targets to match. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.imageDirty = true;
    const small = {
      width: Math.max(2, Math.round(width / BLUR_SCALE)),
      height: Math.max(2, Math.round(height / BLUR_SCALE)),
    };
    this.ping = target(this.gl, small.width, small.height);
    this.pong = target(this.gl, small.width, small.height);
  }

  /** Draws one frame; `mask` is the person mask at the segmenter's size. */
  draw(frame: FrameSource, mask: Uint8Array): void {
    const { gl } = this;
    gl.bindVertexArray(this.vao);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.upload(this.video, 0, frame);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      SEGMENT_WIDTH,
      SEGMENT_HEIGHT,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      mask,
    );
    const backdrop = this.prepareBackdrop();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    activate(gl, this.compositeProgram);
    this.bind(0, this.video, this.compositeProgram, "uVideo");
    this.bind(1, this.mask, this.compositeProgram, "uMask");
    this.bind(2, backdrop, this.compositeProgram, "uBackdrop");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const { gl } = this;
    for (const owned of [
      this.video,
      this.mask,
      this.image,
      this.ping?.texture,
      this.pong?.texture,
    ]) {
      gl.deleteTexture(owned ?? null);
    }
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private upload(slot: WebGLTexture, unit: number, source: FrameSource): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, slot);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private bind(unit: number, slot: WebGLTexture, using: WebGLProgram, name: string): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, slot);
    gl.uniform1i(gl.getUniformLocation(using, name), unit);
  }

  /** The texture to show behind the person: the blurred camera, or the image. */
  private prepareBackdrop(): WebGLTexture {
    if (this.backdrop.kind === "image") {
      if (this.imageDirty) {
        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
        this.upload(this.image, 3, this.backdrop.image as TexImageSource);
        this.imageDirty = false;
      }
      return this.image;
    }
    return this.blurred(this.backdrop.strength);
  }

  private blurred(strength: BackgroundBlur): WebGLTexture {
    const { gl } = this;
    const { passes, reach } = blurPlan(strength);
    const first = this.ping;
    const second = this.pong;
    if (first === null || second === null) {
      return this.video;
    }
    const smallWidth = Math.round(this.width / BLUR_SCALE);
    const smallHeight = Math.round(this.height / BLUR_SCALE);
    activate(gl, this.blurProgram);
    gl.viewport(0, 0, smallWidth, smallHeight);
    let source: WebGLTexture = this.video;
    for (let pass = 0; pass < passes; pass += 1) {
      // Steps are in texture coordinates: `reach` small-texture pixels apart.
      source = this.blurPass(source, first, [reach / smallWidth, 0]);
      source = this.blurPass(source, second, [0, reach / smallHeight]);
    }
    return source;
  }

  private blurPass(source: WebGLTexture, into: Target, step: readonly [number, number]) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.framebuffer);
    this.bind(0, source, this.blurProgram, "uTexture");
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, "uStep"), step[0], step[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return into.texture;
  }
}
