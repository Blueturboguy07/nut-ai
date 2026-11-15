// A fake publik for CI only (.github/workflows/mobile-build.yml, job ios-sim
// (required)): the test build's self-test runs against it with
// PUBLIK_API_BASE_URL, and prints the plan line that Profile and AI provider
// show for a demo-like wallet (blind test round 2, Nov 15 2026, N2).
//
//   node apps/mobile/scripts/fake-publik.mjs <port> <prepaid|plan>
//
// It answers POST /api/v1/installs, GET /api/v1/wallet and POST
// /api/v1/telemetry on 127.0.0.1 only. It prints the method, the path and the
// status of each request, never a header or a body: the body of /installs
// holds the build's app token. The install key it hands out is a fake one
// that opens nothing.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8787)
const which = process.argv[3] ?? 'prepaid'
const wallets = JSON.parse(readFileSync(new URL('../src/inference/fixtures/demo-wallets.json', import.meta.url), 'utf8'))
const wallet = wallets[which]
if (!wallet) {
  console.error(`fake publik: no wallet fixture named ${which}`)
  process.exit(2)
}
const FAKE_KEY = 'pk_ci_fake_install_key'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body == null ? '' : JSON.stringify(body))
}

createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => {
    if (chunks.length < 64) chunks.push(c)
  })
  req.on('end', () => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    let status = 404
    if (req.method === 'POST' && path === '/api/v1/installs') {
      let installId = null
      try {
        installId = JSON.parse(Buffer.concat(chunks).toString('utf8')).install_id ?? null
      } catch {
        /* no body: still a fake install */
      }
      status = 201
      send(res, status, { key: FAKE_KEY, install_id: installId, claim_state: 'claimed', wallet })
    } else if (req.method === 'GET' && path === '/api/v1/wallet') {
      status = 200
      send(res, status, wallet)
    } else if (req.method === 'POST' && path === '/api/v1/telemetry') {
      status = 204
      send(res, status, null)
    } else {
      send(res, status, { error: { type: 'not_found', message: 'The fake publik has no such path.' } })
    }
    console.log(`fake publik: ${req.method} ${path} -> ${status}`)
  })
}).listen(port, '127.0.0.1', () => console.log(`fake publik: ${which} wallet on http://127.0.0.1:${port}/api/v1`))
