import { useState } from "react";
import type { RtlAirbandConfig } from "../types/config.js";
import type { ValidationIssue } from "../types/config.js";
import { describeValidationPath } from "../lib/validation-path.js";
import { ISSUE_HINTS } from "../generated/issue-hints.js";
import { Tooltip } from "./Tooltip.js";

interface ValidationBannerProps {
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  config: RtlAirbandConfig;
  onJumpTo: (path: string) => void;
  /** Errors aren't dismissible -- they mean the save was blocked, so hiding them
   *  without fixing anything would be misleading. Warnings are advisory (e.g.
   *  post_write_script running arbitrary commands) and can be acknowledged away
   *  for the current view; they reappear on the next save that still triggers them. */
  onDismissWarnings?: () => void;
}

export function ValidationBanner({ errors, warnings, config, onJumpTo, onDismissWarnings }: ValidationBannerProps) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="space-y-2">
      {errors && errors.length > 0 && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <p className="font-medium">Validation errors (save blocked):</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((issue, i) => (
              <IssueRow key={i} issue={issue} config={config} onJumpTo={onJumpTo} labelClassName="text-red-200" />
            ))}
          </ul>
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">Warnings:</p>
            {onDismissWarnings && (
              <button
                type="button"
                onClick={onDismissWarnings}
                className="shrink-0 text-xs text-amber-300 underline decoration-dotted hover:text-slate-50"
              >
                Dismiss
              </button>
            )}
          </div>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((issue, i) => (
              <IssueRow key={i} issue={issue} config={config} onJumpTo={onJumpTo} labelClassName="text-amber-200" />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  config,
  onJumpTo,
  labelClassName,
}: {
  issue: ValidationIssue;
  config: RtlAirbandConfig;
  onJumpTo: (path: string) => void;
  labelClassName: string;
}) {
  const label = describeValidationPath(issue.path, config);
  // Codes the pages make up themselves (request-failed, conflict) have no hint.
  const hint = Object.hasOwn(ISSUE_HINTS, issue.code) ? ISSUE_HINTS[issue.code] : undefined;
  const [open, setOpen] = useState(false);
  return (
    <li>
      {label && (
        <>
          <button type="button" onClick={() => onJumpTo(issue.path)} className={`${labelClassName} text-left underline decoration-dotted hover:text-slate-50`}>
            {label}
          </button>
          {": "}
        </>
      )}
      {issue.message}
      {hint && (
        <>
          {" "}
          <Tooltip
            content={hint.summary}
            onClick={() => setOpen((o) => !o)}
            expanded={open}
            label={open ? "Hide how to fix" : "How to fix"}
            className={`inline-flex h-4 w-4 translate-y-[-1px] items-center justify-center rounded-full border border-current align-middle text-[10px] font-semibold leading-none opacity-70 hover:opacity-100 focus-visible:opacity-100 ${labelClassName}`}
          >
            ?
          </Tooltip>
          {open && (
            <div className="mt-1 mb-2 rounded border border-slate-600/50 bg-slate-950/30 px-2 py-1.5 text-xs text-slate-300">
              <p>
                <span className={`font-medium ${labelClassName}`}>How to fix: </span>
                {hint.summary}
              </p>
              <p className="mt-1 text-slate-400">{hint.detail}</p>
            </div>
          )}
        </>
      )}
    </li>
  );
}
