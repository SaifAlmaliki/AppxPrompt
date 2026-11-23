import { API_ROUTE_FILE, SERVER_HELPER_FILE, SYSTEM_SERVER_FILES } from "@/lib/agent-protocol"
import { compileServerFile } from "@/lib/sandbox/routes"
import { findKeys } from "@/lib/services/key-patterns"

export type ServerRouteContext = {
  path: string
  credentialNames: string[]
  allowedHosts: string[]
  helperPaths: string[]
}

const HANDLER = /\bexport\s+(?:async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\s*\(|const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*[=:])/

const IMPORT_SOURCE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g

const URL_LITERAL = /https:\/\/[^\s"'`]+/g

const PROCESS = /\bprocess\b/g

// `process.env.NAME`, with whitespace, newlines and `?.` allowed between the tokens.
const ENV_DOT = /^\s*(?:\?\.|\.)\s*env\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/

// `process.env["NAME"]`
const ENV_BRACKET = /^\s*(?:\?\.|\.)\s*env\s*(?:\?\.)?\s*\[\s*(["'])([^"'\\\n]*)\1\s*\]/

// How `process` can be used other than by name: `process.x`, `process["x"]`.
const PROCESS_MEMBER = /^\s*(?:(?:\?\.|\.)\s*[A-Za-z_$]|\??\.?\s*\[)/

// What comes before `process` when it's passed around or stored: `= process`, `(process`, `{ process`.
const PROCESS_VALUE = /(?:[=(\[{,]|\.\.\.|\|\||&&|\?\?|\breturn)\s*$/

const PROCESS_KEY = /\[\s*["'`]process["'`]\s*\]/

const ENV_MESSAGE = "Read each credential as process.env.NAME."

const FORBIDDEN: [string, RegExp][] = [
  ["eval", /\beval\b|\[\s*["'`]eval["'`]\s*\]/],
  ["new Function", /\bnew\s+Function\b/],
  ["Function", /(?<!\bnew\s+)\bFunction\b|\[\s*["'`]Function["'`]\s*\]/],
  ["require(", /\brequire\s*\(/],
  ["import(", /\bimport\s*\(/],
  ["process.binding", /\bprocess\s*\??\.\s*binding\b/],
  ["process.dlopen", /\bprocess\s*\??\.\s*dlopen\b/],
  ["globalThis.fetch =", /\bglobalThis\s*\.\s*fetch\s*=(?!=)/],
  [".constructor.constructor", /\.\s*constructor\s*\.\s*constructor\b/],
  [".constructor(", /\.\s*constructor\s*\(/],
]

const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/

/** Whether a `/` here starts a regular expression, going by what comes right before it. */
function startsRegex(before: string) {
  const trimmed = before.trimEnd()
  if (trimmed === "") return true
  return /[(,=:\[!&|?{};+\-*%<>~^]$/.test(trimmed) || REGEX_AFTER_WORD.test(trimmed)
}

/** The code with comments blanked out, leaving strings and regular expressions as they are. */
function withoutComments(code: string) {
  let out = ""
  let i = 0
  let quote: string | null = null
  while (i < code.length) {
    const char = code[i]
    const next = code[i + 1]
    if (quote) {
      out += char
      if (char === "\\" && next !== undefined) {
        out += next
        i += 2
        continue
      }
      if (char === quote) quote = null
      i++
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char
      out += char
      i++
    } else if (char === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++
    } else if (char === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2)
      i = end === -1 ? code.length : end + 2
      out += " "
    } else if (char === "/" && startsRegex(out)) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < code.length && code[j] !== "\n") {
        if (code[j] === "\\") j++
        else if (code[j] === "[") inClass = true
        else if (code[j] === "]") inClass = false
        else if (code[j] === "/" && !inClass) {
          closed = true
          break
        }
        j++
      }
      if (closed) {
        out += code.slice(i, j + 1)
        i = j + 1
      } else {
        out += char
        i++
      }
    } else {
      out += char
      i++
    }
  }
  return out
}

/**
 * The file in the project that an import points at, or null for a package or built-in.
 * `@/x` is the project root, a relative path is resolved against the importing file.
 */
export function serverImportTarget(from: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return `${specifier.slice(2)}.ts`
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null
  const parts = from.split("/").slice(0, -1)
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") parts.pop()
    else parts.push(segment)
  }
  return `${parts.join("/")}.ts`
}

const unique = <T>(values: T[]) => [...new Set(values)]

function importProblems(code: string, ctx: ServerRouteContext) {
  const allowed = unique([...ctx.helperPaths, ...SYSTEM_SERVER_FILES])
  const unknown = [...code.matchAll(IMPORT_SOURCE)]
    .map((match) => match[1] ?? match[2])
    .filter((source) => {
      const target = serverImportTarget(ctx.path, source)
      return target === null || !allowed.includes(target)
    })
  if (unknown.length === 0) return []
  return [`It imports ${unique(unknown).join(", ")}, which isn't available. Server code may only import: ${allowed.join(", ")}.`]
}

/** `process` may only appear as `process.env.NAME` or `process.env["NAME"]`. */
function envProblems(code: string, credentialNames: string[]) {
  const names: string[] = []
  let misused = PROCESS_KEY.test(code)
  for (const match of code.matchAll(PROCESS)) {
    const after = code.slice(match.index + match[0].length)
    const name = ENV_DOT.exec(after)?.[1] ?? ENV_BRACKET.exec(after)?.[2]
    if (name !== undefined) names.push(name)
    else if (PROCESS_MEMBER.test(after) || PROCESS_VALUE.test(code.slice(0, match.index))) misused = true
  }

  const problems: string[] = []
  const ownNames = [...credentialNames, "NODE_ENV"]
  for (const name of unique(names).filter((name) => !ownNames.includes(name))) {
    problems.push(
      name.startsWith("APPXPROMPT_")
        ? `Don't read APPXPROMPT_ values. Use data from "@/server/data" instead.`
        : `It reads process.env.${name}, which isn't one of its credentials: ${credentialNames.join(", ") || "none"}.`
    )
  }
  if (misused) problems.push(ENV_MESSAGE)
  return problems
}

function urlProblems(code: string, allowedHosts: string[]) {
  const problems: string[] = []
  if (/http:\/\//.test(code)) problems.push("It uses http://. Use https:// only.")
  const hosts: string[] = []
  for (const match of code.matchAll(URL_LITERAL)) {
    try {
      hosts.push(new URL(match[0]).hostname)
    } catch {
      // A host built from a variable isn't a literal one.
    }
  }
  for (const host of unique(hosts).filter((host) => !allowedHosts.includes(host))) {
    problems.push(`It calls ${host}, which isn't one of this service's hosts: ${allowedHosts.join(", ") || "none"}.`)
  }
  return problems
}

/**
 * Everything in a generated server route or helper that breaks the rules, as instructions for rewriting it. Empty means valid.
 * Imports, `process` and forbidden names are checked in the code as written, comments included, so a
 * regular expression can never hide them. Only URLs skip comments.
 */
export function validateServerRoute(code: string, ctx: ServerRouteContext): string[] {
  const isRoute = API_ROUTE_FILE.test(ctx.path)
  const isHelper = SERVER_HELPER_FILE.test(ctx.path)
  if ((!isRoute && !isHelper) || (SYSTEM_SERVER_FILES as readonly string[]).includes(ctx.path)) {
    return [`${ctx.path} isn't a file you can write.`]
  }

  const problems: string[] = []

  try {
    compileServerFile(ctx.path, code)
  } catch (error) {
    problems.push(`It doesn't compile: ${error instanceof Error ? error.message : String(error)}.`)
  }

  const source = withoutComments(code)

  const hasHandler = HANDLER.test(source)
  if (isRoute && !hasHandler) {
    problems.push("It has no request handler. Export async function POST(request: Request): Promise<Response>.")
  }
  if (isHelper && hasHandler) {
    problems.push("Helpers can't handle requests. Move the handler into an app/api route.")
  }

  problems.push(...importProblems(code, ctx))
  problems.push(...envProblems(code, ctx.credentialNames))
  problems.push(...urlProblems(source, ctx.allowedHosts))

  if (findKeys(code).length > 0) {
    problems.push("It contains what looks like a credential. Read it from process.env instead.")
  }

  const forbidden = FORBIDDEN.filter(([token, pattern]) => pattern.test(code) && !(token === "Function" && /\bnew\s+Function\b/.test(code))).map(([token]) => token)
  for (const token of forbidden) problems.push(`It uses ${token}, which isn't allowed in server code.`)

  return problems
}
