import assert from "node:assert/strict"
import test from "node:test"

import { parseAmazonMxHtml } from "./amazon-mx-product.js"
import { buildSignature, shouldAlert, shouldAlertCandidate } from "./pokemon-monitor.js"

const wrap = (body: string): string => `<html><body>${body}</body></html>`

test("extrae una preventa vendida y enviada por Amazon México", () => {
  const product = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG: 30TH Celebration Elite Trainer Box</span>
      <div id="corePriceDisplay_desktop_feature_div">
        <span class="a-price"><span class="a-offscreen">$1,099.00</span></span>
      </div>
      <div id="availability">Reserva ahora</div>
      <div id="merchant-info">Vendido y enviado por Amazon México.</div>
      <input id="add-to-cart-button" type="submit" />
    `),
  )

  assert.equal(product.price, 1_099)
  assert.equal(product.currency, "MXN")
  assert.equal(product.seller, "Amazon México")
  assert.equal(product.shipper, "Amazon México")
  assert.equal(product.isAvailable, true)
  assert.equal(shouldAlert(product, 1_300), true)
})

test("no confunde un producto agotado de un tercero con una oferta válida", () => {
  const product = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <div id="outOfStock">Actualmente no disponible</div>
      <div id="merchant-info">Vendido por Tienda Ejemplo. Enviado por Tienda Ejemplo.</div>
    `),
  )

  assert.equal(product.isAvailable, false)
  assert.equal(product.isAmazonSeller, false)
  assert.equal(product.isAmazonShipper, false)
  assert.equal(shouldAlert(product, 1_300), false)
})

test("avisa una oferta por verificar cuando Amazon no es vendedor ni remitente", () => {
  const unverified = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$1,099.00</span></span></div>
      <div id="availability">Reserva ahora</div>
      <input id="add-to-cart-button" />
    `),
  )
  const thirdParty = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$1,099.00</span></span></div>
      <div id="availability">Reserva ahora</div>
      <div id="merchant-info">Vendido por Tienda Ejemplo. Enviado por Tienda Ejemplo.</div>
      <input id="add-to-cart-button" />
    `),
  )

  assert.equal(shouldAlertCandidate(unverified, 1_300), true)
  assert.equal(shouldAlertCandidate(thirdParty, 1_300), true)
})

test("reconoce cuando Amazon agrupa remitente y vendedor en una sola tienda", () => {
  const product = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <div>Remitente / Vendedor</div>
      <a id="sellerProfileTriggerId">Tienda Ejemplo</a>
      <div id="availability">En stock</div>
      <input id="add-to-cart-button" />
    `),
  )

  assert.equal(product.seller, "Tienda Ejemplo")
  assert.equal(product.shipper, "Tienda Ejemplo")
})

test("registra la restricción de dirección sin convertirla en falta de stock", () => {
  const product = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <input id="twister-plus-price-data-price" value="1099.00" />
      <input id="twister-plus-price-data-price-unit" value="$" />
      <div id="availability">
        En stock. Lo sentimos, por el momento no podemos enviar este producto a tu dirección.
      </div>
      <div id="merchant-info">Vendido por Amazon México y enviado por Amazon México.</div>
      <input id="buy-now-button" type="submit" />
    `),
  )

  assert.equal(product.deliveryRestrictionDetected, true)
  assert.equal(product.isAvailable, true)
  assert.equal(shouldAlert(product, 1_300), true)
})

test("la firma ignora cambios de texto que no alteran las condiciones", () => {
  const first = parseAmazonMxHtml(
    "B0H78BB9TY",
    wrap(`
      <span id="productTitle">Pokémon TCG</span>
      <input id="twister-plus-price-data-price" value="1099.00" />
      <div id="availability">En stock. Entrega mañana.</div>
      <div id="merchant-info">Vendido y enviado por Amazon México.</div>
      <input id="add-to-cart-button" />
    `),
  )
  const second = { ...first, availability: "En stock. Entrega el viernes." }

  assert.equal(buildSignature(first, 1_300), buildSignature(second, 1_300))
})
