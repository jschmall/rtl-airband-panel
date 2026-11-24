import type { InstanceSummary } from "../api/client.js";
import { compareSerials } from "./hardware-format.js";

export type InstanceSort = "name" | "serial" | "center";

export const INSTANCE_SORT_LABEL: Record<InstanceSort, string> = {
  name: "Name",
  serial: "Serial",
  center: "Center freq",
};

const SORT_KEY = "rtl-panel:instance-sort";

export function loadInstanceSort(): InstanceSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "name" || v === "serial" || v === "center" ? v : "name";
  } catch {
    return "name";
  }
}

export function saveInstanceSort(v: InstanceSort) {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    // Storage blocked: the choice just won't be remembered.
  }
}

/** Case-insensitive, numbers in order, like the Hardware page's. */
function compareNames(a: InstanceSummary, b: InstanceSummary): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

const compareCenters = (a: number, b: number) => (a === b ? 0 : a - b);

/**
 * By what the list shows for each instance: its name, or its first SDR's
 * serial or center frequency. Ones without (no serial, a scan SDR) go last,
 * and ties go by name.
 */
export function sortInstances(instances: readonly InstanceSummary[], sort: InstanceSort): InstanceSummary[] {
  const serial = (i: InstanceSummary) => i.devices?.[0]?.serial ?? null;
  const center = (i: InstanceSummary) => i.devices?.[0]?.centerFreqHz ?? Infinity;
  return [...instances].sort((a, b) => {
    const first = sort === "serial" ? compareSerials(serial(a), serial(b)) : sort === "center" ? compareCenters(center(a), center(b)) : 0;
    return first || compareNames(a, b);
  });
}
