import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readMonitorSettings, writeMonitorSettings, type MonitorSettings } from "./monitor-settings.js"

const allowedIntervals = new Set([1, 5])
const allowedOrigins = new Set(["http://127.0.0.1:4321", "http://localhost:4321"])

const sendJson = (request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void => {
  const origin = request.headers.origin
  response.writeHead(status, {
    ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(body))
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  let body = ""
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 10_000) throw new Error("Solicitud demasiado grande")
  }
  return body
}

export type MonitorControl = {
  checkIntervalMinutes: number
  masterActive: boolean
  isProductEnabled: (asin: string) => boolean
  setCheckIntervalMinutes: (minutes: number) => Promise<void>
  setMasterActive: (active: boolean) => Promise<void>
  setProductEnabled: (asin: string, active: boolean) => Promise<void>
  close: () => Promise<void>
}

export const startMonitorControl = async ({
  initialIntervalMinutes,
  products,
  settingsFile,
  port,
  onIntervalChange,
  getDashboardData,
}: {
  initialIntervalMinutes: number
  products: Array<{ asin: string; targetPrice: number }>
  settingsFile: string
  port: number
  onIntervalChange: (minutes: number) => void
  getDashboardData: () => Promise<object>
}): Promise<MonitorControl> => {
  let settings = await readMonitorSettings(settingsFile, {
    checkIntervalMinutes: initialIntervalMinutes,
    masterActive: true,
    enabledProducts: Object.fromEntries(products.map((product) => [product.asin, true])),
  })
  onIntervalChange(settings.checkIntervalMinutes)

  const setCheckIntervalMinutes = async (minutes: number): Promise<void> => {
    if (!allowedIntervals.has(minutes)) throw new Error("El intervalo debe ser 1 o 5 minutos")
    settings = { ...settings, checkIntervalMinutes: minutes }
    await writeMonitorSettings(settingsFile, settings)
    onIntervalChange(minutes)
  }

  const setMasterActive = async (active: boolean): Promise<void> => {
    settings = { ...settings, masterActive: active }
    await writeMonitorSettings(settingsFile, settings)
    onIntervalChange(settings.checkIntervalMinutes)
  }

  const setProductEnabled = async (asinInput: string, active: boolean): Promise<void> => {
    const asin = asinInput.toUpperCase()
    if (!products.some((product) => product.asin === asin)) throw new Error(`Producto no configurado: ${asin}`)
    settings = { ...settings, enabledProducts: { ...settings.enabledProducts, [asin]: active } }
    await writeMonitorSettings(settingsFile, settings)
    onIntervalChange(settings.checkIntervalMinutes)
  }

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(request, response, 204, {})
      return
    }

    if (request.method === "GET" && request.url === "/status") {
      sendJson(request, response, 200, { ...settings, products })
      return
    }

    if (request.method === "GET" && request.url === "/dashboard") {
      try {
        sendJson(request, response, 200, {
          ...(await getDashboardData()),
          ...settings,
          products,
          generatedAt: new Date().toISOString(),
        })
      } catch (error) {
        sendJson(request, response, 500, {
          error: error instanceof Error ? error.message : "No se pudieron leer los datos del monitor",
        })
      }
      return
    }

    if (request.method === "POST" && request.url === "/interval") {
      try {
        const payload = JSON.parse(await readBody(request)) as { checkIntervalMinutes?: unknown }
        const minutes = Number(payload.checkIntervalMinutes)
        await setCheckIntervalMinutes(minutes)
        sendJson(request, response, 200, settings)
      } catch (error) {
        sendJson(request, response, 400, { error: error instanceof Error ? error.message : "Solicitud invalida" })
      }
      return
    }

    if (request.method === "POST" && request.url === "/master") {
      const payload = JSON.parse(await readBody(request)) as { active?: unknown }
      await setMasterActive(Boolean(payload.active))
      sendJson(request, response, 200, settings)
      return
    }

    const productMatch = request.url?.match(/^\/products\/([A-Z0-9]{10})$/i)
    if (request.method === "POST" && productMatch) {
      const asin = productMatch[1]!.toUpperCase()
      const payload = JSON.parse(await readBody(request)) as { active?: unknown }
      try {
        await setProductEnabled(asin, Boolean(payload.active))
        sendJson(request, response, 200, settings)
      } catch (error) {
        sendJson(request, response, 404, { error: error instanceof Error ? error.message : "Producto no configurado" })
      }
      return
    }

    sendJson(request, response, 404, { error: "No encontrado" })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  return {
    get checkIntervalMinutes() {
      return settings.checkIntervalMinutes
    },
    get masterActive() { return settings.masterActive },
    isProductEnabled: (asin) => settings.enabledProducts[asin] !== false,
    setCheckIntervalMinutes,
    setMasterActive,
    setProductEnabled,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
