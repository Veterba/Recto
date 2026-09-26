/**
 * WebGL2 plumbing for the home scene: the full-screen quad's vertex shader,
 * and compiling and linking programs.
 */

const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader
  console.error(`Home scene shader failed: ${gl.getShaderInfoLog(shader) ?? '?'}`)
  gl.deleteShader(shader)
  return null
}

export function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  const program = gl.createProgram()
  if (vs === null || fs === null || program === null) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'a_pos')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program
  console.error(`Home scene link failed: ${gl.getProgramInfoLog(program) ?? '?'}`)
  return null
}
