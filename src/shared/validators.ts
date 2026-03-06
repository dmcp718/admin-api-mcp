/**
 * Input validation for user-supplied values.
 */

export type ValidationResult = { ok: true; value: string } | { ok: false; error: string };

export function validateFilespaceName(name: string): ValidationResult {
  if (!name) return { ok: false, error: "Filespace name cannot be empty" };
  if (name.length < 3 || name.length > 63)
    return { ok: false, error: "Filespace names must be 3-63 characters long" };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(name))
    return {
      ok: false,
      error: "Filespace names can only contain letters, numbers, hyphens, and underscores (cannot start/end with special characters)",
    };
  return { ok: true, value: name };
}

export function validateEmail(email: string): ValidationResult {
  if (!email) return { ok: false, error: "Email cannot be empty" };
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email))
    return { ok: false, error: "Invalid email address format" };
  return { ok: true, value: email };
}

export function validateGroupName(name: string): ValidationResult {
  if (!name) return { ok: false, error: "Group name cannot be empty" };
  if (name.length > 255) return { ok: false, error: "Group names must be 1-255 characters long" };
  const clean = name.replace(/[<>"\/\\|?*]/g, "");
  return { ok: true, value: clean };
}
