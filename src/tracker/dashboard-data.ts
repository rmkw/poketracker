import { readFile } from "node:fs/promises"

export type DashboardPoint = {
  asin: string
  price: number
  currency: string
  availability: string | null
  scrapedAt: string
}

export type DashboardStats = {
  totalChecks: number
  successfulChecks: number
  failedChecks: number
  priceChanges: number
  lastCheckedAt: string | null
  lastChangedAt: string | null
  lastPrice: number | null
  lastError: string | null
}

export type DashboardData = {
  points: DashboardPoint[]
  stats: Array<DashboardStats & { asin: string }>
}

export const readDashboardData = async (
  historyFile: string,
  statsFile: string,
): Promise<DashboardData> => {
  const [historyRaw, statsRaw] = await Promise.all([
    readFile(historyFile, "utf8"),
    readFile(statsFile, "utf8").catch(() => "{}"),
  ])
  const history = JSON.parse(historyRaw) as Record<string, Omit<DashboardPoint, "asin">[]>
  const stats = JSON.parse(statsRaw) as Record<string, DashboardStats>

  return {
    points: Object.entries(history)
      .flatMap(([asin, entries]) => entries.map((entry) => ({ asin, ...entry })))
      .sort((a, b) => a.scrapedAt.localeCompare(b.scrapedAt)),
    stats: Object.entries(stats).map(([asin, values]) => ({ asin, ...values })),
  }
}
