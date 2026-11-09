/**
 * First-run owner setup helpers shared by the web, desktop and mobile clients
 * and the Convex setup action. The server remains authoritative: the client
 * copy only renders the meter and avoids an obviously rejected submit.
 */

/** Absolute floor for a first-run owner password, regardless of deployment. */
export const OWNER_PASSWORD_MIN_LENGTH = 8;

/** A long passphrase is strong even with only one character class. */
export const OWNER_PASSWORD_PASSPHRASE_LENGTH = 16;

const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "admin123",
  "letmein",
  "password",
  "password1",
  "password123",
  "qwerty123",
  "welcome1",
]);

export interface OwnerPasswordAssessment {
  /** 0 (empty) to 4 (strong); drives the meter. */
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: "Empty" | "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  readonly valid: boolean;
  /** The first problem, written as recovery guidance. */
  readonly problem: string | null;
}

function characterClasses(password: string): number {
  return [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

/**
 * Assesses a first-run owner password. The minimum is the deployment's
 * configured Better Auth minimum (default 8), never below the shared floor.
 * A password shorter than 16 characters must mix at least three character
 * classes; a passphrase of 16+ characters is accepted on length alone.
 */
export function assessOwnerPassword(
  password: string,
  configuredMinLength = OWNER_PASSWORD_MIN_LENGTH,
): OwnerPasswordAssessment {
  const minLength = Math.max(
    OWNER_PASSWORD_MIN_LENGTH,
    Number.isFinite(configuredMinLength)
      ? Math.floor(configuredMinLength)
      : OWNER_PASSWORD_MIN_LENGTH,
  );
  if (password.length === 0) {
    return { score: 0, label: "Empty", valid: false, problem: "Enter a password." };
  }
  if (password.length < minLength) {
    return {
      score: 1,
      label: "Too short",
      valid: false,
      problem: `Use at least ${minLength} characters.`,
    };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      score: 1,
      label: "Weak",
      valid: false,
      problem: "That password is too common. Choose something unique.",
    };
  }
  const classes = characterClasses(password);
  const longEnough = password.length >= OWNER_PASSWORD_PASSPHRASE_LENGTH;
  if (!longEnough && classes < 3) {
    return {
      score: 2,
      label: "Weak",
      valid: false,
      problem:
        "Mix at least three of lowercase, uppercase, numbers and symbols, or use a longer passphrase of 16+ characters.",
    };
  }
  const strong = password.length >= 20 || (longEnough && classes >= 3);
  return {
    score: strong ? 4 : 3,
    label: strong ? "Strong" : "Good",
    valid: true,
    problem: null,
  };
}
