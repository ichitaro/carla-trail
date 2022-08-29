uniform sampler2D uMap;
uniform vec2 uMapSize;
uniform int uNumFrames;
uniform vec3 uShift;

#pragma glslify: texCoordAt = require(../helpers/texCoordAt)

void main() {
  int fragmentIndex = int(gl_FragCoord.y) * int(resolution.x) + int(gl_FragCoord.x);
  int vertexIndex = fragmentIndex / uNumFrames;
  int frameIndex = fragmentIndex % uNumFrames;
  
  vec4 prevData = texture2D(uHistoryMap, texCoordAt(fragmentIndex - 1, resolution));
  prevData.xyz += uShift;
  
  vec4 latestData = texture2D(uMap, texCoordAt(vertexIndex, uMapSize));

  float shouldGetLatest = step(float(frameIndex), 0.0);
  vec4 srcData = mix(prevData, latestData, shouldGetLatest);
  
  gl_FragColor = srcData;
}
