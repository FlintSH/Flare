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
const moduleSource = stripTypeScriptTypes(
  await read('lib/integrations/tokens.ts')
)
const { requiredApiScope } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)
const permissionSource = stripTypeScriptTypes(
  await read('lib/permissions/requests.ts')
)
const { requestPermissions } = await import(
  `data:text/javascript;base64,${Buffer.from(permissionSource).toString('base64')}`
)
const catalogSource = stripTypeScriptTypes(
  await read('lib/permissions/catalog.ts')
)
const { ALL_PERMISSIONS } = await import(
  `data:text/javascript;base64,${Buffer.from(catalogSource).toString('base64')}`
)
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
      /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
    ),
  ].map((match) => match[1])
  for (const method of methods) {
    const scope = requiredApiScope(
      method,
      path.replace(/\{partNumber\}/g, '1').replace(/\{[^}]+\}/g, 'example-id')
    )
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
      const permissions = requestPermissions(
        method,
        path.replace(/\{partNumber\}/g, '1').replace(/\{[^}]+\}/g, 'example-id')
      )
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
function emailLeaves(value, prefix = '') {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return entry !== null && typeof entry === 'object'
      ? emailLeaves(entry, path)
      : [path]
  })
}
for (const path of emailLeaves(
  JSON.parse(await read('lib/email/defaults.json'))
)) {
  if (
    [
      'verification.requiredSince',
      'verification.graceEndsAt',
      'verification.appliedMode',
    ].includes(path)
  )
    continue
  envNames.add(
    'FLARE_EMAIL_' +
      path
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replaceAll('.', '_')
        .toUpperCase()
  )
}
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8')
  for (const [, name] of source.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    envNames.add(name)
  }
  for (const [, name] of source.matchAll(/\b(FLARE_[A-Z_]+)\b/g)) {
    if (!/DATABASE_URL$|^FLARE_PREVIEW_|^FLARE_TEST_|^FLARE_SETUP_/.test(name))
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
