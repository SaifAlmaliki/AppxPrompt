import { NextResponse } from "next/server"

import { AuthError } from "@/lib/cloudhike-auth"
import {
  normalizeAuthFields,
  validateAuthFields,
  type AuthErrorKey,
  type AuthFields,
  type AuthMode,
} from "@/lib/auth-validation"

const FRIENDLY_ERRORS: Record<string, AuthErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "incorrectCredentials",
  USER_ALREADY_EXISTS: "accountExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "accountExists",
  PASSWORD_TOO_SHORT: "passwordShort",
  PASSWORD_TOO_LONG: "passwordLong",
  INVALID_EMAIL: "invalidEmail",
}

export async function readAuthBody(
  request: Request,
  mode: AuthMode
): Promise<{ fields: AuthFields } | { response: NextResponse }> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return { response: NextResponse.json({ errorKey: "invalidRequest" satisfies AuthErrorKey }, { status: 400 }) }
  }

  const fields = normalizeAuthFields(body)
  const fieldErrors = validateAuthFields(mode, fields)
  if (Object.keys(fieldErrors).length > 0) {
    return {
      response: NextResponse.json(
        { errorKey: "fixFields" satisfies AuthErrorKey, fieldErrors },
        { status: 400 }
      ),
    }
  }
  return { fields }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError && error.status < 500) {
    // Known problems answer with a message key, which the page words in its own language.
    // Anything else is the auth service's own text.
    const errorKey: AuthErrorKey | undefined =
      (error.code && FRIENDLY_ERRORS[error.code]) ||
      (error.status === 429 ? "tooManyAttempts" : undefined)
    return NextResponse.json(errorKey ? { errorKey } : { error: error.message }, {
      status: error.status,
    })
  }

  console.error("Auth request failed", error)
  return NextResponse.json({ errorKey: "serverError" satisfies AuthErrorKey }, { status: 500 })
}
