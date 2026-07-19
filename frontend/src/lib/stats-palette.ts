/**
 * Validated categorical palette (dataviz skill, references/palette.md),
 * dark-mode steps only -- this app has no light theme to match. Slots are
 * used in fixed order (1, 2, 3, ...), never cycled or reassigned by rank,
 * so identity stays CVD-safe across charts.
 */
export const CATEGORICAL = [
  "#3987e5", // 1 blue
  "#008300", // 2 green
  "#d55181", // 3 magenta
  "#c98500", // 4 yellow
  "#199e70", // 5 aqua
  "#d95926", // 6 orange
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

export const CHART_CHROME = {
  surface: "#1a1a19",
  textPrimary: "#ffffff",
  textSecondary: "#c3c2b7",
  muted: "#898781",
  gridline: "#2c2c2a",
  axis: "#383835",
} as const;
