import { loadEnvFileIfPresent } from "./load-env.js"

loadEnvFileIfPresent()

import { sendTelegramMessage } from "./telegram.js"

await sendTelegramMessage(`Prueba de alerta Pokémon 30th\n\n${new Date().toISOString()}`)
console.log("Mensaje de prueba enviado por Telegram")
