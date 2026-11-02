'use strict'
/**
 * Root `preinstall`: stop `npm install` on a Node without node:sqlite.
 *
 * The corpus build (`npm run data:build`) and the db adapter use node:sqlite,
 * which Node has without a flag from 22.13. `engines` alone only WARNS, so on
 * Node 20 the install went green and the next step died with "No such
 * built-in module: node:sqlite" (or "bad option: --disable-warning" on older
 * Node) — far from the cause. This names the cause at the install step.
 *
 * Plain CommonJS with old syntax on purpose: it must parse on the old Node it
 * rejects. Not `engine-strict`: that also fails the install when any
 * dependency's own `engines` disagrees, which is not this check's business.
 */
var MIN = [22, 13, 0]

function tooOld(version) {
  var parts = String(version).replace(/^v/, '').split('.')
  for (var i = 0; i < MIN.length; i++) {
    var n = parseInt(parts[i], 10) || 0
    if (n > MIN[i]) return false
    if (n < MIN[i]) return true
  }
  return false
}

module.exports = { tooOld: tooOld, MIN: MIN.join('.') }

if (require.main === module) {
  var have = process.versions.node
  if (tooOld(have)) {
    console.error(
      '\nNut AI needs Node ' + MIN.join('.') + ' or newer. This terminal runs Node ' + have + '.\n' +
        'The nutrition database build uses node:sqlite, which older Node does not have.\n' +
        'Install the current LTS from https://nodejs.org, open a NEW terminal, and run npm install again.\n',
    )
    process.exit(1)
  }
}
