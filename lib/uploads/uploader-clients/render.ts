import { PROTOCOL_VERSION } from '@/lib/e2ee/contexts'
import { base64urlEncode } from '@/lib/e2ee/primitives'

import {
  SHARE_LINK_PATH,
  type UploaderClientId,
  type UploaderOptions,
  type UploaderTransport,
  uploaderClients,
} from '.'
import type { UploadEncryption } from '../schema'
import {
  type ScriptTarget,
  bashScript,
  flameshotScript,
  spectacleScript,
} from './scripts'

/**
 * The files of one upload tool configuration. They are written in the
 * browser, from a token that Flare shows one time and from the account
 * public key of the unlocked keys of that browser. The server never writes
 * a configuration: it has only the hash of a token, and a script client
 * must not take the account key from the server (docs/e2ee-spec.md,
 * sections 10.2 and 14.4).
 */
export interface UploaderConfiguration {
  /** The public address of the server, without a slash at the end. */
  origin: string
  /** The new token, bound to `profile` if there is one. */
  token: string
  profile: { id: string; name: string } | null
  /** The `encryption` setting of the profile: what the files must do. */
  encryption: UploadEncryption
  /**
   * `account_public_key` from the unlocked keys of this browser. Required
   * for `encrypted`.
   */
  accountPublicKey: Uint8Array | null
  folder: UploaderFolder | null
}

export interface UploaderFolder {
  id: string
  /**
   * `folder_public_key`, calculated in this browser from the
   * `folder_private_key` that the account key opened, never the copy of the
   * server (section 8.4.2). Null for a folder that this browser cannot open.
   */
  publicKey: Uint8Array | null
  /** A folder stanza is for a public file only (section 8.4.3). */
  visibility: 'PUBLIC' | 'PRIVATE'
}

/** How the files of a configuration upload: only the helper can encrypt. */
export function transportFor(encryption: UploadEncryption): UploaderTransport {
  return encryption === 'encrypted' ? 'helper' : 'request'
}

/**
 * Whether a tool has a file for this configuration. A tool that only reads
 * a description of one HTTP request cannot encrypt, so it is not offered
 * for an `encrypted` profile.
 */
export function uploaderAvailable(
  id: UploaderClientId,
  encryption: UploadEncryption
) {
  return encryption === 'plain' || uploaderClients[id].runsPrograms
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/**
 * The file name of the `flare-upload` configuration. One file for each
 * profile, so a machine can hold an encrypted and a plain configuration.
 */
export function flareUploadConfigName(
  configuration: Pick<UploaderConfiguration, 'profile'>
) {
  const name = configuration.profile && slug(configuration.profile.name)
  return name ? `${name}.json` : 'config.json'
}

/**
 * The configuration file of `flare-upload`
 * (clients/flare-upload/README.md). It holds the token and public keys,
 * and no private key.
 */
export function flareUploadConfig(configuration: UploaderConfiguration) {
  const { origin, token, profile, encryption, accountPublicKey, folder } =
    configuration
  if (encryption === 'encrypted' && !accountPublicKey)
    throw new Error('An encrypted configuration needs the account public key.')
  return `${JSON.stringify(
    {
      format: 'flare-upload-config',
      version: 1,
      origin,
      token,
      ...(encryption === 'encrypted' &&
        accountPublicKey && {
          protocol_version: PROTOCOL_VERSION,
          account_public_key: base64urlEncode(accountPublicKey),
        }),
      profile_id: profile?.id ?? null,
      encryption,
      ...(folder && {
        folder_id: folder.id,
        // The program makes a folder stanza for a public file only, so it
        // must know the visibility when it has the key of the folder.
        ...(encryption === 'encrypted' &&
          folder.publicKey && {
            folder_public_key: base64urlEncode(folder.publicKey),
            visibility: folder.visibility,
          }),
      }),
    },
    null,
    2
  )}\n`
}

/** The `/api/files` address of a declarative configuration. */
function requestUploadUrl({ origin, profile, folder }: UploaderConfiguration) {
  const url = new URL(`${origin}/api/files`)
  if (profile) url.searchParams.set('profileId', profile.id)
  if (folder) url.searchParams.set('folderId', folder.id)
  return url.toString()
}

function scriptTarget(configuration: UploaderConfiguration): ScriptTarget {
  return transportFor(configuration.encryption) === 'helper'
    ? {
        transport: 'helper',
        origin: configuration.origin,
        configFile: flareUploadConfigName(configuration),
      }
    : {
        transport: 'request',
        uploadUrl: requestUploadUrl(configuration),
        token: configuration.token,
      }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

const renderers: {
  [Id in UploaderClientId]: (
    configuration: UploaderConfiguration,
    options: UploaderOptions<Id>
  ) => string
} = {
  sharex: (configuration) =>
    json({
      Version: '15.0.0',
      Name: 'Flare',
      DestinationType: 'ImageUploader, TextUploader, FileUploader',
      RequestMethod: 'POST',
      RequestURL: requestUploadUrl(configuration),
      Headers: { Authorization: `Bearer ${configuration.token}` },
      Body: 'MultipartFormData',
      FileFormName: 'file',
      URL: `{json:${SHARE_LINK_PATH}}`,
      ThumbnailURL: `{json:${SHARE_LINK_PATH}}`,
      DeletionURL: '',
      ErrorMessage: '{json:error}',
    }),
  // iTake's .itup format reads the share link with a JSON dot path.
  itake: (configuration) =>
    json({
      name: `Flare — ${configuration.profile?.name ?? 'Account defaults'}`,
      request: {
        url: requestUploadUrl(configuration),
        method: 'POST',
        headers: { Authorization: `Bearer ${configuration.token}` },
      },
      body: { type: 'multipart', fileField: 'file', fields: {} },
      response: { linkPath: SHARE_LINK_PATH },
    }),
  flameshot: (configuration, options) =>
    flameshotScript(scriptTarget(configuration), options),
  spectacle: (configuration, options) =>
    spectacleScript(scriptTarget(configuration), options),
  bash: (configuration) => bashScript(scriptTarget(configuration)),
}

/**
 * The file of one tool for a configuration. A declarative file (ShareX
 * `.sxcu`, iTake `.itup`) exists for a `plain` profile only; for an
 * `encrypted` profile ShareX starts `flare-upload` through an action (see
 * `shareXAction`) and iTake has no file.
 */
export function renderUploaderFile<Id extends UploaderClientId>(
  id: Id,
  configuration: UploaderConfiguration,
  options: UploaderOptions<Id>
): string {
  if (
    configuration.encryption === 'encrypted' &&
    (id === 'sharex' || id === 'itake')
  )
    throw new Error(
      `${uploaderClients[id].label} configuration files cannot encrypt.`
    )
  return renderers[id](
    configuration,
    uploaderClients[id].options.parse(options)
  )
}

/**
 * What a ShareX action needs to start `flare-upload` (Task settings,
 * Actions). ShareX puts the path of the captured file in place of `$input`.
 * `--use` names the configuration, so the arguments hold no path that
 * ShareX would have to expand. `--copy` puts the link on the clipboard,
 * because ShareX does not read what an action prints.
 */
export function shareXAction(
  configuration: Pick<UploaderConfiguration, 'profile'>
) {
  const configFile = flareUploadConfigName(configuration)
  const name = configFile.replace(/\.json$/, '')
  return {
    name: `Flare${configuration.profile ? ` (${configuration.profile.name})` : ''}`,
    arguments: `${name === 'config' ? '' : `--use ${name} `}--copy "$input"`,
    configPath: `%APPDATA%\\flare-upload\\${configFile}`,
  }
}
