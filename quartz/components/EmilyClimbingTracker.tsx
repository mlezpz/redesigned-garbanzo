import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import style from "./styles/emilyClimbingTracker.scss"
// @ts-ignore
import script from "./scripts/emilyClimbingTracker.inline"

type GymLocation = {
  id: string
  name: string
  area?: string
  lat: number | null
  lng: number | null
  color: string
}

const fallbackColors = ["#284b63", "#84a59d", "#d17b49", "#7c6a9b", "#c8553d", "#3c6e71"]

function normalizeGymId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const color = value.trim()
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color) ? color : fallback
}

function coerceCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function coerceGyms(value: unknown): GymLocation[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) return []

    const gym = entry as Record<string, unknown>
    const name = typeof gym.name === "string" ? gym.name.trim() : ""
    if (name.length === 0) return []

    const fallbackColor = fallbackColors[index % fallbackColors.length]
    const idSource = typeof gym.id === "string" && gym.id.trim().length > 0 ? gym.id : name

    return [
      {
        id: normalizeGymId(idSource),
        name,
        area:
          typeof gym.area === "string" && gym.area.trim().length > 0 ? gym.area.trim() : undefined,
        lat: coerceCoordinate(gym.lat),
        lng: coerceCoordinate(gym.lng),
        color: sanitizeColor(gym.color, fallbackColor),
      },
    ]
  })
}

export default (() => {
  const EmilyClimbingTracker: QuartzComponent = ({
    displayClass,
    fileData,
  }: QuartzComponentProps) => {
    if (fileData.slug !== "where-is-emily-climbing") {
      return <></>
    }

    const gyms = coerceGyms(fileData.frontmatter?.gyms)
    const trackerConfig = {
      gyms,
      apiBase: "/api/climbing",
      loginPath: "/login",
      timezone: "America/Los_Angeles",
    }

    return (
      <section class={classNames(displayClass, "emily-climbing-tracker")}>
        <div class="emily-climbing-app" data-config={JSON.stringify(trackerConfig)}>
          <p class="emily-climbing-loading">Loading climbing tracker...</p>
        </div>
      </section>
    )
  }

  EmilyClimbingTracker.css = style
  EmilyClimbingTracker.afterDOMLoaded = script

  return EmilyClimbingTracker
}) satisfies QuartzComponentConstructor
