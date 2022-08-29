export default function lerpDelta(alpha: number, deltaTime: number) {
  return 1 - Math.pow(1 - alpha, 60 * deltaTime)
}
