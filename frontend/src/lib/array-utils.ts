export function updateAt<T>(arr: T[], index: number, next: T): T[] {
  return arr.map((item, i) => (i === index ? next : item));
}

export function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export function appendItem<T>(arr: T[], item: T): T[] {
  return [...arr, item];
}
