import { useInstanceList } from "../state/InstanceListContext.js";
import { inputClass } from "./styles.js";

export function InstanceSearchInput() {
  const { searchQuery, setSearchQuery } = useInstanceList();
  return (
    <input
      type="search"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Search instances…"
      aria-label="Search instances"
      // flex-1 (fill the actions row's remaining width, next to the pending-restart pill)
      // below md:, reverting to a fixed compact width alongside the pill at md:+.
      className={`min-w-0 flex-1 placeholder:text-slate-500 md:w-48 md:flex-none ${inputClass}`}
    />
  );
}
