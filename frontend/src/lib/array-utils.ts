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
