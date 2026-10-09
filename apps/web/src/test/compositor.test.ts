import { describe, expect, it, vi } from "vitest";
import { Compositor } from "../lib/voice/effects/compositor";

/**
 * A minimal stand-in for a WebGL 2 context. It records the calls the compositor
 * makes so a test can assert that GPU resources are created and freed, without a
 * real browser or GPU.
 */
/** The WebGL enum values the compositor reads, with their real numbers. */
const GL_ENUMS = {
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  TEXTURE_2D: 0x0de1,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  RGBA8: 0x8058,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  R8: 0x8229,
  RED: 0x1903,
  TEXTURE0: 0x84c0,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_ALIGNMENT: 0x0cf5,
  TRIANGLES: 0x0004,
};

/** The calls that record their arguments and return nothing. */
function statelessCalls() {
  return {
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    useProgram: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
    pixelStorei: vi.fn(),
  };
}

function fakeGl() {
  let next = 1;
  const handle = () => ({ id: next++ });
  return {
    ...GL_ENUMS,
    ...statelessCalls(),
    createShader: vi.fn(handle),
    createProgram: vi.fn(handle),
    createTexture: vi.fn(handle),
    createFramebuffer: vi.fn(handle),
    createVertexArray: vi.fn(handle),
    getUniformLocation: vi.fn(handle),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
  };
}

function rig() {
  const gl = fakeGl();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => gl),
  } as unknown as HTMLCanvasElement;
  return { gl, canvas, compositor: new Compositor(canvas) };
}

describe("Compositor GPU resources", () => {
  it("allocates the blur targets on the first resize", () => {
    const { gl, compositor } = rig();
    const before = gl.createFramebuffer.mock.calls.length;
    compositor.resize(640, 480);
    expect(gl.createFramebuffer.mock.calls.length - before).toBe(2);
  });

  it("frees the old blur targets before reallocating on resize", () => {
    const { gl, compositor } = rig();
    compositor.resize(640, 480);
    const freedTextures = gl.deleteTexture.mock.calls.length;
    const freedFramebuffers = gl.deleteFramebuffer.mock.calls.length;
    compositor.resize(1280, 720);
    // The two targets from the first resize are released, then two are made.
    expect(gl.deleteTexture.mock.calls.length - freedTextures).toBe(2);
    expect(gl.deleteFramebuffer.mock.calls.length - freedFramebuffers).toBe(2);
  });

  it("does not reallocate when the size is unchanged", () => {
    const { gl, compositor } = rig();
    compositor.resize(640, 480);
    const before = gl.createFramebuffer.mock.calls.length;
    compositor.resize(640, 480);
    expect(gl.createFramebuffer.mock.calls.length - before).toBe(0);
  });

  it("frees the blur targets and programs on dispose", () => {
    const { gl, compositor } = rig();
    compositor.resize(640, 480);
    const freedFramebuffers = gl.deleteFramebuffer.mock.calls.length;
    compositor.dispose();
    expect(gl.deleteFramebuffer.mock.calls.length - freedFramebuffers).toBe(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
  });
});
