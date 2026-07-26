import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { describeValidationPath } from "../lib/validation-path.js";

interface ValidationBannerProps {
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  config: RtlAirbandConfig;
  onJumpTo: (path: string) => void;
}

export function ValidationBanner({ errors, warnings, config, onJumpTo }: ValidationBannerProps) {
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
          <p className="font-medium">Warnings:</p>
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
