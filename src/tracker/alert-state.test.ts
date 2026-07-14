import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { readAlertState, writeAlertState } from "./alert-state.js"

test("migra el estado anterior y escribe el reemplazo de forma atómica", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketracker-state-"))
  const file = join(directory, "state.json")

  try {
    await writeFile(
      file,
      JSON.stringify({
        signature: "estado-anterior",
        lastCheckedAt: "2026-07-13T00:00:00.000Z",
        lastAlertedAt: "2026-07-13T00:00:01.000Z",
      }),
    )

    const migrated = await readAlertState(file)
    assert.equal(migrated.lastAlertedSignature, "estado-anterior")

    await writeAlertState(file, {
      signature: "estado-nuevo",
      lastAlertedSignature: null,
      lastCheckedAt: "2026-07-13T00:15:00.000Z",
      lastAlertedAt: migrated.lastAlertedAt,
    })

    const stored = JSON.parse(await readFile(file, "utf8")) as {
      signature: string
      lastAlertedSignature: string | null
    }
    assert.equal(stored.signature, "estado-nuevo")
    assert.equal(stored.lastAlertedSignature, null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
