export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Machine-readable identifier for the specific check that produced this issue. */
  code: string;
  message: string;
  /** JSON-pointer-ish path into the config, e.g. "$.devices[0].channels[3]". */
  path: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function isValid(result: ValidationResult): boolean {
  return result.errors.length === 0;
}
