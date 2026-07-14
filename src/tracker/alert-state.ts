import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type AlertState = {
  signature: string | null
  lastAlertedSignature: string | null
  lastCheckedAt: string | null
  lastAlertedAt: string | null
}

const defaultState: AlertState = {
  signature: null,
  lastAlertedSignature: null,
  lastCheckedAt: null,
  lastAlertedAt: null,
}

export const readAlertState = async (file: string): Promise<AlertState> => {
  try {
    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw) as Partial<AlertState>

    return {
      ...defaultState,
      ...parsed,
      // Migra de forma segura el archivo creado por versiones anteriores.
      lastAlertedSignature:
        parsed.lastAlertedSignature ??
        (parsed.lastAlertedAt && parsed.signature ? parsed.signature : null),
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return defaultState
    throw error
  }
}

export const writeAlertState = async (file: string, state: AlertState): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryFile, file)
}
