vec2 texCoordAt(int index, in vec2 size) {
  return vec2(
    float(index % int(size.x)) / size.x,
    float(index / int(size.x)) / size.y
  );
}

#pragma glslify: export(texCoordAt)
