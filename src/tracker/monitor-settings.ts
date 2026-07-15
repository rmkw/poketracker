import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type MonitorSettings = {
  checkIntervalMinutes: number
  masterActive: boolean
  enabledProducts: Record<string, boolean>
}

export const readMonitorSettings = async (
  file: string,
  fallback: MonitorSettings,
): Promise<MonitorSettings> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<MonitorSettings>
    return {
      checkIntervalMinutes: parsed.checkIntervalMinutes === 1 || parsed.checkIntervalMinutes === 5 ? parsed.checkIntervalMinutes : fallback.checkIntervalMinutes,
      masterActive: parsed.masterActive ?? fallback.masterActive,
      enabledProducts: { ...fallback.enabledProducts, ...parsed.enabledProducts },
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
