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
      className={`w-48 placeholder:text-slate-500 ${inputClass}`}
    />
  );
}
