import assert from "node:assert/strict"
import test from "node:test"

import { parseDecodoPricingProduct } from "./amazon-mx-product.js"

test("normaliza una oferta parseada y prefiere Amazon México", () => {
  const product = parseDecodoPricingProduct("B0H78BB9TY", {
    results: [{ content: { results: { title: "ETB", pricing: [
      { price: 5_000, currency: "MXN", seller: "Tercero", delivery: "Envío por Tercero" },
      { price: 1_299, currency: "MXN", seller: "Amazon México", delivery: "Envío por Amazon México" },
    ] } } }],
  })
  assert.equal(product?.price, 1_299)
  assert.equal(product?.isAmazonSeller, true)
  assert.equal(product?.isAmazonShipper, true)
})

test("marca no disponible una respuesta Pricing sin ofertas", () => {
  const product = parseDecodoPricingProduct("B0H783FY5Z", {
    results: [{ content: { results: { title: "Booster", pricing: [] } } }],
  })
  assert.equal(product?.isAvailable, false)
  assert.equal(product?.price, null)
})
