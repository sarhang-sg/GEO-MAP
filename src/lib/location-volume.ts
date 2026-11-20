import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import type { LngLatTuple } from "./location";
import { isCameraTilted } from "./map-camera-controller";

export const LOCATION_VOLUME_LAYER = "location-3d-volume";
type Vertex = [number, number, number];

// A fixed mesh in CSS pixels. Only its anchor is in geographic coordinates.
function arrowMesh(): Float32Array {
  const footprint = [[0,16],[-11,-12],[0,-7],[11,-12]];
  const base: Vertex[] = footprint.map(([x,y]) => [x,y,0]);
  const roof: Vertex[] = footprint.map(([x,y],i) => [x,y,i === 2 ? 7 : 4]);
  const data: number[] = [];
  function triangle(a: Vertex, b: Vertex, c: Vertex, color: number[]): void {
    for (const point of [a,b,c]) data.push(...point,...color);
  }
  for (let i=0; i<4; i++) {
    const j=(i+1)%4;
    const color = i<2 ? [.32,.23,.63] : [.27,.19,.54];
    triangle(base[i],base[j],roof[j],color);
    triangle(base[i],roof[j],roof[i],color);
  }
  triangle(roof[0],roof[1],roof[2],[.89,.94,1]);
  triangle(roof[0],roof[2],roof[3],[.57,.47,1]);
  return new Float32Array(data);
}
const mesh = arrowMesh();

const vertexShader = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 color;
uniform vec2 anchor, pixelScale;
uniform vec4 rotation;
out vec3 ink;
void main() {
  vec2 ground = vec2(dot(position.xy, rotation.xy), dot(position.xy, vec2(-rotation.y,rotation.x)));
  vec2 offset = vec2(ground.x, ground.y * rotation.z + position.z * rotation.w);
  gl_Position = vec4(anchor + offset * pixelScale, 0.0, 1.0);
  ink = color;
}`;
const fragmentShader = `#version 300 es
precision mediump float;
in vec3 ink;
out vec4 pixel;
void main() { pixel = vec4(ink, 1.0); }`;

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!;
  try {
    for (const [type,source] of [[gl.VERTEX_SHADER,vertexShader],[gl.FRAGMENT_SHADER,fragmentShader]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader,source);
      gl.compileShader(shader);
      gl.attachShader(program,shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "GPS shader");
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
}

export class LocationVolume {
  private coordinate: LngLatTuple | null = null;
  private heading: number | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private anchor: WebGLUniformLocation | null = null;
  private scale: WebGLUniformLocation | null = null;
  private rotation: WebGLUniformLocation | null = null;

  constructor(private readonly map: MapLibreMap) {
    map.on("pitch",this.sync);
    map.on("style.load",this.sync);
    map.on("remove",this.destroy);
  }
  update(coordinate: LngLatTuple | null, heading: number | null): void {
    this.coordinate = coordinate && coordinate.every(Number.isFinite) && Math.abs(coordinate[0]) <= 180 && Math.abs(coordinate[1]) <= 85.1 ? coordinate : null;
    this.heading = heading !== null && Number.isFinite(heading) ? heading : null;
    this.sync();
    if (this.coordinate && isCameraTilted(this.map.getPitch())) this.map.triggerRepaint();
  }
  private sync = (): void => {
    const active = this.coordinate !== null && isCameraTilted(this.map.getPitch());
    if (active && !this.map.getLayer(LOCATION_VOLUME_LAYER) && this.map.getStyle()?.layers) this.map.addLayer(this.layer);
    for (const id of ["location-dot","location-direction-arrow","location-pulse"]) {
      if (!this.map.getLayer(id)) continue;
      const target = active ? "none" : "visible";
      if ((this.map.getLayoutProperty(id,"visibility") ?? "visible") !== target) this.map.setLayoutProperty(id,"visibility",target);
    }
  };
  private readonly layer: CustomLayerInterface = {
    id: LOCATION_VOLUME_LAYER,
    type: "custom",
    renderingMode: "2d",
    onAdd: (_,gl) => {
      this.program = createProgram(gl);
      this.anchor = gl.getUniformLocation(this.program,"anchor");
      this.scale = gl.getUniformLocation(this.program,"pixelScale");
      this.rotation = gl.getUniformLocation(this.program,"rotation");
      this.vao = gl.createVertexArray();
      this.buffer = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.STATIC_DRAW);
      for (const index of [0,1]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index,3,gl.FLOAT,false,24,index*12);
      }
      gl.bindVertexArray(null);
    },
    render: gl => {
      const pitch = this.map.getPitch();
      if (!this.program || !this.coordinate || !isCameraTilted(pitch)) return;
      const {x,y} = this.map.project(this.coordinate);
      const {clientWidth:w,clientHeight:h} = this.map.getCanvas();
      if (!w || !h || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const rad = Math.PI/180;
      const angle = this.heading === null ? 0 : (this.heading - this.map.getBearing())*rad;
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.uniform2f(this.anchor,2*x/w-1,1-2*y/h);
      gl.uniform2f(this.scale,2/w,2/h);
      gl.uniform4f(this.rotation,Math.cos(angle),Math.sin(angle),Math.cos(pitch*rad),Math.sin(pitch*rad));
      gl.drawArrays(gl.TRIANGLES,0,mesh.length/6);
      gl.bindVertexArray(null);
    },
    onRemove: (_,gl) => {
      gl.deleteVertexArray(this.vao);
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
      this.program = null;
    }
  };
  private destroy = (): void => {
    this.map.off("pitch",this.sync);
    this.map.off("style.load",this.sync);
    this.map.off("remove",this.destroy);
  };
}
