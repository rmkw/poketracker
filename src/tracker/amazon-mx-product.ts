import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type AmazonMxProduct = {
  asin: string
  title: string | null
  price: number | null
  currency: string | null
  availability: string | null
  seller: string | null
  shipper: string | null
  isAvailable: boolean
  isAmazonSeller: boolean
  isAmazonShipper: boolean
  hasPurchaseSignal: boolean
  deliveryRestrictionDetected: boolean
  url: string
  imageUrl: string | null
  scrapedAt: string
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const AMAZON_MX = "Amazon México"
const DEFAULT_TIMEOUT_SECONDS = 30
const DEFAULT_DECODO_TIMEOUT_SECONDS = 120
const MINIMUM_HTML_BYTES = 5_000

export type AmazonScraperProvider = "direct" | "decodo"

type AmazonPageResponse = {
  html: string
  status: number
  provider: AmazonScraperProvider
}

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))

const stripTags = (value: string): string =>
  decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const getElementHtmlById = (html: string, id: string): string | null => {
  const escapedId = escapeRegExp(id)
  const opening = html.match(
    new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\bid=["']${escapedId}["'][^>]*>`, "i"),
  )

  if (!opening || opening.index === undefined) return null

  const tag = opening[1]
  const contentStart = opening.index + opening[0].length
  const closing = `</${tag.toLowerCase()}>`
  const contentEnd = html.toLowerCase().indexOf(closing, contentStart)

  if (contentEnd === -1) {
    return html.slice(opening.index, Math.min(html.length, contentStart + 10_000))
  }

  return html.slice(opening.index, contentEnd + closing.length)
}

const getAttributeById = (
  html: string,
  id: string,
  attribute: string,
): string | null => {
  const escapedId = escapeRegExp(id)
  const tag = html.match(
    new RegExp(`<[^>]*\\bid=["']${escapedId}["'][^>]*>`, "i"),
  )?.[0]

  if (!tag) return null

  const escapedAttribute = escapeRegExp(attribute)
  return (
    tag.match(new RegExp(`\\b${escapedAttribute}=["']([^"']+)["']`, "i"))?.[1] ??
    null
  )
}

const getTextById = (html: string, id: string): string | null => {
  const block = getElementHtmlById(html, id)
  const text = block ? stripTags(block) : ""
  return text || null
}

const hasElementById = (html: string, id: string): boolean =>
  new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, "i").test(html)

const normalizeParty = (value: string | null): string | null => {
  if (!value) return null

  const normalized = value
    .replace(/^(?:vendido|enviado)\s+(?:y\s+enviado\s+)?por\s*/i, "")
    .replace(/[.;,\s]+$/g, "")
    .trim()

  return normalized || null
}

const includesAmazonMx = (value: string | null): boolean => {
  if (!value) return false
  return /amazon(?:\.com\.mx|\s*(?:mexico|méxico|mx))/i.test(value)
}

const parsePriceText = (value: string): number | null => {
  const match = decodeHtml(value).match(/(?:MXN\s*)?\$?\s*(\d[\d\s.,]*)/i)
  if (!match) return null

  let normalized = match[1].replace(/\s/g, "").replace(/[.,]+$/g, "")
  const lastComma = normalized.lastIndexOf(",")
  const lastDot = normalized.lastIndexOf(".")

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastDot > lastComma
        ? normalized.replace(/,/g, "")
        : normalized.replace(/\./g, "").replace(",", ".")
  } else if (lastComma >= 0) {
    normalized = /,\d{2}$/.test(normalized)
      ? normalized.replace(/,/g, ".")
      : normalized.replace(/,/g, "")
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    const decimalIndex = normalized.lastIndexOf(".")
    const decimals = normalized.slice(decimalIndex + 1)
    normalized =
      decimals.length === 2
        ? `${normalized.slice(0, decimalIndex).replace(/\./g, "")}.${decimals}`
        : normalized.replace(/\./g, "")
  }

  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

const getPriceTextFromBlock = (html: string, id: string): string | null => {
  const block = getElementHtmlById(html, id)
  if (!block) return null

  const offscreen = block.match(
    /<[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  )?.[1]

  return offscreen ? stripTags(offscreen) : stripTags(block)
}

const extractPrice = (html: string): number | null => {
  const candidates = [
    getAttributeById(html, "twister-plus-price-data-price", "value"),
    getPriceTextFromBlock(html, "corePriceDisplay_desktop_feature_div"),
    getPriceTextFromBlock(html, "corePrice_feature_div"),
    getPriceTextFromBlock(html, "apex_desktop"),
    getPriceTextFromBlock(html, "priceblock_ourprice"),
    getPriceTextFromBlock(html, "priceblock_dealprice"),
    html.match(
      /class=["'][^"']*priceToPay[^"']*["'][^>]*aria-label=["']([^"']+)["']/i,
    )?.[1],
    html.match(
      /class=["'][^"']*a-price-whole[^"']*["'][^>]*>\s*([^<]+)/i,
    )?.[1],
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const price = parsePriceText(candidate)
    if (price !== null) return price
  }

  return null
}

const extractCurrency = (html: string, price: number | null): string | null => {
  const unit = getAttributeById(
    html,
    "twister-plus-price-data-price-unit",
    "value",
  )

  if (unit && /MXN|\$|MX/i.test(decodeHtml(unit))) return "MXN"
  if (price !== null || /(?:MXN|\$)/i.test(html)) return "MXN"
  return null
}

const getMerchantInfo = (html: string): string | null =>
  getTextById(html, "merchant-info") ??
  getTextById(html, "merchantInfoFeature_feature_div")

const extractCombinedParty = (merchantInfo: string | null): string | null => {
  if (!merchantInfo) return null

  return normalizeParty(
    merchantInfo.match(
      /vendido\s+y\s+enviado\s+por\s+(.+?)(?:[.;]|$)/i,
    )?.[1] ?? null,
  )
}

const extractSeller = (html: string): string | null => {
  const merchantInfo = getMerchantInfo(html)
  const combinedParty = extractCombinedParty(merchantInfo)
  if (combinedParty) return combinedParty

  const sellerFromMerchant = normalizeParty(
    merchantInfo?.match(
      /vendido\s+por\s+(.+?)(?=\s+(?:y\s+)?enviado\s+por|[.;]|$)/i,
    )?.[1] ?? null,
  )
  if (sellerFromMerchant) return sellerFromMerchant

  const seller =
    normalizeParty(getTextById(html, "sellerProfileTriggerId")) ??
    normalizeParty(getTextById(html, "tabular-buybox-truncate-1"))

  if (seller) return seller
  if (merchantInfo && /vendido/i.test(merchantInfo) && includesAmazonMx(merchantInfo)) {
    return AMAZON_MX
  }

  return null
}

const extractShipper = (html: string): string | null => {
  const merchantInfo = getMerchantInfo(html)
  const combinedParty = extractCombinedParty(merchantInfo)
  if (combinedParty) return combinedParty

  const shipperFromMerchant = normalizeParty(
    merchantInfo?.match(
      /(?:enviado|envío(?:\s+realizado)?)\s+por\s+(.+?)(?=\s+(?:y\s+)?vendido\s+por|[.;]|$)/i,
    )?.[1] ?? null,
  )
  if (shipperFromMerchant) return shipperFromMerchant

  const tabularShipper = normalizeParty(
    getTextById(html, "tabular-buybox-truncate-0"),
  )
  if (tabularShipper) return tabularShipper

  const deliveryBlock =
    getTextById(html, "deliveryBlockMessage") ??
    getTextById(html, "mir-layout-DELIVERY_BLOCK")

  if (
    (merchantInfo && /enviado/i.test(merchantInfo) && includesAmazonMx(merchantInfo)) ||
    (deliveryBlock && /amazon/i.test(deliveryBlock))
  ) {
    return AMAZON_MX
  }

  // La nueva ficha de Amazon MX muestra una sola entidad bajo la etiqueta
  // “Remitente / Vendedor” cuando ambas partes son la misma tienda.
  const combinedMerchantParty = normalizeParty(
    getTextById(html, "sellerProfileTriggerId"),
  )
  if (combinedMerchantParty && /Remitente\s*\/\s*Vendedor/i.test(html)) {
    return combinedMerchantParty
  }

  return null
}

const detectCaptcha = (html: string): boolean =>
  /captcha|validateCaptcha|Robot Check|Introduce los caracteres/i.test(html)

const detectPurchaseSignal = (text: string): boolean =>
  /en stock|disponible|reserva ahora|reservar|preventa|pre-?venta|agregar al carrito|comprar ahora/i.test(
    text,
  )

const detectUnavailable = (text: string): boolean =>
  /actualmente no disponible|temporalmente sin stock|no disponible por el momento|agotado|sin stock/i.test(
    text,
  )

const detectDeliveryRestriction = (text: string): boolean =>
  /no podemos enviar este producto a tu dirección|no se puede entregar en tu ubicación/i.test(
    text,
  )

export const parseAmazonMxHtml = (
  asin: string,
  html: string,
  url = `https://www.amazon.com.mx/dp/${asin}`,
  scrapedAt = new Date().toISOString(),
): AmazonMxProduct => {
  const title = getTextById(html, "productTitle")
  const price = extractPrice(html)
  const currency = extractCurrency(html, price)
  const availability =
    getTextById(html, "availability") ??
    getTextById(html, "availabilityInsideBuyBox_feature_div") ??
    getTextById(html, "outOfStock")
  const seller = extractSeller(html)
  const shipper = extractShipper(html)

  const purchaseContext = [
    availability,
    getTextById(html, "desktop_buybox"),
    getTextById(html, "buybox"),
    getTextById(html, "rightCol"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")

  const hasPurchaseButton = [
    "add-to-cart-button",
    "buy-now-button",
    "submit.add-to-cart",
    "preorder-button",
  ].some((id) => hasElementById(html, id))

  const hasPurchaseSignal =
    hasPurchaseButton || detectPurchaseSignal(purchaseContext)
  const isAvailable =
    hasPurchaseSignal && !detectUnavailable(purchaseContext)

  return {
    asin,
    title,
    price,
    currency,
    availability,
    seller,
    shipper,
    isAvailable,
    isAmazonSeller: includesAmazonMx(seller),
    isAmazonShipper: includesAmazonMx(shipper),
    hasPurchaseSignal,
    deliveryRestrictionDetected: detectDeliveryRestriction(purchaseContext),
    url,
    imageUrl: getAttributeById(html, "landingImage", "src"),
    scrapedAt,
  }
}

const readTimeoutSeconds = (
  name: string,
  fallback: number,
): number => {
  const value = Number(process.env[name] ?? fallback)

  if (!Number.isFinite(value) || value < 5 || value > 120) {
    throw new Error(
      `${name} debe estar entre 5 y 120`,
    )
  }

  return value
}

const hasRealDecodoToken = (): boolean => {
  const token = process.env.DECODO_AUTH_TOKEN?.trim() ?? ""
  return Boolean(token) && !/^(?:tu_|your_|example|changeme)/i.test(token)
}

export const getAmazonScraperProvider = (): AmazonScraperProvider => {
  const configured = (process.env.AMAZON_SCRAPER_PROVIDER ?? "auto").toLowerCase()

  if (configured === "auto") return hasRealDecodoToken() ? "decodo" : "direct"
  if (configured === "direct" || configured === "decodo") return configured

  throw new Error(
    "AMAZON_SCRAPER_PROVIDER debe ser auto, direct o decodo",
  )
}

const fetchDirectPage = async (url: string): Promise<AmazonPageResponse> => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.7",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(
      readTimeoutSeconds(
        "AMAZON_REQUEST_TIMEOUT_SECONDS",
        DEFAULT_TIMEOUT_SECONDS,
      ) * 1_000,
    ),
  })

  return {
    html: await response.text(),
    status: response.status,
    provider: "direct",
  }
}

const findHtmlInDecodoResponse = (
  value: unknown,
  depth = 0,
): string | null => {
  if (depth > 6) return null
  if (typeof value === "string") {
    return /<(?:!doctype\s+html|html|body)\b/i.test(value) ? value : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const html = findHtmlInDecodoResponse(item, depth + 1)
      if (html) return html
    }
    return null
  }
  if (typeof value !== "object" || value === null) return null

  const record = value as Record<string, unknown>
  for (const key of ["content", "html", "body", "results"]) {
    const html = findHtmlInDecodoResponse(record[key], depth + 1)
    if (html) return html
  }

  return null
}

const fetchDecodoPage = async (url: string): Promise<AmazonPageResponse> => {
  const token = process.env.DECODO_AUTH_TOKEN?.trim()
  if (!token || !hasRealDecodoToken()) {
    throw new Error("Falta una credencial real en DECODO_AUTH_TOKEN")
  }

  const response = await fetch("https://scraper-api.decodo.com/v2/scrape", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target: "amazon",
      url,
      headless: "html",
      parse: false,
    }),
    signal: AbortSignal.timeout(
      readTimeoutSeconds(
        "DECODO_REQUEST_TIMEOUT_SECONDS",
        DEFAULT_DECODO_TIMEOUT_SECONDS,
      ) * 1_000,
    ),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(
      `Decodo respondió ${response.status}: ${raw.slice(0, 500)}`,
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error("Decodo devolvió una respuesta JSON inválida")
  }

  const html = findHtmlInDecodoResponse(payload)
  if (!html) {
    throw new Error(
      "Decodo no devolvió HTML; revisa que el target amazon tenga headless=html",
    )
  }

  return { html, status: response.status, provider: "decodo" }
}

type DecodoOffer = {
  price?: unknown
  currency?: unknown
  seller?: unknown
  delivery?: unknown
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const asPrice = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null

export const parseDecodoPricingProduct = (asin: string, payload: unknown): AmazonMxProduct | null => {
  const root = asRecord(payload)
  const firstResult = Array.isArray(root?.results) ? root?.results[0] : null
  const content = asRecord(asRecord(firstResult)?.content)
  const result = asRecord(content?.results ?? content)
  if (!result) return null

  const offers = Array.isArray(result.pricing)
    ? result.pricing.map(asRecord).filter((offer): offer is Record<string, unknown> => offer !== null)
    : []
  const preferred = offers.find((offer) => {
    const seller = asText(offer.seller)
    const delivery = asText(offer.delivery)
    return includesAmazonMx(seller) && includesAmazonMx(delivery)
  }) ?? offers[0]
  const seller = asText(preferred?.seller)
  const delivery = asText(preferred?.delivery)
  const shipper = normalizeParty(delivery?.replace(/^(?:envío|enviado)\s+por\s+/i, "") ?? null)
  const price = asPrice(preferred?.price)
  const url = asText(result.url) ?? `https://www.amazon.com.mx/dp/${asin}`
  const available = Boolean(preferred && price !== null)

  return {
    asin,
    title: asText(result.title),
    price,
    currency: asText(preferred?.currency) ?? "MXN",
    availability: available ? "Oferta disponible" : "Sin artículos disponibles",
    seller,
    shipper,
    isAvailable: available,
    isAmazonSeller: includesAmazonMx(seller),
    isAmazonShipper: includesAmazonMx(shipper),
    hasPurchaseSignal: available,
    deliveryRestrictionDetected: false,
    url,
    imageUrl: null,
    scrapedAt: new Date().toISOString(),
  }
}

const fetchDecodoPricing = async (asin: string): Promise<AmazonMxProduct | null> => {
  const token = process.env.DECODO_AUTH_TOKEN?.trim()
  if (!token || !hasRealDecodoToken()) throw new Error("Falta una credencial real en DECODO_AUTH_TOKEN")

  const response = await fetch("https://scraper-api.decodo.com/v2/scrape", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Basic ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      target: "amazon_pricing",
      query: asin,
      domain: "com.mx",
      currency: "MXN",
      ...(process.env.DECODO_GEO?.trim() ? { geo: process.env.DECODO_GEO.trim() } : {}),
      parse: true,
    }),
    signal: AbortSignal.timeout(readTimeoutSeconds("DECODO_REQUEST_TIMEOUT_SECONDS", DEFAULT_DECODO_TIMEOUT_SECONDS) * 1_000),
  })
  if (!response.ok) throw new Error(`Decodo Pricing respondió ${response.status}`)
  return parseDecodoPricingProduct(asin, await response.json())
}

const writeDiagnosticHtml = async (
  asin: string,
  html: string,
): Promise<string> => {
  const directory = process.env.AMAZON_DIAGNOSTICS_DIR ?? "diagnostics"
  await mkdir(directory, { recursive: true })
  const file = join(directory, `${asin}-${Date.now()}.html`)
  await writeFile(file, html, { mode: 0o600 })
  return file
}

export const scrapeAmazonMxProduct = async (
  asin: string,
): Promise<AmazonMxProduct> => {
  const url = `https://www.amazon.com.mx/dp/${asin}`
  const provider = getAmazonScraperProvider()
  if (provider === "decodo") {
    const parsed = await fetchDecodoPricing(asin)
    if (parsed) return parsed
  }
  const page =
    provider === "decodo"
      ? await fetchDecodoPage(url)
      : await fetchDirectPage(url)
  const { html } = page
  const captchaDetected = detectCaptcha(html)

  if (page.status < 200 || page.status >= 300 || html.length < MINIMUM_HTML_BYTES || captchaDetected) {
    const file = await writeDiagnosticHtml(asin, html)
    const reason = captchaDetected
      ? "CAPTCHA/bloqueo detectado"
      : "página incompleta o status inesperado"
    const hint =
      page.provider === "direct"
        ? " Configura DECODO_AUTH_TOKEN para usar el proveedor proxy."
        : ""

    throw new Error(
      `Amazon devolvió una página no usable mediante ${page.provider}: ${reason} (status ${page.status}, ${html.length} bytes). HTML guardado en ${file}.${hint}`,
    )
  }

  const product = parseAmazonMxHtml(asin, html, url)
  const incompletePurchaseData =
    product.hasPurchaseSignal &&
    (product.price === null ||
      product.seller === null ||
      product.shipper === null)

  if (!product.title || incompletePurchaseData) {
    const file = await writeDiagnosticHtml(asin, html)
    console.warn(
      `Extracción incompleta; HTML de diagnóstico guardado en ${file}`,
    )
  }

  return product
}
