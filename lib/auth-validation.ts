// Shared by the sign-in dialog and the auth API routes.

export type AuthMode = "sign-in" | "sign-up"

export type AuthFields = {
  name: string
  email: string
  password: string
}

/** Keys of `auth.errors.*` in the message files, so each language words them itself. */
export type AuthErrorKey =
  | "enterName"
  | "nameTooLong"
  | "enterEmail"
  | "invalidEmail"
  | "enterPassword"
  | "passwordTooShort"
  | "passwordTooLong"
  | "fixFields"
  | "invalidRequest"
  | "incorrectCredentials"
  | "accountExists"
  | "passwordShort"
  | "passwordLong"
  | "tooManyAttempts"
  | "serverError"
  | "generic"
  | "network"
  | "linkExpired"
  | "notVerified"
  | "cancelled"
  | "unsupportedProvider"
  | "incomplete"
  | "failed"

/** An error to show, as a message key and the numbers it mentions. */
export type AuthFieldError = { key: AuthErrorKey; values?: Record<string, number> }

export type FieldErrors = Partial<Record<keyof AuthFields, AuthFieldError>>

export const NAME_MAX = 100
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeAuthFields(input: Partial<Record<keyof AuthFields, unknown>>): AuthFields {
  return {
    name: typeof input.name === "string" ? input.name.trim() : "",
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
    password: typeof input.password === "string" ? input.password : "",
  }
}

export function validateAuthFields(mode: AuthMode, fields: AuthFields): FieldErrors {
  const errors: FieldErrors = {}

  if (mode === "sign-up") {
    if (!fields.name) errors.name = { key: "enterName" }
    else if (fields.name.length > NAME_MAX) errors.name = { key: "nameTooLong", values: { max: NAME_MAX } }
  }

  if (!fields.email) errors.email = { key: "enterEmail" }
  else if (!EMAIL_PATTERN.test(fields.email) || fields.email.length > 254)
    errors.email = { key: "invalidEmail" }

  if (!fields.password) errors.password = { key: "enterPassword" }
  else if (mode === "sign-up" && fields.password.length < PASSWORD_MIN)
    errors.password = { key: "passwordTooShort", values: { min: PASSWORD_MIN } }
  else if (fields.password.length > PASSWORD_MAX)
    errors.password = { key: "passwordTooLong", values: { max: PASSWORD_MAX } }

  return errors
}
