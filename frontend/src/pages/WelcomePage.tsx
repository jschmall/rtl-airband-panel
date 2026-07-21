export function WelcomePage() {
  return (
    <div className="flex h-full items-center justify-center text-center text-slate-400">
      <div className="space-y-2">
        <p>Select an instance from the left to edit its config.</p>
        <p>Or click "+ New instance" to create one.</p>
      </div>
    </div>
  );
}
