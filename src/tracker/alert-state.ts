import { readFile, writeFile } from "node:fs/promises"

export type AlertState = {
  signature: string | null
  lastCheckedAt: string | null
  lastAlertedAt: string | null
}

const defaultState: AlertState = {
  signature: null,
  lastCheckedAt: null,
  lastAlertedAt: null,
}

export const readAlertState = async (file: string): Promise<AlertState> => {
  try {
    const raw = await readFile(file, "utf8")
    return { ...defaultState, ...JSON.parse(raw) }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return defaultState
    throw error
  }
}

export const writeAlertState = async (file: string, state: AlertState): Promise<void> => {
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`)
}
