type RGB = readonly [number, number, number]

function color(value: string): RGB {
  if (value.startsWith('#'))
    return [
      parseInt(value.slice(1, 3), 16),
      parseInt(value.slice(3, 5), 16),
      parseInt(value.slice(5, 7), 16),
    ]

  // Classic appearance values have already been normalized to H S% L%.
  const [hue, saturation, lightness] = value.split(/\s+/).map(parseFloat)
  const s = saturation / 100
  const l = lightness / 100
  const a = s * Math.min(l, 1 - l)
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [channel(0), channel(8), channel(4)]
}

function linear(channel: number) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: RGB) {
  return (
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
  )
}

function lab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function mix(first: RGB, second: RGB, amount: number): RGB {
  const left = lab(first)
  const right = lab(second)
  const [L, a, b] = left.map(
    (value, index) => value * amount + right[index] * (1 - amount)
  )
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const channel = (value: number) => {
    const encoded =
      value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255)
  }
  return [
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function hex(rgb: RGB) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** An opaque hint color derived from the effective studio or classic palette. */
export function placeholderText(palette: Readonly<Record<string, string>>) {
  const background = color(palette.background)
  const foreground = color(palette.foreground)
  const muted = color(palette.mutedForeground)
  const card = color(palette.card)
  const popover = color(palette.popover)
  // Include the raised panel/overlay surfaces, as well as their unlifted light
  // equivalents. These are the surfaces shared fields can actually sit on.
  const surfaces = [
    background,
    card,
    popover,
    mix(card, color(palette.cardForeground), 0.96),
    mix(popover, foreground, 0.93),
  ].map(luminance)
  const contrast = (candidate: RGB) => {
    const text = luminance(candidate)
    return Math.min(
      ...surfaces.map(
        (surface) =>
          (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
      )
    )
  }

  let best = muted
  // Start slightly quieter than the palette's muted text, without applying
  // transparency to the field. Back off that mix when it would lose AA text
  // contrast, then try the configured foreground for a low-contrast palette.
  for (let amount = 85; amount <= 100; amount++) {
    const candidate = mix(muted, background, amount / 100)
    if (contrast(candidate) >= 4.5) return hex(candidate)
    if (contrast(candidate) > contrast(best)) best = candidate
  }
  for (let amount = 1; amount <= 100; amount++) {
    const candidate = mix(muted, foreground, 1 - amount / 100)
    if (contrast(candidate) >= 4.5) return hex(candidate)
    if (contrast(candidate) > contrast(best)) best = candidate
  }
  // Arbitrarily conflicting custom surfaces may have no single readable
  // shared text color. Keep the best palette-derived color, never rewrite it.
  return hex(best)
}
