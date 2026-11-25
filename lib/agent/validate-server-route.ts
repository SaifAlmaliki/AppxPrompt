import { parse } from "sucrase/dist/parser"
import { TokenType } from "sucrase/dist/parser/tokenizer/types"

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

const PROCESS_KEY = /\[\s*["'`]process["'`]\s*\]/g

const ENV_MESSAGE = "Read each credential as process.env.NAME."

// Names are checked in the code with strings blanked. The `["name"]` form needs the string, so it has its own pattern.
const FORBIDDEN: [string, RegExp, RegExp?][] = [
  ["eval", /\beval\b/, /\[\s*["'`]eval["'`]\s*\]/g],
  ["new Function", /\bnew\s+Function\b/],
  ["Function", /(?<!\bnew\s+)\bFunction\b/, /\[\s*["'`]Function["'`]\s*\]/g],
  ["require(", /\brequire\s*\(/],
  ["import(", /\bimport\s*\(/],
  ["process.binding", /\bprocess\s*\??\.\s*binding\b/],
  ["process.dlopen", /\bprocess\s*\??\.\s*dlopen\b/],
  ["globalThis.fetch =", /\bglobalThis\s*\.\s*fetch\s*=(?!=)/],
  [".constructor.constructor", /\.\s*constructor\s*\.\s*constructor\b/],
  [".constructor(", /\.\s*constructor\s*\(/],
]

/** Spaces for everything but line breaks, so positions and lines stay where they were. */
const blank = (text: string) => text.replace(/[^\n\r]/g, " ")

type Views = {
  /** Comments blanked out. Strings and regular expressions are as written. */
  noComments: string
  /** Comments blanked out, and the text inside strings and templates. Quotes and `${...}` expressions stay. */
  blanked: string
}

/**
 * The file as the scanner reads it, so prose in a message or a comment is never mistaken for code,
 * and a regular expression or a template can't hide code. A file the scanner can't read is used as written.
 */
function scan(code: string): Views {
  let tokens: { type: number; start: number; end: number }[]
  try {
    tokens = parse(code, false, true, false).tokens
  } catch {
    return { noComments: code, blanked: code }
  }

  let noComments = ""
  let blanked = ""
  let at = 0
  for (const token of tokens) {
    const gap = blank(code.slice(at, token.start)) // only space and comments are between tokens
    const text = code.slice(token.start, token.end)
    noComments += gap + text
    if (token.type === TokenType.string) {
      blanked += gap + text.slice(0, 1) + blank(text.slice(1, -1)) + text.slice(-1)
    } else if (token.type === TokenType.template) {
      blanked += gap + blank(text)
    } else {
      blanked += gap + text
    }
    at = token.end
  }
  const rest = blank(code.slice(at))
  return { noComments: noComments + rest, blanked: blanked + rest }
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

function importProblems({ noComments, blanked }: Views, ctx: ServerRouteContext) {
  const allowed = unique([...ctx.helperPaths, ...SYSTEM_SERVER_FILES])
  const unknown = [...noComments.matchAll(IMPORT_SOURCE)]
    // The keyword has to be code, and not words inside a string.
    .filter((match) => blanked[match.index] === noComments[match.index])
    .map((match) => match[1] ?? match[2])
    .filter((source) => {
      const target = serverImportTarget(ctx.path, source)
      return target === null || !allowed.includes(target)
    })
  if (unknown.length === 0) return []
  return [`It imports ${unique(unknown).join(", ")}, which isn't available. Server code may only import: ${allowed.join(", ")}.`]
}

/** Whether `pattern` (global) matches somewhere that is code: its first character isn't inside a string. */
function hasCodeMatch(pattern: RegExp, { noComments, blanked }: Views) {
  return [...noComments.matchAll(pattern)].some((match) => blanked[match.index] === noComments[match.index])
}

/** `process` may only appear as `process.env.NAME` or `process.env["NAME"]`. */
function envProblems({ noComments, blanked }: Views, credentialNames: string[]) {
  const names: string[] = []
  let misused = hasCodeMatch(PROCESS_KEY, { noComments, blanked })
  for (const match of blanked.matchAll(PROCESS)) {
    const after = noComments.slice(match.index + match[0].length)
    const name = ENV_DOT.exec(after)?.[1] ?? ENV_BRACKET.exec(after)?.[2]
    if (name !== undefined) names.push(name)
    else if (PROCESS_MEMBER.test(after) || PROCESS_VALUE.test(blanked.slice(0, match.index))) misused = true
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
 * Imports, `process` and forbidden names are checked in the code with comments and the text of strings
 * blanked, so prose can't fail it and a regular expression can't hide anything. URLs are read from strings.
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

  const views = scan(code)
  const source = views.noComments

  const hasHandler = HANDLER.test(views.blanked)
  if (isRoute && !hasHandler) {
    problems.push("It has no request handler. Export async function POST(request: Request): Promise<Response>.")
  }
  if (isHelper && hasHandler) {
    problems.push("Helpers can't handle requests. Move the handler into an app/api route.")
  }

  problems.push(...importProblems(views, ctx))
  problems.push(...envProblems(views, ctx.credentialNames))
  problems.push(...urlProblems(source, ctx.allowedHosts))

  if (findKeys(code).length > 0) {
    problems.push("It contains what looks like a credential. Read it from process.env instead.")
  }

  const forbidden = FORBIDDEN.filter(
    ([token, pattern, bracket]) =>
      (pattern.test(views.blanked) || (bracket !== undefined && hasCodeMatch(bracket, views))) &&
      !(token === "Function" && /\bnew\s+Function\b/.test(views.blanked))
  ).map(([token]) => token)
  for (const token of forbidden) problems.push(`It uses ${token}, which isn't allowed in server code.`)

  return problems
}
