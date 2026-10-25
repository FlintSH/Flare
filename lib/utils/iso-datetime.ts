import { z } from 'zod'

// Zod 3's ISO date-time forms with offsets. Seconds are optional and the
// offset colon may be omitted (`+0200`, as `date +%FT%T%z` prints it). Zod 4's
// `datetime({ offset: true })` rejects both, which would break older clients.
// Offsets are bounded so every accepted value converts to a valid Date.
const DATE =
  '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))'
const TIME = '([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?'
const OFFSET = '[+-]([01]\\d|2[0-3]):?[0-5]\\d'
const ISO_DATE_TIME_WITH_OFFSET = new RegExp(`^${DATE}T${TIME}(Z|${OFFSET})$`)

export const isoDateTimeWithOffset = z
  .string()
  .regex(ISO_DATE_TIME_WITH_OFFSET, 'Invalid datetime')
