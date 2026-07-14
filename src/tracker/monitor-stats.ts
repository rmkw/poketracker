import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type MonitorStats = {
  totalChecks: number
  successfulChecks: number
  failedChecks: number
  priceChanges: number
  lastCheckedAt: string | null
  lastChangedAt: string | null
  lastPrice: number | null
  lastError: string | null
}

type MonitorStatsStore = Record<string, MonitorStats>

const emptyStats = (): MonitorStats => ({
  totalChecks: 0,
  successfulChecks: 0,
  failedChecks: 0,
  priceChanges: 0,
  lastCheckedAt: null,
  lastChangedAt: null,
  lastPrice: null,
  lastError: null,
})

const readStore = async (file: string): Promise<MonitorStatsStore> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Las estadisticas del monitor no tienen un formato valido")
    }
    return parsed as MonitorStatsStore
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

const writeStore = async (file: string, store: MonitorStatsStore): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryFile, file)
}

export const recordSuccessfulCheck = async (
  file: string,
  asin: string,
  price: number | null,
  priceChanged: boolean,
  checkedAt: string,
): Promise<void> => {
  const store = await readStore(file)
  const stats = store[asin] ?? emptyStats()
  stats.totalChecks += 1
  stats.successfulChecks += 1
  stats.lastCheckedAt = checkedAt
  stats.lastPrice = price
  stats.lastError = null
  if (priceChanged) {
    stats.priceChanges += 1
    stats.lastChangedAt = checkedAt
  }
  store[asin] = stats
  await writeStore(file, store)
}

export const recordFailedCheck = async (
  file: string,
  asin: string,
  error: string,
  checkedAt: string,
): Promise<void> => {
  const store = await readStore(file)
  const stats = store[asin] ?? emptyStats()
  stats.totalChecks += 1
  stats.failedChecks += 1
  stats.lastCheckedAt = checkedAt
  stats.lastError = error
  store[asin] = stats
  await writeStore(file, store)
}
