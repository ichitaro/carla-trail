uniform sampler2D uMap;
uniform vec2 uMapSize;
uniform int uNumFrames;

#pragma glslify: texCoordAt = require(../helpers/texCoordAt)

void main() {
  int fragmentIndex = int(gl_FragCoord.y) * int(resolution.x) + int(gl_FragCoord.x);
  int vertexIndex = fragmentIndex / uNumFrames;
  vec4 newestData = texture2D(uMap, texCoordAt(vertexIndex, uMapSize));
  
  gl_FragColor = newestData;
}
