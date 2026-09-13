import {
  type AppearanceCommand,
  type AppearanceDocument,
  type CustomizationState,
  appearanceCommandSchema,
  appearancePackSchema,
  customizationSchema,
} from './schema'

export class CustomizationError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

export function transitionAppearance(
  current: CustomizationState,
  input: AppearanceCommand,
  now = new Date().toISOString()
): CustomizationState {
  const command = appearanceCommandSchema.parse(input)
  if (command.revision !== current.revision) {
    throw new CustomizationError(
      'Appearance changed in another tab. Reload before saving your draft.',
      409
    )
  }
  const next = { ...current, revision: current.revision + 1 }
  switch (command.action) {
    case 'save':
      return customizationSchema.parse({ ...next, draft: command.document })
    case 'import':
      return customizationSchema.parse({
        ...next,
        draft: command.pack.appearance,
      })
    case 'discard':
      return customizationSchema.parse({ ...next, draft: null })
    case 'publish':
      return customizationSchema.parse({
        ...next,
        previous: current.published,
        published: command.document,
        draft: null,
        publishedAt: now,
      })
    case 'restore':
      if (!current.previous)
        throw new CustomizationError(
          'There is no previous appearance to restore.'
        )
      return customizationSchema.parse({
        ...next,
        published: current.previous,
        previous: current.published,
        draft: null,
        publishedAt: now,
      })
  }
}

export function exportAppearancePack(document: AppearanceDocument) {
  return appearancePackSchema.parse({
    kind: 'flare.appearance',
    version: 1,
    name: `${document.brand.name} appearance`,
    appearance: document,
  })
}
