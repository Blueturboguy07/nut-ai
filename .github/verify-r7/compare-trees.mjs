// Blind verify r7: compare the packages really on disk (every node_modules/**/package.json, walked by hand,
// not npm's own record) with package-lock.json, and (optional) with a second tree.
// Usage: node compare-trees.mjs <label> <lockDir> <treeA> [<treeB>]
import { readFileSync, readdirSync, lstatSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
const [label, lockDir, a, b] = process.argv.slice(2)
const lock = JSON.parse(readFileSync(join(lockDir, 'package-lock.json'), 'utf8')).packages
const workspaces = Object.keys(lock).filter((k) => k && !k.includes('node_modules'))
function disk(root) {
  const found = {}
  const visit = (dir, key) => {
    let st; try { st = lstatSync(dir) } catch { return }
    if (st.isSymbolicLink()) { found[key] = { link: true }; return }
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) { try { found[key] = { version: JSON.parse(readFileSync(pj, 'utf8')).version } } catch { found[key] = { version: 'unreadable' } } }
    walk(join(dir, 'node_modules'), key + '/node_modules')
  }
  const walk = (nm, prefix) => {
    let names; try { names = readdirSync(nm) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      if (n.startsWith('@')) { let s; try { s = readdirSync(join(nm, n)) } catch { continue } for (const m of s) visit(join(nm, n, m), `${prefix}/${n}/${m}`) }
      else visit(join(nm, n), `${prefix}/${n}`)
    }
  }
  walk(join(root, 'node_modules'), 'node_modules')
  for (const w of workspaces) walk(join(root, w, 'node_modules'), `${w}/node_modules`)
  for (const k of Object.keys(found)) found[k.replace(/^\//, '')] = found[k]
  return found
}
const out = []
function vsLock(name, tree) {
  let wrong = 0, missing = 0, extra = 0, skippedOptional = 0; const ex = []
  for (const [p, e] of Object.entries(lock)) {
    if (!p.includes('node_modules/')) continue
    const t = tree[p]
    if (e.link) { if (!t) { missing++; ex.push(`missing link ${p}`) } ; continue }
    if (!t) { if (e.optional || e.devOptional || e.peer) skippedOptional++; else { missing++; if (ex.length < 12) ex.push(`missing ${p}@${e.version}`) } ; continue }
    if (t.link) continue
    if (t.version !== e.version) { wrong++; if (ex.length < 12) ex.push(`${p}: lock ${e.version}, on disk ${t.version}`) }
  }
  for (const p of Object.keys(tree)) if (!lock[p]) { extra++; if (ex.length < 12) ex.push(`not in lock: ${p}@${tree[p].version ?? 'link'}`) }
  out.push(`${name}: ${Object.keys(tree).length} on disk; vs package-lock.json: ${wrong} wrong version, ${missing} missing (non-optional), ${extra} not in the lock, ${skippedOptional} optional not installed`)
  for (const e of ex) out.push('    ' + e)
  return wrong + missing + extra
}
const ta = disk(a)
let bad = vsLock(`${label} A ${a}`, ta)
if (b) {
  const tb = disk(b)
  bad += vsLock(`${label} B ${b}`, tb)
  const keys = new Set([...Object.keys(ta), ...Object.keys(tb)])
  let diff = 0; const ex = []
  for (const k of keys) { const va = ta[k]?.version ?? (ta[k]?.link ? 'link' : undefined), vb = tb[k]?.version ?? (tb[k]?.link ? 'link' : undefined); if (va !== vb) { diff++; if (ex.length < 12) ex.push(`${k}: A ${va}, B ${vb}`) } }
  out.push(`${label}: A vs B differ in ${diff} packages`); for (const e of ex) out.push('    ' + e)
  bad += diff
}
const text = out.join('\n'); console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n')
process.exit(bad ? 1 : 0)
