import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { readMonitorSettings, writeMonitorSettings } from "./monitor-settings.js"

test("persiste el interruptor maestro y productos individuales", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-settings-"))
  const file = join(directory, "settings.json")
  const fallback = { checkIntervalMinutes: 1, masterActive: true, enabledProducts: { B0H78BB9TY: true, B0H783FY5Z: true } }
  try {
    await writeMonitorSettings(file, { ...fallback, masterActive: false, enabledProducts: { ...fallback.enabledProducts, B0H783FY5Z: false } })
    const settings = await readMonitorSettings(file, fallback)
    assert.equal(settings.masterActive, false)
    assert.equal(settings.enabledProducts.B0H783FY5Z, false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
