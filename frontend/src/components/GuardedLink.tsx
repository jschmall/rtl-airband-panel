import { Link, NavLink, type LinkProps, type NavLinkProps } from "react-router-dom";
import { useUnsavedChanges } from "../state/UnsavedChangesContext.js";

/** A <Link> that confirms discarding unsaved changes (see UnsavedChangesContext) before navigating. */
export function GuardedLink({ onClick, ...props }: LinkProps) {
  const { confirmDiscard } = useUnsavedChanges();
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (!confirmDiscard()) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}

/** A <NavLink> that confirms discarding unsaved changes (see UnsavedChangesContext) before navigating. */
export function GuardedNavLink({ onClick, ...props }: NavLinkProps) {
  const { confirmDiscard } = useUnsavedChanges();
  return (
    <NavLink
      {...props}
      onClick={(e) => {
        if (!confirmDiscard()) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
