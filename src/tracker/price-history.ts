import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type PriceHistoryEntry = {
  price: number
  currency: string
  seller: string | null
  shipper: string | null
  availability: string | null
  isAvailable: boolean
  hasPurchaseSignal: boolean
  scrapedAt: string
}

export type PriceHistorySummary = {
  previousPrice: number | null
  lowestPrice: number | null
  recent: PriceHistoryEntry[]
}

type PriceHistoryStore = Record<string, PriceHistoryEntry[]>

const emptySummary: PriceHistorySummary = {
  previousPrice: null,
  lowestPrice: null,
  recent: [],
}

const readStore = async (file: string): Promise<PriceHistoryStore> => {
  try {
    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw) as unknown

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("El historial de precios no tiene un formato válido")
    }

    return parsed as PriceHistoryStore
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

const writeStore = async (
  file: string,
  store: PriceHistoryStore,
): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporaryFile, file)
}

const buildSummary = (entries: PriceHistoryEntry[]): PriceHistorySummary => ({
  previousPrice: entries.at(-2)?.price ?? null,
  lowestPrice:
    entries.length > 0 ? Math.min(...entries.map((entry) => entry.price)) : null,
  recent: entries.slice(-3),
})

export const recordPriceChange = async (
  file: string,
  asin: string,
  entry: PriceHistoryEntry,
  limit: number,
): Promise<PriceHistorySummary> => {
  const store = await readStore(file)
  const entries = store[asin] ?? []
  const previous = entries.at(-1)
  const changed =
    !previous ||
    previous.price !== entry.price ||
    previous.seller !== entry.seller ||
    previous.shipper !== entry.shipper ||
    previous.availability !== entry.availability

  if (changed) {
    entries.push(entry)
    store[asin] = entries.slice(-limit)
    await writeStore(file, store)
  }

  return buildSummary(store[asin] ?? entries)
}

export const recordPriceObservation = async (
  file: string,
  asin: string,
  entry: PriceHistoryEntry,
  limit: number,
): Promise<PriceHistorySummary> => {
  const store = await readStore(file)
  const entries = store[asin] ?? []
  entries.push(entry)
  store[asin] = entries.slice(-limit)
  await writeStore(file, store)
  return buildSummary(store[asin])
}
