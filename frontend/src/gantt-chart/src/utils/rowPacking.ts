/**
 * Packs valid items into the first row where they do not collide.
 *
 * @param items Candidate items in their desired placement order.
 * @param isValid Rejects malformed items before placement.
 * @param collides Determines whether two valid items share a row.
 * @returns Rows containing each valid item exactly once.
 */
export function packIntoNonOverlappingRows<T>(
  items: readonly T[],
  isValid: (item: T) => boolean,
  collides: (candidate: T, existing: T) => boolean,
): T[][] {
  const rows: T[][] = [];

  for (const item of items) {
    if (!isValid(item)) continue;

    const availableRow = rows.find(
      (row) => !row.some((existingItem) => collides(item, existingItem)),
    );

    if (availableRow) {
      availableRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows;
}
