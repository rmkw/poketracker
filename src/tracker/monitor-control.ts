import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

const allowedIntervals = new Set([1, 5])

const readInterval = async (file: string, fallback: number): Promise<number> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { checkIntervalMinutes?: unknown }
    const value = Number(parsed.checkIntervalMinutes)
    return allowedIntervals.has(value) ? value : fallback
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return fallback
    }
    throw error
  }
}

const writeInterval = async (file: string, minutes: number): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ checkIntervalMinutes: minutes }, null, 2)}\n`, {
    mode: 0o600,
  })
}

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:4321",
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
  setCheckIntervalMinutes: (minutes: number) => Promise<void>
  close: () => Promise<void>
}

export const startMonitorControl = async ({
  initialIntervalMinutes,
  settingsFile,
  port,
  onIntervalChange,
  getDashboardData,
}: {
  initialIntervalMinutes: number
  settingsFile: string
  port: number
  onIntervalChange: (minutes: number) => void
  getDashboardData: () => Promise<object>
}): Promise<MonitorControl> => {
  let checkIntervalMinutes = await readInterval(settingsFile, initialIntervalMinutes)
  onIntervalChange(checkIntervalMinutes)

  const setCheckIntervalMinutes = async (minutes: number): Promise<void> => {
    if (!allowedIntervals.has(minutes)) throw new Error("El intervalo debe ser 1 o 5 minutos")
    checkIntervalMinutes = minutes
    await writeInterval(settingsFile, minutes)
    onIntervalChange(minutes)
  }

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {})
      return
    }

    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, { checkIntervalMinutes })
      return
    }

    if (request.method === "GET" && request.url === "/dashboard") {
      try {
        sendJson(response, 200, {
          ...(await getDashboardData()),
          checkIntervalMinutes,
          generatedAt: new Date().toISOString(),
        })
      } catch (error) {
        sendJson(response, 500, {
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
        sendJson(response, 200, { checkIntervalMinutes })
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Solicitud invalida" })
      }
      return
    }

    sendJson(response, 404, { error: "No encontrado" })
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
      return checkIntervalMinutes
    },
    setCheckIntervalMinutes,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
