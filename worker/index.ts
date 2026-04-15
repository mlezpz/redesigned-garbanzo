type VisitRecord = {
  dateKey: string
  gymId: string
  gymName: string
  lat: number | null
  lng: number | null
  updatedAt: string
}

type TrackerResponse = {
  todayKey: string
  currentVisit: VisitRecord | null
  history: VisitRecord[]
}

type MutationPayload = {
  gymId: string
  gymName: string
  lat: number | null
  lng: number | null
}

type VisitRow = {
  dateKey: string
  gymId: string
  gymName: string
  lat: number | null
  lng: number | null
  updatedAt: string
}

type SessionUser = {
  sub: string
  email: string
  name?: string
  picture?: string
  exp: number
}

type GoogleTokenInfo = {
  aud: string
  sub: string
  email?: string
  email_verified?: string
  name?: string
  picture?: string
  hd?: string
}

interface AssetBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

type Env = {
  ASSETS: AssetBinding
  CLIMBING_DB: D1Database
  CLIMBING_ADMIN_TOKEN?: string
  GOOGLE_CLIENT_ID?: string
  SITE_SESSION_SECRET?: string
  GOOGLE_HOSTED_DOMAIN?: string
  ALLOWED_GOOGLE_EMAILS?: string
  PROTECTED_PATHS?: string
}

const pacificDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
const sessionCookieName = "site_session"
const loginNextCookieName = "login_next"
const sessionDurationSeconds = 60 * 60 * 24 * 30
const loginNextCookieMaxAgeSeconds = 60 * 10
const textEncoder = new TextEncoder()

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return new Response(JSON.stringify(data), { ...init, headers })
}

function getPacificDateKey(date: Date = new Date()): string {
  const parts = pacificDateKeyFormatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<
    string,
    string
  >
  return `${lookup.year}-${lookup.month}-${lookup.day}`
}

function isValidDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function parseAuthorizationToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim() || null
  }

  const directToken = request.headers.get("x-admin-token")
  return directToken?.trim() || null
}

function normalizeVisitRow(row: VisitRow): VisitRecord | null {
  if (
    !isValidDayKey(row.dateKey) ||
    typeof row.gymId !== "string" ||
    typeof row.gymName !== "string" ||
    typeof row.updatedAt !== "string" ||
    !isNullableNumber(row.lat) ||
    !isNullableNumber(row.lng)
  ) {
    return null
  }

  return {
    dateKey: row.dateKey,
    gymId: row.gymId,
    gymName: row.gymName,
    lat: row.lat,
    lng: row.lng,
    updatedAt: row.updatedAt,
  }
}

async function readTrackerState(env: Env): Promise<TrackerResponse> {
  const todayKey = getPacificDateKey()
  const { results } = await env.CLIMBING_DB.prepare(
    `SELECT
      day_key AS dateKey,
      gym_id AS gymId,
      gym_name AS gymName,
      lat,
      lng,
      updated_at AS updatedAt
    FROM climbing_visits
    ORDER BY day_key ASC`,
  ).all<VisitRow>()

  const history = results.flatMap((row) => {
    const visit = normalizeVisitRow(row)
    return visit ? [visit] : []
  })

  return {
    todayKey,
    currentVisit: history.find((visit) => visit.dateKey === todayKey) ?? null,
    history,
  }
}

async function parseMutationPayload(request: Request): Promise<MutationPayload | Response> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return json({ error: "Request body must be an object." }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const gymId = typeof payload.gymId === "string" ? payload.gymId.trim() : ""
  const gymName = typeof payload.gymName === "string" ? payload.gymName.trim() : ""
  const lat = payload.lat
  const lng = payload.lng

  if (gymId.length === 0 || gymName.length === 0) {
    return json({ error: "gymId and gymName are required." }, { status: 400 })
  }

  if (!isNullableNumber(lat) || !isNullableNumber(lng)) {
    return json({ error: "lat and lng must be numbers or null." }, { status: 400 })
  }

  return {
    gymId,
    gymName,
    lat,
    lng,
  }
}

function parseCookies(request: Request): Map<string, string> {
  const rawCookie = request.headers.get("cookie") ?? ""
  const cookies = new Map<string, string>()

  for (const chunk of rawCookie.split(";")) {
    const [rawKey, ...rest] = chunk.split("=")
    const key = rawKey?.trim()
    if (!key || rest.length === 0) continue
    cookies.set(key, rest.join("=").trim())
  }

  return cookies
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message))
  return toBase64Url(new Uint8Array(signature))
}

async function createSessionToken(user: SessionUser, secret: string): Promise<string> {
  const payload = toBase64Url(textEncoder.encode(JSON.stringify(user)))
  const signature = await hmacSha256(secret, payload)
  return `${payload}.${signature}`
}

async function verifySessionToken(token: string, secret: string): Promise<SessionUser | null> {
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null

  const expectedSignature = await hmacSha256(secret, payload)
  if (!timingSafeEqual(expectedSignature, signature)) return null

  try {
    const decoded = new TextDecoder().decode(fromBase64Url(payload))
    const parsed = JSON.parse(decoded) as Partial<SessionUser>
    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null
    }

    if (parsed.exp <= Math.floor(Date.now() / 1000)) {
      return null
    }

    return {
      sub: parsed.sub,
      email: parsed.email,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      picture: typeof parsed.picture === "string" ? parsed.picture : undefined,
      exp: parsed.exp,
    }
  } catch {
    return null
  }
}

async function getAuthenticatedUser(request: Request, env: Env): Promise<SessionUser | null> {
  if (!env.SITE_SESSION_SECRET) return null
  const cookies = parseCookies(request)
  const token = cookies.get(sessionCookieName)
  if (!token) return null
  return verifySessionToken(token, env.SITE_SESSION_SECRET)
}

function normalizePathname(pathname: string): string {
  let normalized = pathname.trim()
  if (normalized.length === 0) return "/"

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`
  }

  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  if (normalized.endsWith(".html")) {
    normalized = normalized.slice(0, -5)
    if (normalized.length === 0) normalized = "/"
  }

  return normalized
}

function getProtectedRules(env: Env): string[] {
  const raw = env.PROTECTED_PATHS
  if (!raw) return []

  return raw
    .split(",")
    .map((item) => normalizePathname(item))
    .filter((item) => item.length > 0)
}

function isPathProtected(pathname: string, rules: string[]): boolean {
  const current = normalizePathname(pathname)

  for (const rule of rules) {
    if (rule.endsWith("/*")) {
      const prefix = rule.slice(0, -1)
      if (current.startsWith(prefix)) return true
      continue
    }

    if (current === rule) return true
  }

  return false
}

function isAssetPath(pathname: string): boolean {
  return /\.[a-zA-Z0-9]{1,8}$/.test(pathname)
}

function getSafeNextPath(nextValue: string | null, fallback = "/"): string {
  if (!nextValue || nextValue.length === 0) return fallback
  if (!nextValue.startsWith("/")) return fallback
  if (nextValue.startsWith("//")) return fallback
  return nextValue
}

function redirect(to: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("location", to)
  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  })
}

function buildCookie(request: Request, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:"
  const secureAttr = secure ? "; Secure" : ""
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureAttr}`
}

function clearSessionCookie(request: Request): string {
  return buildCookie(request, "", 0)
}

function buildLoginNextCookie(request: Request, nextPath: string): string {
  const secure = new URL(request.url).protocol === "https:"
  const secureAttr = secure ? "; Secure" : ""
  const encodedPath = toBase64Url(textEncoder.encode(nextPath))
  return `${loginNextCookieName}=${encodedPath}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${loginNextCookieMaxAgeSeconds}${secureAttr}`
}

function clearLoginNextCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:"
  const secureAttr = secure ? "; Secure" : ""
  return `${loginNextCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttr}`
}

function getLoginNextPath(request: Request): string {
  const encoded = parseCookies(request).get(loginNextCookieName)
  if (!encoded) return "/"

  try {
    const decoded = new TextDecoder().decode(fromBase64Url(encoded))
    return getSafeNextPath(decoded, "/")
  } catch {
    return "/"
  }
}

function isAllowedEmail(email: string, env: Env): boolean {
  const allowlist = env.ALLOWED_GOOGLE_EMAILS?.trim()
  if (!allowlist) return true

  const allowedEmails = new Set(
    allowlist
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  )

  return allowedEmails.has(email.toLowerCase())
}

async function verifyGoogleCredential(credential: string, env: Env): Promise<SessionUser | null> {
  if (!env.GOOGLE_CLIENT_ID) return null

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  )

  if (!response.ok) {
    return null
  }

  const tokenInfo = (await response.json()) as Partial<GoogleTokenInfo>
  if (tokenInfo.aud !== env.GOOGLE_CLIENT_ID) return null
  if (!tokenInfo.sub || !tokenInfo.email) return null
  if (tokenInfo.email_verified !== "true") return null

  const requiredDomain = env.GOOGLE_HOSTED_DOMAIN?.trim()
  if (requiredDomain && tokenInfo.hd !== requiredDomain) return null
  if (!isAllowedEmail(tokenInfo.email, env)) return null

  return {
    sub: tokenInfo.sub,
    email: tokenInfo.email,
    name: tokenInfo.name,
    picture: tokenInfo.picture,
    exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
  }
}

function loginPageHtml(clientId: string, origin: string, errorMessage?: string): string {
  const safeClientId = clientId.replaceAll('"', "&quot;")
  const safeOrigin = origin.replace(/\/$/, "").replaceAll('"', "&quot;")
  const safeLoginUri = `${safeOrigin}/auth/google`
  const error =
    errorMessage && errorMessage.length > 0
      ? `<p class="error">${errorMessage.replaceAll("<", "&lt;")}</p>`
      : ""

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Login</title>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        background: radial-gradient(circle at 20% 10%, rgba(40,75,99,0.15), transparent 40%),
          radial-gradient(circle at 80% 90%, rgba(132,165,157,0.18), transparent 45%);
      }
      .card {
        width: min(430px, calc(100vw - 2rem));
        border: 1px solid rgba(120, 120, 120, 0.3);
        border-radius: 16px;
        padding: 1.2rem;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(6px);
      }
      h1 { margin: 0 0 0.6rem; }
      p { margin: 0.2rem 0 0.95rem; opacity: 0.85; }
      .error { margin: 0 0 0.9rem; color: #b02a16; font-weight: 700; }
      .signin { display: flex; justify-content: center; min-height: 44px; }
      .signin-status {
        margin-top: 0.85rem;
        font-size: 0.92rem;
        color: #6b1f14;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Sign In</h1>
      <p>Use Google to continue to the protected page.</p>
      ${error}
      <div class="signin">
        <div id="signin-button"></div>
      </div>
      <p id="signin-status" class="signin-status" hidden></p>
    </main>
    <script>
      ;(() => {
        const clientId = "${safeClientId}"
        const loginUri = "${safeLoginUri}"
        const buttonContainer = document.getElementById("signin-button")
        const statusEl = document.getElementById("signin-status")

        const showError = (message) => {
          if (!statusEl) return
          statusEl.textContent = message
          statusEl.hidden = false
        }

        const renderButton = () => {
          const googleApi = window.google
          if (!googleApi?.accounts?.id || !buttonContainer) {
            showError(
              "Google Sign-In could not load. Disable content blockers and allow accounts.google.com, then refresh.",
            )
            return
          }

          try {
            googleApi.accounts.id.initialize({
              client_id: clientId,
              ux_mode: "redirect",
              login_uri: loginUri,
              auto_select: false,
              itp_support: true,
            })
            googleApi.accounts.id.renderButton(buttonContainer, {
              type: "standard",
              shape: "pill",
              theme: "outline",
              text: "continue_with",
              size: "large",
              logo_alignment: "left",
            })
          } catch {
            showError("Google Sign-In failed to initialize. Check your OAuth client configuration and refresh.")
          }
        }

        window.addEventListener("load", () => {
          setTimeout(renderButton, 0)
          setTimeout(() => {
            if (buttonContainer && buttonContainer.childElementCount === 0) {
              showError("No sign-in button was rendered. Verify that localhost is listed in your Google OAuth authorized origins.")
            }
          }, 1500)
        })
      })()
    </script>
  </body>
</html>`
}

function loginConfigErrorHtml(): string {
  return "<h1>Login is not configured.</h1><p>Set GOOGLE_CLIENT_ID and SITE_SESSION_SECRET in Worker settings.</p>"
}

function validateGoogleCsrf(request: Request, formData: FormData): boolean {
  const cookieToken = parseCookies(request).get("g_csrf_token")
  const bodyToken = (formData.get("g_csrf_token") ?? "").toString()
  return Boolean(cookieToken && bodyToken && cookieToken === bodyToken)
}

async function authorizeWrite(request: Request, env: Env): Promise<Response | null> {
  if (env.CLIMBING_ADMIN_TOKEN) {
    const token = parseAuthorizationToken(request)
    if (token && token === env.CLIMBING_ADMIN_TOKEN) {
      return null
    }
  }

  const user = await getAuthenticatedUser(request, env)
  if (user) return null

  return json({ error: "Unauthorized. Please log in with Google." }, { status: 401 })
}

async function upsertTodayVisit(request: Request, env: Env): Promise<Response> {
  const authError = await authorizeWrite(request, env)
  if (authError) return authError

  const payload = await parseMutationPayload(request)
  if (payload instanceof Response) return payload

  const todayKey = getPacificDateKey()
  const updatedAt = new Date().toISOString()

  await env.CLIMBING_DB.prepare(
    `INSERT INTO climbing_visits (day_key, gym_id, gym_name, lat, lng, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_key) DO UPDATE SET
      gym_id = excluded.gym_id,
      gym_name = excluded.gym_name,
      lat = excluded.lat,
      lng = excluded.lng,
      updated_at = excluded.updated_at`,
  )
    .bind(todayKey, payload.gymId, payload.gymName, payload.lat, payload.lng, updatedAt)
    .run()

  return json(await readTrackerState(env))
}

async function clearTodayVisit(request: Request, env: Env): Promise<Response> {
  const authError = await authorizeWrite(request, env)
  if (authError) return authError

  await env.CLIMBING_DB.prepare(`DELETE FROM climbing_visits WHERE day_key = ?`)
    .bind(getPacificDateKey())
    .run()

  return json(await readTrackerState(env))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/api/climbing" && request.method === "GET") {
      return json(await readTrackerState(env))
    }

    if (url.pathname === "/api/climbing/today" && request.method === "POST") {
      return upsertTodayVisit(request, env)
    }

    if (url.pathname === "/api/climbing/today" && request.method === "DELETE") {
      return clearTodayVisit(request, env)
    }

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const user = await getAuthenticatedUser(request, env)
      return json({ authenticated: Boolean(user), email: user?.email ?? null })
    }

    if (url.pathname === "/login" && request.method === "GET") {
      const nextPath = getSafeNextPath(url.searchParams.get("next"), "/")
      if (!env.GOOGLE_CLIENT_ID || !env.SITE_SESSION_SECRET) {
        return new Response(loginConfigErrorHtml(), {
          status: 500,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }

      const user = await getAuthenticatedUser(request, env)
      if (user) {
        return redirect(nextPath)
      }

      return new Response(loginPageHtml(env.GOOGLE_CLIENT_ID, url.origin), {
        status: 200,
        headers: (() => {
          const headers = new Headers({
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          })
          headers.append("set-cookie", buildLoginNextCookie(request, nextPath))
          return headers
        })(),
      })
    }

    if (url.pathname === "/auth/google" && request.method === "POST") {
      if (!env.GOOGLE_CLIENT_ID || !env.SITE_SESSION_SECRET) {
        return new Response("Google login is not configured.", { status: 500 })
      }

      const formData = await request.formData()
      if (!validateGoogleCsrf(request, formData)) {
        return new Response("Invalid login request (CSRF).", { status: 400 })
      }

      const credential = (formData.get("credential") ?? "").toString()
      const nextPath = getLoginNextPath(request)
      if (!credential) {
        return new Response(
          loginPageHtml(env.GOOGLE_CLIENT_ID, url.origin, "Missing credential."),
          {
            status: 400,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        )
      }

      const user = await verifyGoogleCredential(credential, env)
      if (!user) {
        return new Response(
          loginPageHtml(env.GOOGLE_CLIENT_ID, url.origin, "Google sign-in could not be verified."),
          {
            status: 401,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        )
      }

      const sessionToken = await createSessionToken(user, env.SITE_SESSION_SECRET)
      const headers = new Headers()
      headers.append("set-cookie", buildCookie(request, sessionToken, sessionDurationSeconds))
      headers.append("set-cookie", clearLoginNextCookie(request))
      return redirect(nextPath, headers)
    }

    if (
      (url.pathname === "/logout" || url.pathname === "/auth/logout") &&
      request.method === "GET"
    ) {
      return redirect("/", {
        "set-cookie": clearSessionCookie(request),
      })
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, { status: 404 })
    }

    if (request.method === "GET" && !isAssetPath(url.pathname)) {
      const protectedRules = getProtectedRules(env)
      if (protectedRules.length > 0 && isPathProtected(url.pathname, protectedRules)) {
        const user = await getAuthenticatedUser(request, env)
        if (!user) {
          const nextPath = `${url.pathname}${url.search}`
          return redirect(`/login?next=${encodeURIComponent(nextPath)}`)
        }
      }
    }

    return env.ASSETS.fetch(request)
  },
}
