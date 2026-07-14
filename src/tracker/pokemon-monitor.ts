import { basename, dirname, extname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { loadEnvFileIfPresent } from "./load-env.js"

loadEnvFileIfPresent()

import { readAlertState, writeAlertState } from "./alert-state.js"
import {
  getAmazonScraperProvider,
  scrapeAmazonMxProduct,
  type AmazonMxProduct,
} from "./amazon-mx-product.js"
import {
  recordPriceChange,
} from "./price-history.js"
import { sendTelegramMessage } from "./telegram.js"

export type MonitorConfig = {
  asins: string[]
  targetPrice: number
  stateFile: string
  historyFile: string
  historyLimit: number
  checkIntervalMinutes: number
  debug: boolean
}

const DEFAULT_ASIN = "B0H78BB9TY"
const DEFAULT_TARGET_PRICE = 1_300
const DEFAULT_CHECK_INTERVAL_MINUTES = 15
const DIRECT_MINIMUM_CHECK_INTERVAL_MINUTES = 5
const DECODO_MINIMUM_CHECK_INTERVAL_MINUTES = 1
const DEFAULT_HISTORY_LIMIT = 300

const money = (price: number | null): string =>
  price === null
    ? "no encontrado"
    : `$${price.toLocaleString("es-MX", { maximumFractionDigits: 2 })} MXN`

const normalizeSignatureValue = (value: string | null): string | null =>
  value?.replace(/\s+/g, " ").trim().toLocaleLowerCase("es-MX") ?? null

const readBoolean = (value: string | undefined): boolean =>
  /^(?:1|true|yes|si|sí|on)$/i.test(value ?? "")

const getConfiguredAsins = (): string[] => {
  const configured = process.env.AMAZON_ASINS ?? process.env.POKEMON_ASIN ?? DEFAULT_ASIN
  const asins = [...new Set(configured.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))]

  if (asins.length === 0) throw new Error("Configura al menos un ASIN")

  for (const asin of asins) {
    if (!/^[A-Z0-9]{10}$/i.test(asin)) throw new Error(`ASIN inválido: ${asin}`)
  }

  return asins
}

const readPositiveNumber = (
  value: string | undefined,
  fallback: number,
  name: string,
): number => {
  const parsed = Number(value ?? fallback)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un número mayor que cero`)
  }

  return parsed
}

export const getMonitorConfig = (): MonitorConfig => {
  const targetPrice = readPositiveNumber(
    process.env.MAX_PRICE ?? process.env.POKEMON_TARGET_PRICE,
    DEFAULT_TARGET_PRICE,
    "MAX_PRICE",
  )
  const checkIntervalMinutes = readPositiveNumber(
    process.env.CHECK_INTERVAL_MINUTES,
    DEFAULT_CHECK_INTERVAL_MINUTES,
    "CHECK_INTERVAL_MINUTES",
  )
  const scraperProvider = getAmazonScraperProvider()
  const minimumInterval =
    scraperProvider === "decodo"
      ? DECODO_MINIMUM_CHECK_INTERVAL_MINUTES
      : DIRECT_MINIMUM_CHECK_INTERVAL_MINUTES

  if (checkIntervalMinutes < minimumInterval) {
    throw new Error(
      `CHECK_INTERVAL_MINUTES no puede ser menor que ${minimumInterval} con ${scraperProvider}; evita solicitudes excesivas a Amazon`,
    )
  }

  return {
    asins: getConfiguredAsins(),
    targetPrice,
    stateFile:
      process.env.POKEMON_ALERT_STATE_FILE ?? ".pokemon-alert-state.json",
    historyFile: process.env.PRICE_HISTORY_FILE ?? ".pokemon-price-history.json",
    historyLimit: Math.floor(
      readPositiveNumber(
        process.env.PRICE_HISTORY_LIMIT,
        DEFAULT_HISTORY_LIMIT,
        "PRICE_HISTORY_LIMIT",
      ),
    ),
    checkIntervalMinutes,
    debug: readBoolean(process.env.DEBUG),
  }
}

export const shouldAlert = (
  data: AmazonMxProduct,
  targetPrice: number,
): boolean =>
  data.isAvailable &&
  data.price !== null &&
  data.price <= targetPrice &&
  data.isAmazonSeller &&
  data.isAmazonShipper &&
  data.hasPurchaseSignal

export const buildSignature = (
  data: AmazonMxProduct,
  targetPrice: number,
): string =>
  JSON.stringify({
    eligible: shouldAlert(data, targetPrice),
    price: data.price,
    seller: normalizeSignatureValue(data.seller),
    shipper: normalizeSignatureValue(data.shipper),
    isAvailable: data.isAvailable,
    isAmazonSeller: data.isAmazonSeller,
    isAmazonShipper: data.isAmazonShipper,
    hasPurchaseSignal: data.hasPurchaseSignal,
  })

export const buildMessage = (data: AmazonMxProduct): string =>
  [
    "🚨 Oferta Amazon México disponible",
    `Producto: ${data.title ?? data.asin}`,
    "Disponible en Amazon México.",
    "Abrir producto:",
    data.url,
  ].join("\n")

const logProduct = (
  data: AmazonMxProduct,
  config: MonitorConfig,
  eligible: boolean,
  changed: boolean,
  alreadyAlerted: boolean,
): void => {
  console.log(
    `[${data.scrapedAt}] ${data.asin} | ${money(data.price)} | ${data.availability ?? "disponibilidad no encontrada"} | alerta: ${eligible ? (alreadyAlerted ? "ya enviada" : "pendiente") : "no"}`,
  )

  if (config.debug) {
    console.dir(
      {
        asin: data.asin,
        title: data.title,
        price: data.price,
        currency: data.currency,
        availability: data.availability,
        seller: data.seller,
        shipper: data.shipper,
        isAvailable: data.isAvailable,
        isAmazonSeller: data.isAmazonSeller,
        isAmazonShipper: data.isAmazonShipper,
        hasPurchaseSignal: data.hasPurchaseSignal,
        deliveryRestrictionDetected: data.deliveryRestrictionDetected,
        eligible,
        changed,
        alreadyAlerted,
        url: data.url,
        scrapedAt: data.scrapedAt,
      },
      { depth: null },
    )
  }
}

export type CheckResult = {
  data: AmazonMxProduct
  eligible: boolean
  changed: boolean
  alertSent: boolean
}

const stateFileForAsin = (config: MonitorConfig, asin: string): string => {
  if (config.asins.length === 1) return config.stateFile

  const extension = extname(config.stateFile)
  const filename = basename(config.stateFile, extension)
  return join(dirname(config.stateFile), `${filename}.${asin}${extension}`)
}

export const runCheck = async (
  config: MonitorConfig,
  asin: string,
): Promise<CheckResult> => {
  const data = await scrapeAmazonMxProduct(asin)
  const state = await readAlertState(stateFileForAsin(config, asin))
  const history =
    data.price === null
      ? { previousPrice: null, lowestPrice: null, recent: [] }
      : await recordPriceChange(
          config.historyFile,
          asin,
          {
            price: data.price,
            currency: data.currency ?? "MXN",
            seller: data.seller,
            shipper: data.shipper,
            availability: data.availability,
            scrapedAt: data.scrapedAt,
          },
          config.historyLimit,
        )
  const signature = buildSignature(data, config.targetPrice)
  const eligible = shouldAlert(data, config.targetPrice)
  const changed = signature !== state.signature
  const alreadyAlerted = state.lastAlertedSignature === signature

  logProduct(data, config, eligible, changed, alreadyAlerted)

  let lastAlertedAt = state.lastAlertedAt
  let lastAlertedSignature = eligible ? state.lastAlertedSignature : null
  let alertSent = false

  if (eligible && !alreadyAlerted) {
    try {
      await sendTelegramMessage(buildMessage(data))
      lastAlertedAt = new Date().toISOString()
      lastAlertedSignature = signature
      alertSent = true
      console.log("Alerta enviada por Telegram")
    } catch (error) {
      console.error(
        `Telegram falló; se volverá a intentar en la siguiente revisión: ${error instanceof Error ? error.message : error}`,
      )
    }
  } else if (eligible) {
    console.log("Producto elegible, pero este estado ya fue alertado")
  } else {
    console.log("Producto revisado; todavía no cumple todas las condiciones")
  }

  await writeAlertState(stateFileForAsin(config, asin), {
    signature,
    lastAlertedSignature,
    lastCheckedAt: data.scrapedAt,
    lastAlertedAt,
  })

  return { data, eligible, changed, alertSent }
}

const runAllChecks = async (config: MonitorConfig): Promise<CheckResult[]> => {
  const results: CheckResult[] = []

  for (const asin of config.asins) {
    try {
      results.push(await runCheck(config, asin))
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ${asin}: revisión falló: ${formatError(error)}`,
      )
    }
  }

  if (results.length === 0) throw new Error("Fallaron todas las revisiones")
  return results
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runWatchMode = async (config: MonitorConfig): Promise<void> => {
  let stopRequested = false
  let wakeWait: (() => void) | null = null

  const requestStop = () => {
    stopRequested = true
    wakeWait?.()
  }

  process.once("SIGINT", requestStop)
  process.once("SIGTERM", requestStop)

  console.log(
    `Monitor continuo iniciado: ${config.asins.length} ASIN(s), cada ${config.checkIntervalMinutes} minuto(s), ${config.asins.length} consulta(s) por revisión. Presiona Ctrl+C para detenerlo.`,
  )

  try {
    while (!stopRequested) {
      const startedAt = Date.now()

      try {
        await runAllChecks(config)
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Revisión falló: ${formatError(error)}`,
        )
      }

      if (stopRequested) break

      const intervalMs = config.checkIntervalMinutes * 60_000
      const remainingMs = Math.max(0, intervalMs - (Date.now() - startedAt))
      const nextCheckAt = new Date(Date.now() + remainingMs).toISOString()
      console.log(`Siguiente revisión: ${nextCheckAt}`)

      await new Promise<void>((resolveWait) => {
        const finish = () => {
          clearTimeout(timer)
          wakeWait = null
          resolveWait()
        }
        const timer = setTimeout(finish, remainingMs)
        wakeWait = finish
      })
    }
  } finally {
    process.removeListener("SIGINT", requestStop)
    process.removeListener("SIGTERM", requestStop)
    console.log("Monitor detenido")
  }
}

export const runMonitor = async (
  config: MonitorConfig,
  watch: boolean,
): Promise<void> => {
  if (watch) {
    await runWatchMode(config)
    return
  }

  await runAllChecks(config)
}

const isExecutedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isExecutedDirectly) {
  const config = getMonitorConfig()
  const watch = process.argv.includes("--watch")

  runMonitor(config, watch).catch((error) => {
    console.error(formatError(error))
    process.exitCode = 1
  })
}
