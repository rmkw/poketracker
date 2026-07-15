import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { recordPriceChange, recordPriceObservation } from "./price-history.js"

test("guarda solamente cambios de precio y conserva el mínimo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-history-"))
  const file = join(directory, "history.json")
  const base = {
    currency: "MXN",
    seller: "Amazon México",
    shipper: "Amazon México",
    availability: "Disponible",
    isAvailable: true,
    hasPurchaseSignal: true,
  }

  try {
    await recordPriceChange(file, "B0H78BB9TY", { ...base, price: 5_200, scrapedAt: "2026-07-13T10:00:00.000Z" }, 10)
    const summary = await recordPriceChange(file, "B0H78BB9TY", { ...base, price: 1_299, scrapedAt: "2026-07-13T10:01:00.000Z" }, 10)
    const unchanged = await recordPriceChange(file, "B0H78BB9TY", { ...base, price: 1_299, scrapedAt: "2026-07-13T10:02:00.000Z" }, 10)

    assert.equal(summary.previousPrice, 5_200)
    assert.equal(summary.lowestPrice, 1_299)
    assert.equal(unchanged.recent.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("conserva revisiones sin stock para mostrarlas en el dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-stock-history-"))
  const file = join(directory, "history.json")

  try {
    await recordPriceObservation(file, "B0H783FY5Z", {
      price: 599,
      currency: "MXN",
      seller: "Amazon México",
      shipper: "Amazon México",
      availability: "Disponible",
      isAvailable: true,
      hasPurchaseSignal: true,
      scrapedAt: "2026-07-14T10:00:00.000Z",
    }, 10)
    const summary = await recordPriceObservation(file, "B0H783FY5Z", {
      price: null,
      currency: "MXN",
      seller: null,
      shipper: null,
      availability: "Sin artículos disponibles",
      isAvailable: false,
      hasPurchaseSignal: false,
      scrapedAt: "2026-07-14T10:01:00.000Z",
    }, 10)

    assert.equal(summary.previousPrice, 599)
    assert.equal(summary.lowestPrice, 599)
    assert.equal(summary.recent.at(-1)?.price, null)
    assert.equal(summary.recent.at(-1)?.isAvailable, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
