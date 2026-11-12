/**
 * The link-preview fetchers Flare answers with a purpose-built preview, by the
 * token each sends in its User-Agent. Search engines and unknown clients are
 * not listed: they get the share page, which carries the same tags.
 * Browser-safe, and imported by the proxy.
 */
export interface Crawler {
  id: string
  /** A token no browser sends, so in-app browsers still get the page. */
  pattern: RegExp
  /**
   * Shows a pasted link that answers with image bytes as the image on its
   * own. Other apps need a page with tags to show anything.
   */
  bareImages: boolean
  /** Shows no preview unless the page has a description. */
  needsDescription?: boolean
}

// The first match wins. Telegram's agent also names TwitterBot, and Apple
// Messages sends facebookexternalhit with Twitterbot, so those come first.
const CRAWLERS: readonly Crawler[] = [
  { id: 'discord', pattern: /Discordbot/i, bareImages: true },
  { id: 'telegram', pattern: /TelegramBot/i, bareImages: true },
  { id: 'slack', pattern: /Slackbot/i, bareImages: true },
  // Facebook, Messenger and Apple Messages.
  { id: 'facebook', pattern: /facebookexternalhit|Facebot/i, bareImages: true },
  {
    id: 'matrix',
    pattern: /Synapse \(bot/i,
    bareImages: true,
  },
  // Signal sends WhatsApp's agent too.
  {
    id: 'whatsapp',
    pattern: /WhatsApp\//i,
    bareImages: false,
    needsDescription: true,
  },
  { id: 'twitter', pattern: /Twitterbot/i, bareImages: false },
  { id: 'linkedin', pattern: /LinkedInBot/i, bareImages: false },
  {
    id: 'fediverse',
    pattern: /Mastodon\/|Pleroma|Akkoma|Misskey|Lemmy\/|Friendica/i,
    bareImages: false,
  },
  { id: 'bluesky', pattern: /Bluesky Cardyb/i, bareImages: false },
  {
    id: 'microsoft',
    pattern: /SkypeUriPreview|MicrosoftPreview/i,
    bareImages: false,
  },
  {
    id: 'preview',
    pattern:
      /redditbot|Pinterestbot|vkShare|Embedly|Iframely|kakaotalk-scrap|Snap URL Preview|Google-PageRenderer|bitlybot/i,
    bareImages: false,
  },
]

export function identifyCrawler(
  userAgent: string | null | undefined
): Crawler | null {
  if (!userAgent) return null
  return CRAWLERS.find((crawler) => crawler.pattern.test(userAgent)) ?? null
}
