type GymLocation = {
  id: string
  name: string
  area?: string
  lat: number | null
  lng: number | null
  color: string
}

type TrackerConfig = {
  gyms: GymLocation[]
  apiBase: string
  loginPath: string
  timezone: string
}

type VisitRecord = {
  dateKey: string
  gymId: string
  gymName: string
  lat: number | null
  lng: number | null
  updatedAt: string
}

type AggregatedGym = {
  gymId: string
  gymName: string
  count: number
  color: string
  lat: number | null
  lng: number | null
}

type TrackerResponse = {
  todayKey: string
  currentVisit: VisitRecord | null
  history: VisitRecord[]
}

type SessionResponse = {
  authenticated: boolean
  email: string | null
}

type TrackerUiState = {
  data: TrackerResponse | null
  session: SessionResponse
  isLoading: boolean
  isSaving: boolean
  errorMessage: string | null
}

const pacificTimeZone = "America/Los_Angeles"
const pacificDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: pacificTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
const pacificTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: pacificTimeZone,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
})
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
})
const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  dateStyle: "full",
})

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function normalizeGymId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function getPacificDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = pacificDateKeyFormatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<
    string,
    string
  >
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
  }
}

function getPacificDateKey(date: Date = new Date()): string {
  const { year, month, day } = getPacificDateParts(date)
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function toUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10))
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function formatDateKey(dateKey: string): string {
  return monthFormatter.format(toUtcDate(dateKey))
}

function formatFullDateKey(dateKey: string): string {
  return fullDateFormatter.format(toUtcDate(dateKey))
}

function formatPacificTimestamp(isoTimestamp: string): string {
  return `${pacificTimeFormatter.format(new Date(isoTimestamp))} PST`
}

function isVisitRecord(value: unknown): value is VisitRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.dateKey === "string" &&
    typeof record.gymId === "string" &&
    typeof record.gymName === "string" &&
    typeof record.updatedAt === "string" &&
    (record.lat === null || typeof record.lat === "number") &&
    (record.lng === null || typeof record.lng === "number")
  )
}

function normalizeTrackerResponse(payload: unknown): TrackerResponse {
  const fallbackTodayKey = getPacificDateKey()
  const data =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
  const history = Array.isArray(data.history)
    ? data.history
        .filter(isVisitRecord)
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    : []
  const todayKey =
    typeof data.todayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.todayKey)
      ? data.todayKey
      : fallbackTodayKey
  const currentVisit = isVisitRecord(data.currentVisit)
    ? data.currentVisit
    : (history.find((visit) => visit.dateKey === todayKey) ?? null)

  return {
    todayKey,
    currentVisit,
    history,
  }
}

function normalizeSessionResponse(payload: unknown): SessionResponse {
  const data =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
  return {
    authenticated: data.authenticated === true,
    email: typeof data.email === "string" ? data.email : null,
  }
}

function getStartDateKey(data: TrackerResponse | null): string {
  if (!data || data.history.length === 0) {
    return data?.todayKey ?? getPacificDateKey()
  }

  return data.history[0].dateKey
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`
    throw new Error(message)
  }

  return payload as T
}

async function fetchTrackerState(config: TrackerConfig): Promise<TrackerResponse> {
  const response = await fetch(config.apiBase, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
  })

  return normalizeTrackerResponse(await parseApiResponse<unknown>(response))
}

async function fetchSessionState(): Promise<SessionResponse> {
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
  })

  return normalizeSessionResponse(await parseApiResponse<unknown>(response))
}

async function saveTodayVisit(
  config: TrackerConfig,
  visit: Pick<VisitRecord, "gymId" | "gymName" | "lat" | "lng">,
): Promise<TrackerResponse> {
  const response = await fetch(`${config.apiBase}/today`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(visit),
  })

  return normalizeTrackerResponse(await parseApiResponse<unknown>(response))
}

async function clearTodayVisit(config: TrackerConfig): Promise<TrackerResponse> {
  const response = await fetch(`${config.apiBase}/today`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
  })

  return normalizeTrackerResponse(await parseApiResponse<unknown>(response))
}

function findGymById(config: TrackerConfig, gymId: string): GymLocation | undefined {
  return config.gyms.find((gym) => gym.id === gymId)
}

function findGymByName(config: TrackerConfig, gymName: string): GymLocation | undefined {
  const normalizedName = gymName.trim().toLowerCase()
  return config.gyms.find((gym) => gym.name.trim().toLowerCase() === normalizedName)
}

function buildCustomGymRecord(
  config: TrackerConfig,
  gymName: string,
): Pick<VisitRecord, "gymId" | "gymName" | "lat" | "lng"> {
  const configuredGym = findGymByName(config, gymName)
  if (configuredGym) {
    return {
      gymId: configuredGym.id,
      gymName: configuredGym.name,
      lat: configuredGym.lat,
      lng: configuredGym.lng,
    }
  }

  return {
    gymId: `custom-${normalizeGymId(gymName)}`,
    gymName: gymName.trim(),
    lat: null,
    lng: null,
  }
}

function aggregateVisits(config: TrackerConfig, history: VisitRecord[]): AggregatedGym[] {
  const gyms = new Map<string, AggregatedGym>()

  for (const record of history) {
    const configuredGym = findGymById(config, record.gymId) ?? findGymByName(config, record.gymName)
    const key = configuredGym?.id ?? record.gymId
    const existing = gyms.get(key)
    const color = configuredGym?.color ?? existing?.color ?? "#3c6e71"
    const lat = configuredGym?.lat ?? record.lat
    const lng = configuredGym?.lng ?? record.lng

    gyms.set(key, {
      gymId: key,
      gymName: configuredGym?.name ?? record.gymName,
      count: (existing?.count ?? 0) + 1,
      color,
      lat,
      lng,
    })
  }

  return [...gyms.values()].sort(
    (left, right) => right.count - left.count || left.gymName.localeCompare(right.gymName),
  )
}

function renderPieChart(aggregatedGyms: AggregatedGym[]): { chartStyle: string; legend: string } {
  if (aggregatedGyms.length === 0) {
    return {
      chartStyle: "background: conic-gradient(var(--lightgray) 0% 100%);",
      legend: '<p class="emily-climbing-empty">No gym visits yet.</p>',
    }
  }

  const total = aggregatedGyms.reduce((sum, gym) => sum + gym.count, 0)
  let cursor = 0
  const segments: string[] = []
  const legend = aggregatedGyms
    .map((gym) => {
      const percentage = (gym.count / total) * 100
      const start = cursor
      const end = cursor + percentage
      cursor = end
      segments.push(`${gym.color} ${start}% ${end}%`)
      return `<li>
        <span class="emily-climbing-legend-swatch" style="background:${gym.color};"></span>
        <span>${escapeHtml(gym.gymName)}</span>
        <strong>${gym.count}</strong>
      </li>`
    })
    .join("")

  return {
    chartStyle: `background: conic-gradient(${segments.join(", ")});`,
    legend: `<ul class="emily-climbing-legend">${legend}</ul>`,
  }
}

function renderGymMap(aggregatedGyms: AggregatedGym[]): string {
  const plottedGyms = aggregatedGyms.filter(
    (gym) => typeof gym.lat === "number" && typeof gym.lng === "number",
  )

  if (plottedGyms.length === 0) {
    return '<p class="emily-climbing-empty">Add latitude and longitude in the page frontmatter to plot gyms on the map.</p>'
  }

  const width = Math.max(920, plottedGyms.length * 180)
  const height = 440
  const padding = 64
  const latitudes = plottedGyms.map((gym) => gym.lat as number)
  const longitudes = plottedGyms.map((gym) => gym.lng as number)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes)
  const maxLng = Math.max(...longitudes)
  const latRange = Math.max(maxLat - minLat, 0.01)
  const lngRange = Math.max(maxLng - minLng, 0.01)

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    const x = padding + ratio * (width - padding * 2)
    const y = padding + ratio * (height - padding * 2)
    return `
      <line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" class="grid-line" />
      <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" class="grid-line" />
    `
  }).join("")

  const bubbles = plottedGyms
    .map((gym) => {
      const x = padding + (((gym.lng as number) - minLng) / lngRange) * (width - padding * 2)
      const y =
        height - padding - (((gym.lat as number) - minLat) / latRange) * (height - padding * 2)
      const radius = 18 + Math.sqrt(gym.count) * 10
      return `
        <g class="map-point">
          <circle cx="${x}" cy="${y}" r="${radius}" fill="${gym.color}" fill-opacity="0.78" />
          <circle cx="${x}" cy="${y}" r="${Math.max(radius - 10, 8)}" fill="rgba(255,255,255,0.18)" />
          <text x="${x}" y="${y + 5}" text-anchor="middle" class="count-label">${gym.count}</text>
          <text x="${x}" y="${y - radius - 12}" text-anchor="middle" class="gym-label">${escapeHtml(gym.gymName)}</text>
        </g>
      `
    })
    .join("")

  return `
    <div class="emily-climbing-map-scroll">
      <svg viewBox="0 0 ${width} ${height}" class="emily-climbing-map" role="img" aria-label="Map of gym visits">
        <rect x="0" y="0" width="${width}" height="${height}" rx="28" class="map-bg" />
        ${gridLines}
        <rect x="${padding}" y="${padding}" width="${width - padding * 2}" height="${height - padding * 2}" class="map-frame" />
        ${bubbles}
      </svg>
    </div>
  `
}

function renderHistory(history: VisitRecord[]): string {
  if (history.length === 0) {
    return '<p class="emily-climbing-empty">No gym history yet.</p>'
  }

  const items = [...history]
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey))
    .map(
      (record) => `<li>
        <div>
          <strong>${escapeHtml(record.gymName)}</strong>
          <span>${formatDateKey(record.dateKey)}</span>
        </div>
        <span>${formatPacificTimestamp(record.updatedAt)}</span>
      </li>`,
    )
    .join("")

  return `<ul class="emily-climbing-history-list">${items}</ul>`
}

function renderTracker(container: HTMLElement, config: TrackerConfig, uiState: TrackerUiState) {
  const trackerState = uiState.data
  const todayKey = trackerState?.todayKey ?? getPacificDateKey()
  const todayRecord = trackerState?.currentVisit ?? null
  const currentGym = todayRecord ? findGymById(config, todayRecord.gymId) : undefined
  const history = trackerState?.history ?? []
  const aggregatedGyms = aggregateVisits(config, history)
  const pieChart = renderPieChart(aggregatedGyms)
  const totalVisits = history.length
  const uniqueGyms = aggregatedGyms.length
  const currentStatus = todayRecord ? todayRecord.gymName : "TBD"
  const lastUpdated = todayRecord ? formatPacificTimestamp(todayRecord.updatedAt) : null
  const writeDisabled = !uiState.session.authenticated || uiState.isSaving
  const startDateKey = getStartDateKey(trackerState)
  const nextPath = `${location.pathname}${location.search}`
  const loginHref = `${config.loginPath}?next=${encodeURIComponent(nextPath)}`
  const logoutHref = `/logout?next=${encodeURIComponent(nextPath)}`

  container.dataset.dayKey = todayKey
  container.innerHTML = `
    <div class="emily-climbing-shell">
      <section class="emily-climbing-hero">
        <div>
          <p class="eyebrow">Where is Emily climbing?</p>
          <h2>${escapeHtml(formatFullDateKey(todayKey))}</h2>
          <p class="status-line">
            <span class="status-label">Today:</span>
            <strong>${escapeHtml(currentStatus)}</strong>
          </p>
          ${lastUpdated ? `<p class="timestamp">Last updated at ${escapeHtml(lastUpdated)}</p>` : '<p class="timestamp muted">No gym chosen yet.</p>'}
          <p class="storage-note">This page reads from a shared backend and resets the current pick at Pacific midnight for everyone.</p>
        </div>
        <div class="emily-climbing-controls">
          <p class="tracker-message ${uiState.session.authenticated ? "" : "error"}">
            ${
              uiState.session.authenticated
                ? `Signed in as <strong>${escapeHtml(uiState.session.email ?? "Google user")}</strong>. <a class="login-link" href="${escapeHtml(logoutHref)}">Log out</a>`
                : `You are in read-only mode. <a class="login-link" href="${escapeHtml(loginHref)}">Log in with Google</a> to update today's gym.`
            }
          </p>
          ${uiState.errorMessage ? `<p class="tracker-message error">${escapeHtml(uiState.errorMessage)}</p>` : ""}
          ${uiState.isLoading && !trackerState ? '<p class="tracker-message">Loading shared climbing data...</p>' : ""}
          ${uiState.isSaving ? '<p class="tracker-message">Saving shared update...</p>' : ""}
          <fieldset class="write-controls${uiState.session.authenticated ? "" : " is-readonly"}">
            <div class="gym-button-grid">
              ${config.gyms
                .map(
                  (gym) => `<button
                    type="button"
                    class="gym-choice${todayRecord?.gymId === gym.id ? " is-active" : ""}"
                    data-gym-id="${escapeHtml(gym.id)}"
                    style="--gym-color:${gym.color};"
                    ${writeDisabled ? "disabled" : ""}
                  >
                    <span>${escapeHtml(gym.name)}</span>
                    ${gym.area ? `<small>${escapeHtml(gym.area)}</small>` : ""}
                  </button>`,
                )
                .join("")}
            </div>
            <form class="custom-gym-form">
              <label for="custom-gym-name">Or choose a different gym</label>
              <div class="custom-gym-row">
                <input id="custom-gym-name" name="customGymName" type="text" placeholder="Enter gym name" ${writeDisabled ? "disabled" : ""} />
                <button type="submit" ${writeDisabled ? "disabled" : ""}>Save</button>
              </div>
            </form>
            <button type="button" class="clear-choice" ${writeDisabled ? "disabled" : ""}>Set today to TBD</button>
          </fieldset>
        </div>
      </section>

      <section class="emily-climbing-metrics">
        <article class="metric-card">
          <p>Total visits</p>
          <strong>${totalVisits}</strong>
          <span>Since ${escapeHtml(formatDateKey(startDateKey))}</span>
        </article>
        <article class="metric-card">
          <p>Unique gyms</p>
          <strong>${uniqueGyms}</strong>
          <span>${uniqueGyms === 1 ? "One wall in the mix" : "Different places climbed"}</span>
        </article>
        <article class="metric-card emphasis">
          <p>Current pick</p>
          <strong>${escapeHtml(currentStatus)}</strong>
          <span>${currentGym?.area ? escapeHtml(currentGym.area) : todayRecord ? "Custom gym" : "Waiting on a plan"}</span>
        </article>
      </section>

      <section class="emily-climbing-dashboard-grid">
        <article class="dashboard-card pie-card">
          <div class="section-heading">
            <h3>Gym visits</h3>
            <p>Share of all tracked days</p>
          </div>
          <div class="pie-layout">
            <div class="emily-climbing-pie" style="${pieChart.chartStyle}">
              <div class="emily-climbing-pie-hole">
                <strong>${totalVisits}</strong>
                <span>days</span>
              </div>
            </div>
            ${pieChart.legend}
          </div>
        </article>

        <article class="dashboard-card map-card">
          <div class="section-heading">
            <h3>Gym map</h3>
            <p>Scrollable pins sized by visit count</p>
          </div>
          ${renderGymMap(aggregatedGyms)}
        </article>
      </section>

      <section class="dashboard-card history-card">
        <div class="section-heading">
          <h3>History</h3>
          <p>Most recent climbing days first</p>
        </div>
        ${renderHistory(history)}
      </section>
    </div>
  `
}

function parseConfig(container: HTMLElement): TrackerConfig | null {
  const raw = container.dataset.config
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<TrackerConfig>
    return {
      gyms: Array.isArray(parsed.gyms) ? parsed.gyms : [],
      apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : "/api/climbing",
      loginPath: typeof parsed.loginPath === "string" ? parsed.loginPath : "/login",
      timezone: typeof parsed.timezone === "string" ? parsed.timezone : pacificTimeZone,
    }
  } catch {
    return null
  }
}

function attachTracker(container: HTMLElement) {
  const config = parseConfig(container)
  if (!config) return

  const uiState: TrackerUiState = {
    data: null,
    session: {
      authenticated: false,
      email: null,
    },
    isLoading: false,
    isSaving: false,
    errorMessage: null,
  }

  const render = () => renderTracker(container, config, uiState)

  const refreshSession = async () => {
    try {
      uiState.session = await fetchSessionState()
    } catch {
      uiState.session = { authenticated: false, email: null }
    }
  }

  const refreshData = async (showLoading: boolean) => {
    uiState.isLoading = showLoading
    if (showLoading) {
      render()
    }

    try {
      uiState.data = await fetchTrackerState(config)
      uiState.errorMessage = null
    } catch (error) {
      uiState.errorMessage =
        error instanceof Error ? error.message : "Unable to load climbing data."
    } finally {
      uiState.isLoading = false
      render()
    }
  }

  const mutate = async (task: () => Promise<TrackerResponse>) => {
    if (!uiState.session.authenticated) {
      const loginHref = `${config.loginPath}?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`
      uiState.errorMessage = `Please log in first: ${loginHref}`
      render()
      return
    }

    uiState.isSaving = true
    uiState.errorMessage = null
    render()

    try {
      uiState.data = await task()
    } catch (error) {
      uiState.errorMessage =
        error instanceof Error ? error.message : "Unable to save climbing update."
      if ((uiState.errorMessage || "").toLowerCase().includes("unauthorized")) {
        uiState.session = { authenticated: false, email: null }
      }
    } finally {
      uiState.isSaving = false
      render()
    }
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const gymButton = target.closest<HTMLElement>("[data-gym-id]")
    if (gymButton) {
      const gymId = gymButton.dataset.gymId
      const gym = gymId ? findGymById(config, gymId) : undefined
      if (gym) {
        void mutate(() =>
          saveTodayVisit(config, {
            gymId: gym.id,
            gymName: gym.name,
            lat: gym.lat,
            lng: gym.lng,
          }),
        )
      }
      return
    }

    if (target.closest(".clear-choice")) {
      void mutate(() => clearTodayVisit(config))
    }
  }

  const onSubmit = (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement | null
    if (!form || !form.classList.contains("custom-gym-form")) return
    event.preventDefault()

    const input = form.elements.namedItem("customGymName") as HTMLInputElement | null
    const gymName = input?.value.trim() ?? ""
    if (gymName.length === 0) return

    const customGym = buildCustomGymRecord(config, gymName)
    void mutate(() => saveTodayVisit(config, customGym))
    form.reset()
  }

  const refreshAll = async (showLoading: boolean) => {
    await refreshSession()
    await refreshData(showLoading)
  }

  const resetCheck = window.setInterval(() => {
    void refreshAll(false)
  }, 30_000)

  container.addEventListener("click", onClick)
  container.addEventListener("submit", onSubmit)
  window.addCleanup(() => container.removeEventListener("click", onClick))
  window.addCleanup(() => container.removeEventListener("submit", onSubmit))
  window.addCleanup(() => window.clearInterval(resetCheck))

  render()
  void refreshAll(true)
}

document.addEventListener("nav", () => {
  const trackers = document.querySelectorAll(".emily-climbing-app")
  trackers.forEach((tracker) => attachTracker(tracker as HTMLElement))
})
