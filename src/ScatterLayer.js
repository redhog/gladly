import { LayerType } from "./LayerType.js"

// Helper to create property accessor (repl regl.prop which may not be available)
const prop = (path) => (context, props) => {
  const parts = path.split('.')
  let value = props
  for (const part of parts) value = value[part]
  return value
}

export const scatterLayerType = new LayerType({
  name: "scatter",
  xUnit: "meters",
  yUnit: "meters",
  attributes: {
    x: { buffer: prop("data.x") },
    y: { buffer: prop("data.y") },
    v: { buffer: prop("data.v") }
  },
  vert: `
    precision mediump float;
    attribute float x;
    attribute float y;
    attribute float v;
    uniform vec2 xDomain;
    uniform vec2 yDomain;
    varying float value;
    void main() {
      float nx = (x - xDomain.x)/(xDomain.y-xDomain.x);
      float ny = (y - yDomain.x)/(yDomain.y-yDomain.x);
      gl_Position = vec4(nx*2.0-1.0, ny*2.0-1.0, 0, 1);
      gl_PointSize = 4.0;
      value = v;
    }
  `,
  frag: `
    precision mediump float;
    varying float value;
    vec3 colormap(float t){ return vec3(t,0.0,1.0-t); }
    void main(){ gl_FragColor=vec4(colormap(value),1.0); }
  `
})
