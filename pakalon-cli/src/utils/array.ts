/**
 * Array utility functions
 */

/**
 * Count elements in an array that match a predicate
 */
export function count<T>(array: T[], predicate: (item: T) => boolean): number {
  let result = 0;
  for (const item of array) {
    if (predicate(item)) {
      result++;
    }
  }
  return result;
}