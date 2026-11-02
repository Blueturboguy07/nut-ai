// @nutai/db-adapter — the one interface, two implementations.
//
// This entry point is PURE: interface, schema, migrations. No driver.
//
// The node:sqlite implementation is at `@nutai/db-adapter/node` and is Node
// only. The expo-sqlite implementation lives in apps/mobile/src/db and NOT in
// this package, because packages/* must stay importable under bare Node with
// zero React Native surface (PLAN.md §4.1) — an `import 'expo-sqlite'` here
// would fail the node-purity gate, which is the gate doing its job.
export * from './types.js'
export * from './schema.js'
export * from './migrate.js'
