'use strict'
/**
 * Root `preinstall`: stop `npm install` on a Node whose node:sqlite cannot
 * build the nutrition database.
 *
 * The corpus build (`npm run data:build`) and the db adapter use node:sqlite
 * with an FTS5 trigram table. `engines` alone only WARNS, so on Node 20 the
 * install went green and the next step died with "No such built-in module:
 * node:sqlite" — far from the cause. This names the cause at the install step.
 *
 * Two checks, both needed:
 *  1. The version. node:sqlite has no flag from 22.13, but FTS5 is compiled
 *     into it only from 22.16.0. 22.13.0-22.15.x install fine and then fail
 *     late with "BUILD FAILED / no such module: fts5" (blind verify, Nov 1
 *     2026, Mac and Windows). Node 23 is no good at any version: 23.0-23.3
 *     have no unflagged node:sqlite, 23.4-23.11 have it without FTS5. 24.0.0
 *     and newer carry FTS5. So: ^22.16.0 or >=24.
 *  2. A real probe: open an in-memory node:sqlite database and create the
 *     same kind of FTS5 trigram table the build creates. node:sqlite is built
 *     into Node, so this works before any dependency is installed. It catches
 *     what a version number cannot, for example a Node built against a system
 *     SQLite without FTS5.
 *
 * Plain CommonJS with old syntax on purpose: it must parse on the old Node it
 * rejects. Not `engine-strict`: that also fails the install when any
 * dependency's own `engines` disagrees, which is not this check's business.
 */
var MIN = [22, 16, 0]
/** Node release lines that are refused at every version (see 1. above). */
var BAD_MAJORS = [23]

function parse(version) {
  var parts = String(version).replace(/^v/, '').split('.')
  return [0, 1, 2].map(function (i) {
    return parseInt(parts[i], 10) || 0
  })
}

function tooOld(version) {
  var have = parse(version)
  for (var i = 0; i < MIN.length; i++) {
    if (have[i] > MIN[i]) return false
    if (have[i] < MIN[i]) return true
  }
  return false
}

/** True when this Node version can run the corpus build: ^22.16.0 or >=24. */
function supported(version) {
  return !tooOld(version) && BAD_MAJORS.indexOf(parse(version)[0]) === -1
}

/**
 * Null when node:sqlite works here with an FTS5 trigram table, else the error
 * message. `load` is for tests; the real check loads node:sqlite itself.
 */
function sqliteProblem(load) {
  var emit = process.emitWarning
  try {
    // node:sqlite prints "ExperimentalWarning: SQLite is an experimental
    // feature" when it loads. In the middle of `npm install` that reads like
    // a problem, so this one warning is held back while the module loads.
    process.emitWarning = function (warning, type) {
      var kind = typeof type === 'string' ? type : type && type.type
      if (kind === 'ExperimentalWarning') return
      return emit.apply(process, arguments)
    }
    var sqlite = load ? load() : require('node:sqlite')
    var db = new sqlite.DatabaseSync(':memory:')
    try {
      db.exec('CREATE VIRTUAL TABLE probe USING fts5(x, tokenize="trigram")')
    } finally {
      db.close()
    }
    return null
  } catch (e) {
    return String((e && e.message) || e)
  } finally {
    process.emitWarning = emit
  }
}

var FIX =
  'Install the current LTS from https://nodejs.org, open a NEW terminal, and run npm install again.\n'

/** The message that stops the install, or null when this Node is fine. */
function problem(version, probe) {
  if (!supported(version)) {
    return (
      '\nNut AI needs Node ' + MIN.join('.') + ' or newer, and not Node 23. ' +
      'This terminal runs Node ' + String(version).replace(/^v/, '') + '.\n' +
      'The nutrition database build uses node:sqlite with FTS5, which this Node does not have.\n' +
      FIX
    )
  }
  var failed = (probe || sqliteProblem)()
  if (failed) {
    return (
      '\nNut AI needs a Node whose built-in node:sqlite has FTS5. This terminal runs Node ' +
      String(version).replace(/^v/, '') + ', and the check failed: ' + failed + '\n' +
      FIX
    )
  }
  return null
}

module.exports = {
  MIN: MIN.join('.'),
  tooOld: tooOld,
  supported: supported,
  sqliteProblem: sqliteProblem,
  problem: problem,
}

if (require.main === module) {
  var message = problem(process.versions.node)
  if (message) {
    console.error(message)
    process.exit(1)
  }
}
