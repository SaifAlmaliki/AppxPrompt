// The files that let a generated app call its own server functions: the client the screens
// import, and the helpers the server routes import. The routes themselves are written by the agent.

import type { AppPlan } from "@/lib/agent-protocol"
import type { PreviewFile } from "@/lib/preview-protocol"

/** Where the app's screens reach its server: the sandbox while testing, or the deployed app. */
export type ServerTarget = { kind: "sandbox"; projectId: string; token: string | null } | { kind: "deployed"; origin: string }

function serverConfigFile(target: ServerTarget | undefined) {
  const sandbox = target?.kind === "deployed" ? null : (target ?? { projectId: "", token: null })
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")
  const base = target?.kind === "deployed" ? target.origin.replace(/\/+$/, "") : `${appUrl}/api/apps/${sandbox!.projectId}/server`
  const token = sandbox ? (sandbox.token ?? "") : null
  return `export const SERVER_BASE_URL: string = ${JSON.stringify(base)};
export const SERVER_TOKEN: string | null = ${JSON.stringify(token)};
`
}

const SERVER_CLIENT_FILE = `import AsyncStorage from "@react-native-async-storage/async-storage";

import { SERVER_BASE_URL, SERVER_TOKEN } from "@/lib/server/config";

export type ServerErrorCode = "not_connected" | "sign_in" | "bad_request" | "unavailable" | "preview";

const CODES: string[] = ["not_connected", "sign_in", "bad_request", "unavailable", "preview"];

/** Why a server function call failed. \`service\` names the service that isn't connected yet. */
export class ServerError extends Error {
  code: ServerErrorCode;
  service?: string;

  constructor(code: ServerErrorCode, message?: string, service?: string) {
    super(message ?? code);
    this.name = "ServerError";
    this.code = code;
    this.service = service;
  }
}

const TOKEN_KEY = "app:auth:token";
const DEVICE_KEY = "app:backend:device";

/** Calls one of the app's server functions by its path, such as "/api/booking/slots", and returns its JSON answer. */
export async function callServer<T = unknown>(path: string, body?: unknown): Promise<T> {
  if (SERVER_TOKEN === "") throw new ServerError("preview");

  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  const device = await AsyncStorage.getItem(DEVICE_KEY).catch(() => null);

  let response: Response;
  try {
    response = await fetch(SERVER_BASE_URL + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SERVER_TOKEN ? { "x-appxprompt-sandbox": SERVER_TOKEN } : {}),
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(device ? { "x-device-id": device } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ServerError("unavailable");
  }

  const text = await response.text().catch(() => "");
  let data: any = null;
  let parsed = true;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      parsed = false;
    }
  }

  if (response.ok) {
    if (!parsed) throw new ServerError("unavailable");
    return data as T;
  }

  const error = parsed && data && typeof data === "object" ? data.error : null;
  if (error && typeof error.code === "string" && CODES.includes(error.code)) {
    throw new ServerError(
      error.code as ServerErrorCode,
      typeof error.message === "string" ? error.message : undefined,
      typeof error.service === "string" ? error.service : undefined
    );
  }
  throw new ServerError(response.status === 401 ? "sign_in" : "unavailable");
}
`

const RESPOND_FILE = `const STATUS = { bad_request: 400, sign_in: 401, not_connected: 503, unavailable: 503 } as const;

export type FailCode = keyof typeof STATUS;

const JSON_HEADERS = { "content-type": "application/json" };

export function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? null), { status, headers: JSON_HEADERS });
}

export function fail(code: FailCode, message: string, service?: string): Response {
  return new Response(JSON.stringify({ error: { code, message, ...(service ? { service } : {}) } }), {
    status: STATUS[code],
    headers: JSON_HEADERS,
  });
}

/** Thrown when a service the route needs hasn't been connected to the app yet. */
export class ServiceNotConnected extends Error {
  service: string;

  constructor(service: string) {
    super(service + " isn't connected.");
    this.name = "ServiceNotConnected";
    this.service = service;
  }
}

/** Thrown when a route needs a signed-in person and the request has none. */
export class SignInRequired extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "SignInRequired";
  }
}

/** Wraps a handler so what it throws becomes an answer the app understands, without any error text. */
export function withErrors<A extends unknown[]>(handler: (request: Request, ...args: A) => Promise<Response> | Response) {
  return async (request: Request, ...args: A): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof ServiceNotConnected) return fail("not_connected", error.message, error.service);
      if (error instanceof SignInRequired) return fail("sign_in", "Sign in to continue.");
      const response = new Response(JSON.stringify({ error: { code: "unavailable", message: "Something went wrong. Try again." } }), {
        status: 500,
        headers: JSON_HEADERS,
      });
      // Only the server runtime reads this, to tell the app's owner why it failed. It never reaches the app.
      Object.defineProperty(response, Symbol.for("appxprompt.thrown"), { value: error });
      return response;
    }
  };
}
`

function dataFile(plan: AppPlan) {
  const apiUrl = plan.backend ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${plan.backend.apiPath}` : null
  return `import { ServiceNotConnected, SignInRequired } from "./respond";

const API_URL: string | null = ${JSON.stringify(apiUrl)};

type Mode = { kind: "app" } | { kind: "caller"; request: Request };

export interface ServerCollection<T> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(values: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T>;
  update(id: string, changes: Partial<Omit<T, "id" | "createdAt" | "updatedAt">>): Promise<T | null>;
  remove(id: string): Promise<void>;
}

function collection<T>(mode: Mode, name: string): ServerCollection<T> {
  async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    const key = process.env.APPXPROMPT_SERVER_KEY;
    if (!API_URL || !key) throw new ServiceNotConnected("backend");

    const headers: Record<string, string> = { "x-appxprompt-server-key": key };
    if (mode.kind === "app") {
      headers["x-appxprompt-as"] = "app";
    } else {
      const authorization = mode.request.headers.get("authorization");
      const device = mode.request.headers.get("x-device-id");
      if (authorization) headers["authorization"] = authorization;
      if (device) headers["x-device-id"] = device;
    }
    if (init.body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(API_URL + "/collections/" + encodeURIComponent(name) + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 401) throw new SignInRequired();
    if (response.status === 404 && path !== "") return null;
    if (!response.ok) throw new Error("The backend answered " + response.status);
    return response.json().catch(() => null);
  }

  const one = (id: string) => "/" + encodeURIComponent(id);

  return {
    async list() {
      const data = await call("");
      return (data?.items ?? []) as T[];
    },
    async get(id) {
      return (await call(one(id))) as T | null;
    },
    async insert(values) {
      return (await call("", { method: "POST", body: values })) as T;
    },
    async update(id, changes) {
      return (await call(one(id), { method: "PATCH", body: changes })) as T | null;
    },
    async remove(id) {
      await call(one(id), { method: "DELETE" });
    },
  };
}

export const data = {
  /** The app's records as the person who made the request sees them. */
  asCaller(request: Request) {
    return { collection: <T = Record<string, unknown>>(name: string) => collection<T>({ kind: "caller", request }, name) };
  },
  /** Every record of the app, whoever owns it. Use it only for what the app itself does. */
  asApp() {
    return { collection: <T = Record<string, unknown>>(name: string) => collection<T>({ kind: "app" }, name) };
  },
};
`
}

function authFile(plan: AppPlan) {
  const authUrl = plan.backend?.authUrl ?? null
  const authKey = plan.backend?.authKey ?? null
  return `import { SignInRequired } from "./respond";

const AUTH_URL: string | null = ${JSON.stringify(authUrl)};
const AUTH_KEY: string | null = ${JSON.stringify(authKey)};

export type Caller = { id: string; email: string; name: string };

/** Who sent the request, or null when nobody is signed in. It only throws when sign-in itself is down. */
export async function getCaller(request: Request): Promise<Caller | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!token || !AUTH_URL || !AUTH_KEY) return null;

  const response = await fetch(AUTH_URL + "/get-session", {
    headers: { authorization: "Bearer " + token, "x-api-key": AUTH_KEY },
  });
  if (response.status >= 500) throw new Error("Sign-in answered " + response.status);
  if (!response.ok) return null;

  const session = await response.json().catch(() => null);
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name || String(user.email).split("@")[0] };
}

/** The signed-in person, or a sign-in request for the app to show. */
export async function requireCaller(request: Request): Promise<Caller> {
  const caller = await getCaller(request);
  if (!caller) throw new SignInRequired();
  return caller;
}
`
}

/** lib/server/config.ts and lib/server/index.ts, which the screens call through. */
export function serverClientFiles(target: ServerTarget | undefined): PreviewFile[] {
  return [
    { path: "lib/server/config.ts", code: serverConfigFile(target) },
    { path: "lib/server/index.ts", code: SERVER_CLIENT_FILE },
  ]
}

/** The helpers every server route may import. None without server routes. */
export function generatedServerFiles(plan: AppPlan | null): PreviewFile[] {
  if (!plan?.serverRoutes?.length) return []
  return [
    { path: "server/auth.ts", code: authFile(plan) },
    { path: "server/data.ts", code: dataFile(plan) },
    { path: "server/respond.ts", code: RESPOND_FILE },
  ]
}
