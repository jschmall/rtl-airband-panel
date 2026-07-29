export function updateAt<T>(arr: T[], index: number, next: T): T[] {
  return arr.map((item, i) => (i === index ? next : item));
}

export function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export function appendItem<T>(arr: T[], item: T): T[] {
  return [...arr, item];
}

/** Inserts `clone(arr[index])` immediately after `index` -- used for "Duplicate" buttons. */
export function duplicateAt<T>(arr: T[], index: number, clone: (item: T) => T): T[] {
  const copy = clone(arr[index]!);
  return [...arr.slice(0, index + 1), copy, ...arr.slice(index + 1)];
}

/** Moves the item at `from` to `to`, shifting everything in between -- used for drag-and-drop reordering. No-op if from === to or either index is out of range. */
export function moveAt<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}
