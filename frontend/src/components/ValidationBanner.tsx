import type { ValidationIssue } from "@rtl-airband-panel/validate";

interface ValidationBannerProps {
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
}

export function ValidationBanner({ errors, warnings }: ValidationBannerProps) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="space-y-2">
      {errors && errors.length > 0 && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <p className="font-medium">Validation errors (save blocked):</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((issue, i) => (
              <li key={i}>
                <span className="text-red-200">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <p className="font-medium">Warnings:</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((issue, i) => (
              <li key={i}>
                <span className="text-amber-200">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
