import { BufferGeometry } from 'three'
import getIndicesForEdges from './getIndicesForEdges'
import { shuffle } from './shuffle'

export default function getIndicesForRandomEdges(
  geometry: BufferGeometry,
  reduceRate: number,
  thresholdAngle = 1
) {
  const edges = getIndicesForEdges(geometry, thresholdAngle)
  shuffle(edges)
  edges.length = Math.floor(reduceRate * edges.length)
  return edges
}
