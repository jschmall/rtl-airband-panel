export function numberOrUndefined(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}
