import { base64urlDecode, base64urlEncode } from '../primitives'
import { sealTagMetadataWithRandomNonce } from '../random'
import {
  decodeStoredRecord,
  encodeStoredRecord,
  openTagMetadata,
  readTagMetadata,
} from '../records'
import type { AccountPrivateKey, AccountPublicKey } from '../types'

/**
 * The name and the rule of a tag in the owner's browser (docs/e2ee-spec.md,
 * section 9.5). They are sealed with `tag_key`, which comes from the account
 * private key. The server stores the record and reads neither.
 */

export interface TagFieldsPlain {
  readonly name: string
  readonly ruleSource: 'filename' | 'ocr' | null
  readonly ruleText: string | null
}

interface AccountKeyPair {
  readonly accountPrivateKey: Uint8Array
  readonly accountPublicKey: Uint8Array
}

/** `sealed_tag_metadata` in the form a request carries: base64url, with `record_version`. */
export function sealedTagRecord(
  keys: AccountKeyPair,
  tag: TagFieldsPlain
): string {
  return base64urlEncode(
    encodeStoredRecord(
      'sealed_tag_metadata',
      sealTagMetadataWithRandomNonce({
        accountPrivateKey: keys.accountPrivateKey as AccountPrivateKey,
        accountPublicKey: keys.accountPublicKey as AccountPublicKey,
        metadata: {
          name: tag.name,
          rule_source: tag.ruleSource,
          rule_text: tag.ruleText,
        },
      })
    )
  )
}

/** Opens a stored `sealed_tag_metadata`. A record of a different account fails with `tag_mismatch`. */
export function openTagRecord(
  keys: AccountKeyPair,
  sealed: string
): TagFieldsPlain {
  const metadata = readTagMetadata(
    openTagMetadata({
      accountPrivateKey: keys.accountPrivateKey as AccountPrivateKey,
      accountPublicKey: keys.accountPublicKey as AccountPublicKey,
      sealedTagMetadata: decodeStoredRecord(
        'sealed_tag_metadata',
        base64urlDecode(sealed)
      ),
    })
  )
  return {
    name: metadata.name,
    ruleSource: metadata.rule_source,
    // A rule needs both parts. One without the other is no rule.
    ruleText: metadata.rule_source ? metadata.rule_text : null,
  }
}
