// https://stackoverflow.com/a/12646864/19244626
export function shuffle<T>(array: T[]): T[] {
  for (let index = array.length - 1; index > 0; index--) {
    const newIndex = Math.floor(Math.random() * (index + 1))
    ;[array[index], array[newIndex]] = [array[newIndex], array[index]]
  }
  return array
}
