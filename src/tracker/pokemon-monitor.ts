import { loadEnvFileIfPresent } from "./load-env.js"

loadEnvFileIfPresent()

import { readAlertState, writeAlertState } from "./alert-state.js"
import { scrapeAmazonMxProduct } from "./amazon-mx-product.js"
import { sendTelegramMessage } from "./telegram.js"

const ASIN = process.env.POKEMON_ASIN ?? "B0H78BB9TY"
const TARGET_PRICE = Number(process.env.POKEMON_TARGET_PRICE ?? "1300")
const STATE_FILE = process.env.POKEMON_ALERT_STATE_FILE ?? ".pokemon-alert-state.json"

const money = (price: number | null): string =>
  price === null ? "no encontrado" : `$${price.toLocaleString("es-MX")} MXN`

const clean = (value: string | null): string => value ?? "no encontrado"

const buildSignature = (data: Awaited<ReturnType<typeof scrapeAmazonMxProduct>>): string =>
  JSON.stringify({
    canAlert: shouldAlert(data),
    price: data.price,
    seller: data.seller,
    shipper: data.shipper,
    availability: data.availability,
  })

const shouldAlert = (data: Awaited<ReturnType<typeof scrapeAmazonMxProduct>>): boolean =>
  data.isAvailable &&
  data.price !== null &&
  data.price <= TARGET_PRICE &&
  data.isAmazonSeller &&
  data.isAmazonShipper &&
  data.hasPurchaseSignal

const buildMessage = (data: Awaited<ReturnType<typeof scrapeAmazonMxProduct>>): string =>
  [
    "🚨 Pokémon 30th Celebration disponible",
    "",
    `Precio: ${money(data.price)}`,
    `Vendido por: ${clean(data.seller)}`,
    `Enviado por: ${clean(data.shipper)}`,
    `Entrega disponible: ${data.isAvailable ? "Sí" : "No"}`,
    "",
    "Abrir producto:",
    data.url,
  ].join("\n")

const main = async () => {
  const data = await scrapeAmazonMxProduct(ASIN)
  const state = await readAlertState(STATE_FILE)
  const signature = buildSignature(data)
  const eligible = shouldAlert(data)
  const changed = signature !== state.signature

  console.log({
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
    eligible,
    changed,
    scrapedAt: data.scrapedAt,
  })

  let lastAlertedAt = state.lastAlertedAt
  if (eligible && changed) {
    try {
      await sendTelegramMessage(buildMessage(data))
      lastAlertedAt = new Date().toISOString()
      console.log("Alerta enviada por Telegram")
    } catch (error) {
      console.error(`Telegram falló: ${error instanceof Error ? error.message : error}`)
    }
  } else if (eligible) {
    console.log("Producto cumple condiciones, pero ya se alertó este mismo estado")
  } else {
    console.log("Producto revisado; todavía no cumple todas las condiciones")
  }

  await writeAlertState(STATE_FILE, {
    signature,
    lastCheckedAt: data.scrapedAt,
    lastAlertedAt,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
