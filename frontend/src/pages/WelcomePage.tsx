import { useInstanceList } from "../state/InstanceListContext.js";
import { InstanceHealthOverview } from "../components/InstanceHealthOverview.js";

export function WelcomePage() {
  const { instances } = useInstanceList();
  const hasInstances = instances !== null && instances.length > 0;

  if (!hasInstances) {
    return (
      <div className="flex h-full items-center justify-center text-center text-slate-400">
        <div className="space-y-2">
          <p>Select an instance from the left to edit its config.</p>
          <p>Or click "+ New instance" to create one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InstanceHealthOverview />
      <p className="text-center text-sm text-slate-400">
        Select an instance from the left to edit its config, or click "+ New instance" to create one.
      </p>
    </div>
  );
}
