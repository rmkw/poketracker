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
  url: string
  scrapedAt: string
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const AMAZON_MX = "Amazon México"

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")

const stripTags = (value: string): string =>
  decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()

const getBlockById = (html: string, id: string): string | null => {
  const match = html.match(new RegExp(`<[^>]+id=["']${id}["'][\\s\\S]*?(?:</div>|</span>|</table>)`, "i"))
  return match?.[0] ?? null
}

const getTextById = (html: string, id: string): string | null => {
  const block = getBlockById(html, id)
  return block ? stripTags(block) : null
}

const normalizeParty = (value: string | null): string | null => {
  if (!value) return null
  const normalized = value.replace(/^Vendido por\s*/i, "").replace(/^Enviado por\s*/i, "").trim()
  return normalized || null
}

const includesAmazonMx = (value: string | null): boolean => {
  if (!value) return false
  return /amazon\s*(mexico|méxico|mx)/i.test(value)
}

const parsePriceText = (value: string): number | null => {
  const match = value.match(/\$?\s*([\d.,]+)/)
  if (!match) return null

  const normalized = match[1].replace(/,/g, "")
  const price = Number(normalized)
  return Number.isFinite(price) ? price : null
}

const extractPrice = (html: string): number | null => {
  const candidates = [
    html.match(/id=["']twister-plus-price-data-price["'][^>]+value=["']([\d.]+)["']/i)?.[1],
    getTextById(html, "corePriceDisplay_desktop_feature_div"),
    getTextById(html, "corePrice_feature_div"),
    getTextById(html, "apex_desktop"),
    getTextById(html, "priceblock_ourprice"),
    getTextById(html, "priceblock_dealprice"),
    html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>\s*([^<]+)/i)?.[1],
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const price = parsePriceText(candidate)
    if (price !== null) return price
  }

  return null
}

const extractCurrency = (html: string): string | null => {
  const unit = html.match(/id=["']twister-plus-price-data-price-unit["'][^>]+value=["']([^"']+)["']/i)?.[1]
  if (unit) return decodeHtml(unit)
  if (html.includes("$")) return "MXN"
  return null
}

const extractSeller = (html: string): string | null => {
  const merchantInfo = getTextById(html, "merchant-info")
  if (merchantInfo) {
    const sellerMatch = merchantInfo.match(/Vendido por\s+(.+?)(?:\.| y | Enviado por|$)/i)
    if (sellerMatch) return normalizeParty(sellerMatch[1])
    if (includesAmazonMx(merchantInfo)) return AMAZON_MX
  }

  return normalizeParty(getTextById(html, "sellerProfileTriggerId"))
}

const extractShipper = (html: string): string | null => {
  const merchantInfo = getTextById(html, "merchant-info")
  if (merchantInfo) {
    const shipperMatch = merchantInfo.match(/Enviado por\s+(.+?)(?:\.| y | Vendido por|$)/i)
    if (shipperMatch) return normalizeParty(shipperMatch[1])
    if (/enviado\s+por\s+amazon/i.test(merchantInfo) || includesAmazonMx(merchantInfo)) return AMAZON_MX
  }

  const deliveryBlock = getTextById(html, "deliveryBlockMessage") ?? getTextById(html, "mir-layout-DELIVERY_BLOCK")
  if (deliveryBlock && /amazon/i.test(deliveryBlock)) return AMAZON_MX

  return null
}

const detectCaptcha = (html: string): boolean =>
  /captcha|validateCaptcha|Robot Check|Introduce los caracteres/i.test(html)

const detectPurchaseSignal = (text: string): boolean =>
  /en stock|disponible|reserva ahora|preventa|pre-?venta|agregar al carrito|comprar ahora/i.test(text)

const detectUnavailable = (text: string): boolean =>
  /no disponible|agotado|sin stock|no podemos enviar este producto|actualmente no disponible/i.test(text)

export const scrapeAmazonMxProduct = async (asin: string): Promise<AmazonMxProduct> => {
  const url = `https://www.amazon.com.mx/dp/${asin}`
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  })

  const html = await response.text()
  const captchaDetected = detectCaptcha(html)
  if (!response.ok || html.length < 10_000 || captchaDetected) {
    await mkdir("diagnostics", { recursive: true })
    const file = join("diagnostics", `${asin}-${Date.now()}.html`)
    await writeFile(file, html)
    const reason = captchaDetected ? "CAPTCHA/bloqueo detectado" : "página incompleta o status inesperado"
    throw new Error(`Amazon devolvió una página no usable: ${reason} (status ${response.status}, ${html.length} bytes). HTML guardado en ${file}`)
  }

  const pageText = stripTags(html)
  const title = getTextById(html, "productTitle")
  const price = extractPrice(html)
  const currency = extractCurrency(html)
  const availability = getTextById(html, "availability")
  const seller = extractSeller(html)
  const shipper = extractShipper(html)
  const hasPurchaseSignal = detectPurchaseSignal(pageText)
  const isAvailable = hasPurchaseSignal && !detectUnavailable(pageText)

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
    url,
    scrapedAt: new Date().toISOString(),
  }
}
