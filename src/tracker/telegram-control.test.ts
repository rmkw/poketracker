import assert from "node:assert/strict"
import test from "node:test"

import { parseTelegramCommand } from "./telegram-control.js"

test("interpreta controles maestros e individuales de Telegram", () => {
  assert.deepEqual(parseTelegramCommand("/pausar_todo"), { kind: "master", active: false })
  assert.deepEqual(parseTelegramCommand("/reanudar_todo"), { kind: "master", active: true })
  assert.deepEqual(parseTelegramCommand("/pausar1"), { kind: "product", active: false, index: 1 })
  assert.deepEqual(parseTelegramCommand("/reanudar B0H783FY5Z"), {
    kind: "product",
    active: true,
    asin: "B0H783FY5Z",
  })
  assert.deepEqual(parseTelegramCommand("/intervalo1 10"), { kind: "interval", minutes: 10, index: 1 })
  assert.deepEqual(parseTelegramCommand("/intervalo B0H783FY5Z 60"), {
    kind: "interval",
    minutes: 60,
    asin: "B0H783FY5Z",
  })
})

test("un comando desconocido se maneja sin lanzar una excepción", () => {
  assert.deepEqual(parseTelegramCommand("/no_existe"), { kind: "unknown" })
  assert.equal(parseTelegramCommand("mensaje normal"), null)
})

test("acepta comandos dirigidos al usuario del bot", () => {
  assert.deepEqual(parseTelegramCommand("/estado@poketracker_bot"), { kind: "status" })
  assert.deepEqual(parseTelegramCommand("/pausar@poketracker_bot B0H78BB9TY"), {
    kind: "product",
    active: false,
    asin: "B0H78BB9TY",
  })
})
