import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { describeValidationPath } from "../lib/validation-path.js";

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
                className="shrink-0 text-xs text-amber-300 underline decoration-dotted hover:text-white"
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
  return (
    <li>
      {label && (
        <>
          <button type="button" onClick={() => onJumpTo(issue.path)} className={`${labelClassName} underline decoration-dotted hover:text-white`}>
            {label}
          </button>
          {": "}
        </>
      )}
      {issue.message}
    </li>
  );
}
