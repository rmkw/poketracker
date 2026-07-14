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

const getCommand = (text: string): "1" | "5" | "status" | null => {
  const command = text.trim().toLowerCase().replace(/@[^\s]+$/, "")
  if (["/1min", "/1", "1 min", "1"].includes(command)) return "1"
  if (["/5min", "/5", "5 min", "5"].includes(command)) return "5"
  if (["/estado", "/status", "estado"].includes(command)) return "status"
  return null
}

export const startTelegramControl = ({
  stateFile,
  getInterval,
  setInterval,
}: {
  stateFile: string
  getInterval: () => number
  setInterval: (minutes: number) => Promise<void>
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
        const command = getCommand(message.text)
        if (command === null) continue

        if (command === "status") {
          await sendTelegramMessage(`Monitor Pokemon MX activo. Revisiones cada ${getInterval()} minuto(s).`)
          continue
        }

        const minutes = Number(command)
        await setInterval(minutes)
        await sendTelegramMessage(
          `Frecuencia actualizada a ${minutes} minuto(s). El dashboard reflejara el cambio al actualizar.`,
        )
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
