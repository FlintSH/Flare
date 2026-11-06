import { readFile, readdir } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(site, '../..')
const read = (path) => readFile(resolve(repo, path), 'utf8')
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? walk(resolve(dir, entry.name))
          : resolve(dir, entry.name)
      )
    )
  ).flat()
}
const errors = []
const inventory = await read('docs/site/api/endpoint-inventory.md')
const config = await read('docs/site/hosting/configuration.md')
const spec = JSON.parse(await read('docs/site/public/openapi.json'))
// A data: URL module cannot resolve imports, so the app modules loaded this way,
// the bearer route table, the permission catalog and the email overrides,
// import nothing but types.
const importTypeScript = async (path) =>
  import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await read(path))).toString('base64')}`
  )
const { requestPermissions, requiredApiScope } = await importTypeScript(
  'lib/integrations/bearer-routes.ts'
)
const { ALL_PERMISSIONS } = await importTypeScript('lib/permissions/catalog.ts')
const { emailOverrides } = await importTypeScript('lib/email/environment.ts')
const rolesGuide = await read('docs/site/admin/roles.md')
for (const permission of ALL_PERMISSIONS)
  if (!rolesGuide.includes('`' + permission + '`'))
    errors.push(`Role permission missing from handbook: ${permission}`)
const operations = new Set()
let routes = 0
for (const file of (await walk(resolve(repo, 'app/api'))).filter((file) =>
  file.endsWith('/route.ts')
)) {
  routes++
  const path =
    '/' +
    relative(resolve(repo, 'app'), file)
      .replace(/\/route\.ts$/, '')
      .replace(/\[\.{3}([^\]]+)\]/g, '{$1}')
      .replace(/\[([^\]]+)\]/g, '{$1}')
  if (!inventory.includes('`' + path + '`'))
    errors.push(`Missing route in endpoint inventory: ${path}`)
  const source = await readFile(file, 'utf8')
  const methods = [
    ...source.matchAll(
      /export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
    ),
  ].map((match) => match[1])
  const examplePath = path
    .replace(/\{partNumber\}/g, '1')
    .replace(/\{[^}]+\}/g, 'example-id')
  for (const method of methods) {
    const scope = requiredApiScope(method, examplePath)
    if (!scope) continue
    operations.add(`${method.toLowerCase()} ${path}`)
    const operation = spec.paths?.[path]?.[method.toLowerCase()]
    if (!operation)
      errors.push(`Named-token route missing in OpenAPI: ${method} ${path}`)
    else if (operation['x-flare-scope'] !== scope)
      errors.push(
        `Wrong OpenAPI scope for ${method} ${path}: expected ${scope}`
      )
    if (operation) {
      const permissions = requestPermissions(method, examplePath)
      if (
        JSON.stringify(operation['x-flare-permissions']) !==
        JSON.stringify(permissions)
      )
        errors.push(
          `Wrong OpenAPI role permissions for ${method} ${path}: expected ${permissions}`
        )
    }
  }
}
for (const [path, entry] of Object.entries(spec.paths || {})) {
  for (const method of Object.keys(entry).filter((method) =>
    ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
      method
    )
  )) {
    if (!operations.has(`${method} ${path}`))
      errors.push(
        `OpenAPI claims unsupported named-token operation: ${method} ${path}`
      )
  }
}
const sourceFiles = [
  ...(
    await Promise.all(
      ['lib', 'app', 'scripts'].map((dir) => walk(resolve(repo, dir)))
    )
  ).flat(),
  resolve(repo, 'instrumentation.ts'),
  resolve(repo, 'next.config.ts'),
].filter((file) => /\.(ts|tsx|js|mjs|sh)$/.test(file))
const envNames = new Set(['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'])
for (const { name } of emailOverrides(
  JSON.parse(await read('lib/email/defaults.json'))
))
  envNames.add(name)
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8')
  for (const [, name] of source.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    envNames.add(name)
  }
  for (const [, name] of source.matchAll(/\b(FLARE_[A-Z_]+)\b/g)) {
    envNames.add(name)
  }
}
for (const name of envNames)
  if (!config.includes(name))
    errors.push(
      `Environment option missing from configuration reference: ${name}`
    )
const canonical = JSON.parse(await read('docs/file-ready-event.schema.json'))
const download = JSON.parse(
  await read('docs/site/public/file-ready-event.schema.json')
)
if (JSON.stringify(canonical) !== JSON.stringify(download))
  errors.push(
    'Downloaded webhook schema differs from canonical docs/file-ready-event.schema.json'
  )
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(
  `Documentation covers ${routes} API route files, ${operations.size} named-token operations, ${envNames.size} environment options, ${ALL_PERMISSIONS.length} role permissions, and the canonical webhook schema.`
)
