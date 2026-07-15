import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type MonitorSettings = {
  masterActive: boolean
  enabledProducts: Record<string, boolean>
  productIntervals: Record<string, number>
}

export const ALLOWED_CHECK_INTERVALS = [1, 5, 10, 30, 60] as const
export type CheckIntervalMinutes = typeof ALLOWED_CHECK_INTERVALS[number]

export const isAllowedCheckInterval = (minutes: unknown): minutes is CheckIntervalMinutes =>
  typeof minutes === "number" && ALLOWED_CHECK_INTERVALS.includes(minutes as CheckIntervalMinutes)

export const readMonitorSettings = async (
  file: string,
  fallback: MonitorSettings,
): Promise<MonitorSettings> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<MonitorSettings> & { checkIntervalMinutes?: unknown }
    const legacyInterval = isAllowedCheckInterval(parsed.checkIntervalMinutes) ? parsed.checkIntervalMinutes : null
    const productIntervals = Object.fromEntries(Object.keys(fallback.productIntervals).map((asin) => {
      const saved = parsed.productIntervals?.[asin]
      return [asin, isAllowedCheckInterval(saved) ? saved : legacyInterval ?? fallback.productIntervals[asin]]
    }))
    return {
      masterActive: parsed.masterActive ?? fallback.masterActive,
      enabledProducts: { ...fallback.enabledProducts, ...parsed.enabledProducts },
      productIntervals,
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return fallback
    throw error
  }
}

export const writeMonitorSettings = async (file: string, settings: MonitorSettings): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}
