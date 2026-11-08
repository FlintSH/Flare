<div align="center">
  <img src="./public/icon.svg" alt="" width="88" height="88" />
  <h1>Flare</h1>
  <p><strong>Your own file host for screenshots, files, pastes and short links.</strong></p>

[![Release](https://img.shields.io/github/v/release/FlintSH/Flare?style=flat-square&logo=github&label=release)](https://github.com/FlintSH/Flare/releases)
[![Docker pulls](https://img.shields.io/docker/pulls/flintsh/flare?style=flat-square&logo=docker&logoColor=white)](https://hub.docker.com/r/flintsh/flare)
[![Discord](https://img.shields.io/discord/1006668059936829511?style=flat-square&color=5865F2&logo=discord&logoColor=white)](https://discord.gg/mwVAjKwPus)
[![MIT license](https://img.shields.io/github/license/FlintSH/Flare?style=flat-square)](LICENSE)

[**Documentation**](https://flintsh.github.io/Flare/) · [Install](#quick-start) · [Demos](https://flintsh.github.io/Flare/demos.html) · [API](https://flintsh.github.io/Flare/api/) · [Discord](https://discord.gg/mwVAjKwPus)

</div>

Flare runs on your server and your domain. Upload from the browser or straight from
ShareX, Flameshot, Spectacle, iTake or a shell script, and get a link that previews
properly wherever you paste it. All it needs is PostgreSQL and a container host.

<p align="center">
  <a href="https://flintsh.github.io/Flare/demos.html">
    <img src="./.github/assets/readme/demo.webp" width="100%" alt="Recording of Flare: a screenshot is dropped onto the file library, uploads with a progress bar, its link is copied, its share page opens, and then a Python paste is created and shown with syntax highlighting." />
  </a>
  <br />
  <sub>Drop a file, copy the link, share it. Recorded in a real Flare instance with demo data.</sub>
</p>

## What you get

- **Uploads from your screenshot tool.** Download a ready-made config for ShareX,
  Flameshot, Spectacle or iTake, or a Bash uploader. No API key to copy around.
- **Share pages that look good.** Images, video, audio, PDFs, spreadsheets and code
  open in a clean viewer and embed with rich previews in chat apps.
- **Pastes and short links.** Share code with syntax highlighting, and shorten URLs
  under your own domain with click counts.
- **A library that stays usable.** Folders, tags, search that includes text found in
  images (OCR), and smooth scrolling with a date rail for large libraries.
- **Control over every link.** Public, private or password-protected files, expiry
  dates, and shareable folders.
- **Room for other people.** Invite links, roles and permissions, storage quotas,
  single sign-on (OIDC), two-factor and passkeys, and an audit log.
- **Your look, your storage.** Brand the instance and its share pages, and keep
  files on local disk or any S3-compatible bucket.
- **Built to integrate.** Scoped API tokens, an OpenAPI description and signed
  webhooks.

The [feature explorer](https://flintsh.github.io/Flare/features.html) covers each
of these with a guide.

## A closer look

<table>
  <tr>
    <td colspan="2">
      <picture>
        <source media="(prefers-color-scheme: light)" srcset="./.github/assets/readme/library-light.webp" />
        <img src="./.github/assets/readme/library-dark.webp" alt="Flare's file library with folders, filters and a grid of image previews" />
      </picture>
      <p align="center"><sub><b>Your library.</b> Search, filter and organize everything you upload.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/share.webp" alt="A shared image page with download, copy link, extract text and open original buttons" />
      <p align="center"><sub><b>Share pages.</b> What people see when they open your link.</sub></p>
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/code.webp" alt="A shared TypeScript file shown with line numbers and syntax highlighting" />
      <p align="center"><sub><b>Code and pastes.</b> Highlighted by file extension.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/screenshot-tools.webp" alt="The screenshot tools card in Profile, with downloads for ShareX, iTake, Flameshot, Spectacle and a Bash script" />
      <p align="center"><sub><b>Screenshot tools.</b> One download sets up your capture app.</sub></p>
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/roles.webp" alt="The Roles page listing Admin, Moderator, Creator, Guest and Everyone with member counts" />
      <p align="center"><sub><b>Roles.</b> Decide who can upload, share, moderate or manage.</sub></p>
    </td>
  </tr>
</table>

More walkthroughs and recordings are in the [interactive demos](https://flintsh.github.io/Flare/demos.html).

## Quick start

**Railway:** start from the template, check the [Railway guide](https://flintsh.github.io/Flare/hosting/railway.html)
for storage and domain settings, then open `/setup`.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/JVT41u?referralCode=R5s8WT)

**Docker Compose:** in an empty directory, create a `.env` with two fresh secrets:

```sh
umask 077
printf 'POSTGRES_PASSWORD=%s\nNEXTAUTH_SECRET=%s\nNEXTAUTH_URL=http://localhost:3000\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
```

Save the `compose.yaml` below next to it, run `docker compose up -d`, and open
`http://localhost:3000/setup`. The first account you create is the administrator.

<details>
<summary><code>compose.yaml</code></summary>

```yaml
name: flare

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: flare
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: flare
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U flare -d flare']
      interval: 10s
      timeout: 5s
      retries: 10

  flare:
    image: ${FLARE_IMAGE:-flintsh/flare:latest}
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:3000'
    environment:
      DATABASE_URL: postgresql://flare:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432/flare?schema=public
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?Set NEXTAUTH_SECRET in .env}
      NEXTAUTH_URL: ${NEXTAUTH_URL:?Set NEXTAUTH_URL in .env}
    volumes:
      - uploads:/app/uploads
    depends_on:
      db:
        condition: service_healthy

volumes:
  postgres_data:
  uploads:
```

</details>

Flare listens on `127.0.0.1:3000` only. To use it from other devices, put it
behind [a reverse proxy with HTTPS](https://flintsh.github.io/Flare/hosting/reverse-proxy.html)
and set `NEXTAUTH_URL` to your public address. The [Docker guide](https://flintsh.github.io/Flare/hosting/docker.html)
covers pinning a version, existing databases and remote servers. Images are
published as `flintsh/flare` and `ghcr.io/flintsh/flare` for AMD64 and ARM64.

## Documentation

The [Flare handbook](https://flintsh.github.io/Flare/) has screenshots, recorded
demos, and docs archived for every stable release.

| I want to…                  | Read                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install and run Flare       | [Docker](https://flintsh.github.io/Flare/hosting/docker.html) · [Railway](https://flintsh.github.io/Flare/hosting/railway.html) · [Configuration](https://flintsh.github.io/Flare/hosting/configuration.html) · [Backups and upgrades](https://flintsh.github.io/Flare/hosting/maintenance.html) |
| Set up my screenshot tool   | [Screenshot tools](https://flintsh.github.io/Flare/guide/screenshot-tools.html) · [Upload profiles](https://flintsh.github.io/Flare/guide/upload-profiles.html)                                                                                                                                  |
| Share and organize files    | [Uploading](https://flintsh.github.io/Flare/guide/uploading.html) · [Sharing and privacy](https://flintsh.github.io/Flare/guide/sharing.html) · [Folders](https://flintsh.github.io/Flare/guide/folders.html)                                                                                    |
| Run an instance for a group | [First-run setup](https://flintsh.github.io/Flare/admin/setup.html) · [Roles](https://flintsh.github.io/Flare/admin/roles.html) · [Single sign-on](https://flintsh.github.io/Flare/admin/sso.html) · [Email](https://flintsh.github.io/Flare/admin/email.html)                                   |
| Build an integration        | [API](https://flintsh.github.io/Flare/api/) · [Webhooks](https://flintsh.github.io/Flare/api/webhooks.html) · [OpenAPI](https://flintsh.github.io/Flare/openapi.json)                                                                                                                            |
| Fix a problem               | [Troubleshooting](https://flintsh.github.io/Flare/hosting/troubleshooting.html) · [Discord](https://discord.gg/mwVAjKwPus)                                                                                                                                                                       |

## Community

- **Help and updates:** join the [Discord](https://discord.gg/mwVAjKwPus).
- **Bugs and ideas:** open an [issue](https://github.com/FlintSH/Flare/issues).
- **Contributing:** read [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [docs contribution guide](docs/site/contributing.md).
- **Security reports:** follow [SECURITY.md](SECURITY.md).

## License

Flare is MIT licensed and made by [FlintSH](https://fl1nt.dev). Icon designed by
[xNefas](https://ko-fi.com/xnefas/).
