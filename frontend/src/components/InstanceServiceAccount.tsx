import { useEffect, useState } from "react";
import { Field } from "./Field.js";
import { inputClass, responsiveGrid2 } from "./styles.js";
import { INSTANCE_OPTIONS_TOOLTIPS } from "../lib/config-descriptions.js";

interface InstanceServiceAccountProps {
  name: string;
  serviceUser?: string;
  serviceGroup?: string;
  /** Whether the *saved* config has control_socket_path set -- see InstanceEditPage's own use of the same check for the Apply live button. */
  controlSocketPathSet: boolean;
  pending: boolean;
  onSave: (serviceUser: string, serviceGroup: string) => void;
}

/**
 * The systemd unit's User=/Group=, edited separately from jsonLogging
 * (InstanceLogs) since it's not log-related -- it exists to satisfy the
 * dynamic_reload control socket's SO_PEERCRED check (exact UID match),
 * which a unit left running as root (the default when unset) fails. See
 * INSTANCE_OPTIONS_TOOLTIPS.serviceUser.
 */
export function InstanceServiceAccount({ name, serviceUser, serviceGroup, controlSocketPathSet, pending, onSave }: InstanceServiceAccountProps) {
  const [draftUser, setDraftUser] = useState(serviceUser ?? "");
  const [draftGroup, setDraftGroup] = useState(serviceGroup ?? "");

  // Resyncs the draft with the saved value on load and after a successful save --
  // this component persists across a client-side navigation to a different
  // instance (InstanceEditPage doesn't remount), so `name` is in the dependency
  // list the same way that page's own effects key off it.
  useEffect(() => {
    setDraftUser(serviceUser ?? "");
    setDraftGroup(serviceGroup ?? "");
  }, [name, serviceUser, serviceGroup]);

  const dirty = draftUser !== (serviceUser ?? "") || draftGroup !== (serviceGroup ?? "");
  const showWarning = controlSocketPathSet && !serviceUser && !serviceGroup;

  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-4">
      <h4 className="text-lg font-semibold text-slate-100">Service account</h4>
      {showWarning && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-300">
          This instance's config sets Control socket path, but no service account is set below. The control socket only accepts
          connections from the exact user the daemon runs as — with User=/Group= unset, the unit runs as root, and Apply live
          will fail with a permission error.
        </p>
      )}
      <div className={responsiveGrid2}>
        <Field label="Service user (optional)" tooltip={INSTANCE_OPTIONS_TOOLTIPS.serviceUser}>
          <input className={inputClass} value={draftUser} onChange={(e) => setDraftUser(e.target.value)} />
        </Field>
        <Field label="Service group (optional)" tooltip={INSTANCE_OPTIONS_TOOLTIPS.serviceGroup}>
          <input className={inputClass} value={draftGroup} onChange={(e) => setDraftGroup(e.target.value)} />
        </Field>
      </div>
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() => onSave(draftUser, draftGroup)}
        className="rounded border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save service account"}
      </button>
    </div>
  );
}
