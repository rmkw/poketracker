import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { readMonitorSettings, writeMonitorSettings } from "./monitor-settings.js"

test("persiste el interruptor maestro y productos individuales", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-settings-"))
  const file = join(directory, "settings.json")
  const fallback = { masterActive: true, enabledProducts: { B0H78BB9TY: true, B0H783FY5Z: true }, productIntervals: { B0H78BB9TY: 1, B0H783FY5Z: 5 } }
  try {
    await writeMonitorSettings(file, { ...fallback, masterActive: false, enabledProducts: { ...fallback.enabledProducts, B0H783FY5Z: false }, productIntervals: { B0H78BB9TY: 10, B0H783FY5Z: 60 } })
    const settings = await readMonitorSettings(file, fallback)
    assert.equal(settings.masterActive, false)
    assert.equal(settings.enabledProducts.B0H783FY5Z, false)
    assert.deepEqual(settings.productIntervals, { B0H78BB9TY: 10, B0H783FY5Z: 60 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("migra el intervalo global anterior a cada producto", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-settings-"))
  const file = join(directory, "settings.json")
  const fallback = { masterActive: true, enabledProducts: { B0H78BB9TY: true, B0H783FY5Z: true }, productIntervals: { B0H78BB9TY: 5, B0H783FY5Z: 5 } }
  try {
    await writeFile(file, JSON.stringify({ checkIntervalMinutes: 1, masterActive: true, enabledProducts: fallback.enabledProducts }))
    const settings = await readMonitorSettings(file, fallback)
    assert.deepEqual(settings.productIntervals, { B0H78BB9TY: 1, B0H783FY5Z: 1 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
