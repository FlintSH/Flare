import { describe, expect, it } from 'vitest'

import { identifyCrawler } from '@/lib/embeds/crawlers'

// The agents each app's preview fetcher sends, as documented or as its
// source code writes them.
const AGENTS: Record<string, string> = {
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  telegram: 'TelegramBot (like TwitterBot)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  facebook:
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  matrix: 'Synapse (bot; +https://github.com/matrix-org/synapse)',
  whatsapp: 'WhatsApp/2.23.20.0 A',
  twitter: 'Twitterbot/1.0',
  linkedin:
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  fediverse: 'Mastodon/4.3.0 (http.rb/5.2.0; +https://mastodon.example/) Bot',
  bluesky:
    'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)',
  microsoft:
    'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com',
}

// Apple Messages names two other fetchers. It previews like Facebook's.
const APPLE_MESSAGES =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0'

describe('link-preview fetchers', () => {
  it('names each fetcher from its own agent', () => {
    for (const [id, agent] of Object.entries(AGENTS))
      expect(identifyCrawler(agent)?.id, agent).toBe(id)
    expect(identifyCrawler(APPLE_MESSAGES)?.id).toBe('facebook')
    // Signal fetches as WhatsApp.
    expect(identifyCrawler('WhatsApp/2')?.id).toBe('whatsapp')
  })

  it('knows which apps show a linked image on its own', () => {
    const bare = Object.entries(AGENTS)
      .filter(([, agent]) => identifyCrawler(agent)?.bareImages)
      .map(([id]) => id)
    expect(bare).toEqual(['discord', 'telegram', 'slack', 'facebook', 'matrix'])
  })

  it('leaves browsers, in-app browsers and other clients to the share page', () => {
    for (const agent of [
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      // The X and LinkedIn apps open links in their own browsers.
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.50',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 LinkedInApp',
      // A phone brand, which the word "bot" used to catch.
      'Mozilla/5.0 (Linux; Android 13; CUBOT KingKong 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'curl/8.5.0',
      '',
    ])
      expect(identifyCrawler(agent), agent).toBeNull()
    expect(identifyCrawler(null)).toBeNull()
  })
})
