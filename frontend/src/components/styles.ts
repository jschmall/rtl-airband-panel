// Compact (below lg:) inputs are taller for touch, and 16px because iOS zooms the page in on anything smaller.
export const inputClass =
  "h-10 min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-base text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:ring-offset-1 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50 lg:h-8 lg:text-sm";
export const checkboxClass =
  "h-5 w-5 flex-shrink-0 rounded border-slate-700 bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 lg:h-4 lg:w-4";
export const removeButtonClass = "py-2 text-sm text-red-400 hover:text-red-300 lg:py-0";
export const addButtonClass = "py-2 text-sm text-sky-400 hover:text-sky-300 lg:py-0";

// The editors nest device > channel > output. On a compact screen each level
// is a full-width band (its negative margin undoes the parent's padding), told
// apart by shade, so an output's fields are as wide as a device's; from lg: up
// they're boxes inside boxes.
export const sectionCardClass = "-mx-4 border-y border-slate-700 px-4 py-2 lg:mx-0 lg:rounded-lg lg:border lg:p-4";
export const nestedCardClass = "-mx-4 border-y border-slate-600 px-4 py-2 lg:mx-0 lg:rounded lg:border lg:p-3";

// Field grids: as many columns as still fit their labels. Anything spanning a
// whole row needs col-span-full, not col-span-2, which would add a second
// column to the one-column layout.
export const responsiveGrid2 = "grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:gap-2";
export const responsiveGrid3 = "grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 lg:gap-2";
export const responsiveGrid4 = "grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 lg:gap-2";
