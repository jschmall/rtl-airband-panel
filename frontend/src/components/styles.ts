export const inputClass =
  "h-8 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:ring-offset-1 focus:ring-offset-slate-900";
export const checkboxClass = "h-4 w-4 rounded border-slate-700 bg-slate-900";
export const removeButtonClass = "text-sm text-red-400 hover:text-red-300";
export const addButtonClass = "text-sm text-sky-400 hover:text-sky-300";

// md:-breakpoint responsive grid patterns for the dense field grids throughout the
// editors -- stacks to a single column below md: (or two, for the 4-up case, where
// each field's label is short enough to still read fine 2-across even on a phone),
// restoring the original column count at md: and wider. A shared string constant,
// not a wrapper component, since callers' surrounding classes (gap size, extra
// container styling) already differ per site -- see ConfigEditor's two grids, which
// don't use these because they need their own gap/container classes alongside.
export const responsiveGrid2 = "grid grid-cols-1 gap-2 md:grid-cols-2";
export const responsiveGrid3 = "grid grid-cols-1 gap-2 md:grid-cols-3";
export const responsiveGrid4 = "grid grid-cols-2 gap-2 md:grid-cols-4";
