// Runs inside the sandbox VM. Node-only glue that gives route code a small global scope.
// node:vm is NOT a security boundary: host objects handed in can still reach the host realm.
// It only keeps the obvious doors shut. The sandbox VM's network policy is the egress wall.
import { createContext, runInContext } from "node:vm"
import type { Evaluator, ModuleScope } from "./dispatch"

/** Everything else a route can name is a JavaScript built-in of the context itself. */
const HOST_GLOBALS = ["Request", "Response", "Headers", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal"] as const
const HOST_FUNCTIONS = ["setTimeout", "clearTimeout", "structuredClone", "atob", "btoa"] as const

/** One shared context for all of a bundle's modules, built when the first one loads. */
export function createVmEvaluator(): Evaluator {
  let context: object | null = null

  function build(scope: ModuleScope) {
    const sandbox: Record<string, unknown> = {}
    const created = createContext(sandbox, { name: "appxprompt-server-function" })
    // Wrappers made inside the context, so `fetch.constructor` is the context's Function and not the host's.
    const wrap = runInContext("(fn) => function (...args) { return fn(...args) }", created) as (fn: unknown) => unknown
    const freezeEnv = runInContext("(env) => Object.freeze({ env: Object.freeze({ ...env }) })", created) as (env: unknown) => unknown
    const silent = runInContext("new Proxy({}, { get: () => () => {} })", created)

    const host = globalThis as unknown as Record<string, unknown>
    for (const name of HOST_GLOBALS) sandbox[name] = host[name]
    for (const name of HOST_FUNCTIONS) sandbox[name] = wrap(host[name])
    sandbox.crypto = host.crypto
    sandbox.fetch = wrap(scope.fetch)
    sandbox.process = freezeEnv(scope.process.env)
    sandbox.console = silent
    return created
  }

  return (code, scope, filename) => {
    context ??= build(scope)
    // No importModuleDynamically, so `import()` in a route rejects.
    const factory = runInContext(`(function (require, module, exports) {${code}\n})`, context, { filename }) as (...args: unknown[]) => void
    factory(scope.require, scope.module, scope.exports)
  }
}

type Host = {
  process: Record<string, unknown>
  global: Record<string, unknown>
  console: Record<string, unknown>
}

/** Closes the host's side doors. Run once the server has everything it needs, before any route loads. */
export function hardenHost(host: Host = { process: process as never, global: globalThis as never, console: console as never }) {
  for (const name of ["getBuiltinModule", "binding", "dlopen"]) Reflect.deleteProperty(host.process, name)
  for (const name of ["WebSocket", "EventSource"]) Reflect.deleteProperty(host.global, name)
  for (const name of Object.keys(host.console)) if (typeof host.console[name] === "function") host.console[name] = () => {}
}
