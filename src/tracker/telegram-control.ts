import { readFile, writeFile } from "node:fs/promises"

import { sendTelegramMessage } from "./telegram.js"

type TelegramUpdate = {
  update_id: number
  message?: {
    chat?: { id?: number | string }
    text?: string
  }
}

const readOffset = async (file: string): Promise<number | null> => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { offset?: unknown }
    const offset = Number(parsed.offset)
    return Number.isSafeInteger(offset) ? offset : null
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

const writeOffset = async (file: string, offset: number): Promise<void> => {
  await writeFile(file, `${JSON.stringify({ offset }, null, 2)}\n`, { mode: 0o600 })
}

export type TelegramCommand =
  | { kind: "interval"; minutes: 1 | 5 }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "master"; active: boolean }
  | { kind: "product"; active: boolean; asin?: string; index?: number }
  | { kind: "unknown" }

export const parseTelegramCommand = (text: string): TelegramCommand | null => {
  const normalized = text.trim().toLowerCase().replace(/^\/([^\s@]+)@[^\s]+/, "/$1")
  const [name = "", argument] = normalized.split(/\s+/, 2)
  if (["/1min", "/1", "1 min", "1"].includes(normalized)) return { kind: "interval", minutes: 1 }
  if (["/5min", "/5", "5 min", "5"].includes(normalized)) return { kind: "interval", minutes: 5 }
  if (["/estado", "/status", "estado"].includes(normalized)) return { kind: "status" }
  if (["/ayuda", "/help", "/comandos"].includes(normalized)) return { kind: "help" }

  const active = ["/reanudar", "/encender", "/activar", "/reanudar_todo", "/encender_todo"].includes(name)
    ? true
    : ["/pausar", "/apagar", "/desactivar", "/pausar_todo", "/apagar_todo"].includes(name)
      ? false
      : null
  if (active !== null) {
    if (argument?.match(/^[a-z0-9]{10}$/i)) return { kind: "product", active, asin: argument.toUpperCase() }
    return { kind: "master", active }
  }

  const indexed = name.match(/^\/(?:pausar|apagar|desactivar|reanudar|encender|activar)(\d+)$/)
  if (indexed) {
    return {
      kind: "product",
      active: /^\/(?:reanudar|encender|activar)/.test(name),
      index: Number(indexed[1]),
    }
  }

  return normalized.startsWith("/") ? { kind: "unknown" } : null
}

const helpMessage = (products: Array<{ asin: string }>): string => [
  "Comandos del monitor Pokemon MX:",
  "/estado - estado general",
  "/1min o /5min - cambiar frecuencia",
  "/pausar_todo - pausar todas las consultas",
  "/reanudar_todo - reanudar todas las consultas",
  ...products.flatMap((product, index) => [
    `/pausar${index + 1} - pausar ${product.asin}`,
    `/reanudar${index + 1} - reanudar ${product.asin}`,
  ]),
  "/ayuda - mostrar estos comandos",
].join("\n")

export const startTelegramControl = ({
  stateFile,
  products,
  getInterval,
  getMasterActive,
  isProductEnabled,
  setInterval,
  setMasterActive,
  setProductEnabled,
}: {
  stateFile: string
  products: Array<{ asin: string }>
  getInterval: () => number
  getMasterActive: () => boolean
  isProductEnabled: (asin: string) => boolean
  setInterval: (minutes: number) => Promise<void>
  setMasterActive: (active: boolean) => Promise<void>
  setProductEnabled: (asin: string, active: boolean) => Promise<void>
}): { close: () => void } => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) throw new Error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHAT_ID")

  let offsetPromise = readOffset(stateFile)
  let running = false

  const poll = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const offset = await offsetPromise
      const params = new URLSearchParams({ timeout: "0" })
      if (offset !== null) params.set("offset", String(offset))
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?${params}`)
      if (!response.ok) throw new Error(`Telegram error ${response.status}: ${await response.text()}`)
      const payload = await response.json() as { ok?: boolean; result?: TelegramUpdate[] }
      if (!payload.ok || !Array.isArray(payload.result)) throw new Error("Telegram devolvió una respuesta inválida")

      for (const update of payload.result) {
        offsetPromise = Promise.resolve(update.update_id + 1)
        await writeOffset(stateFile, update.update_id + 1)

        const message = update.message
        if (!message || String(message.chat?.id) !== String(chatId) || !message.text) continue
        const command = parseTelegramCommand(message.text)
        if (command === null) continue

        try {
          if (command.kind === "unknown") {
            await sendTelegramMessage("Comando no reconocido. Usa /ayuda para ver las opciones disponibles.")
          } else if (command.kind === "help") {
            await sendTelegramMessage(helpMessage(products))
          } else if (command.kind === "status") {
            const productStates = products.map((product, index) => `${index + 1}. ${product.asin}: ${isProductEnabled(product.asin) ? "activo" : "pausado"}`)
            await sendTelegramMessage([
              `Monitor general: ${getMasterActive() ? "activo" : "pausado"}`,
              `Revisiones cada ${getInterval()} minuto(s).`,
              ...productStates,
            ].join("\n"))
          } else if (command.kind === "interval") {
            await setInterval(command.minutes)
            await sendTelegramMessage(`Frecuencia actualizada a ${command.minutes} minuto(s).`)
          } else if (command.kind === "master") {
            await setMasterActive(command.active)
            await sendTelegramMessage(`Monitor general ${command.active ? "reanudado" : "pausado"}.`)
          } else {
            const product = command.asin
              ? products.find((entry) => entry.asin === command.asin)
              : command.index
                ? products[command.index - 1]
                : undefined
            if (!product) throw new Error("Ese producto no está configurado")
            await setProductEnabled(product.asin, command.active)
            await sendTelegramMessage(`${product.asin} ${command.active ? "reanudado" : "pausado"}.`)
          }
        } catch (error) {
          await sendTelegramMessage(`No se pudo ejecutar el comando: ${error instanceof Error ? error.message : error}`)
        }
      }
    } catch (error) {
      console.error(`Control por Telegram falló: ${error instanceof Error ? error.message : error}`)
    } finally {
      running = false
    }
  }

  const timer = globalThis.setInterval(() => { void poll() }, 5_000)
  void poll()
  return { close: () => globalThis.clearInterval(timer) }
}
