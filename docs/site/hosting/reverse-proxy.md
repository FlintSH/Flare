---
description: Put Flare behind HTTPS with Caddy or nginx, preserving client identity, large uploads, and authenticated file access.
---

# HTTPS and reverse proxies

Give Flare a dedicated hostname such as `files.example.com`. Set `NEXTAUTH_URL=https://files.example.com` and route the whole hostname to the application. Flare's routes and generated URLs assume it lives at the origin root; a `/flare` subdirectory deployment is not configured by this repository.

These examples assume the [Docker guide](/hosting/docker) with the application reachable from the host at `127.0.0.1:3000`. Point the hostname's DNS records to your server and allow inbound TCP ports 80 and 443.

## Caddy

For Caddy installed directly on the same server, add this to its Caddyfile:

```text
files.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
}
```

Validate and reload your configuration using your Caddy installation's service commands. Caddy's default reverse proxy preserves the request host and sets forwarding headers while ignoring untrusted incoming forwarding values. The explicit real-IP header also replaces a user-supplied value. If another CDN or load balancer sits before Caddy, configure trusted proxies for that actual upstream. [Caddy reverse-proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

When Caddy runs in Docker on the same Compose network, use `reverse_proxy flare:3000` and persist Caddy's certificate state. A container's loopback address does not reach the host or another container.

## nginx

This example assumes nginx runs on the host and TLS certificate files have already been provisioned at the shown paths. Replace the hostname and certificate paths with your own.

```nginx
server {
    listen 80;
    server_name files.example.com;
    return 308 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name files.example.com;

    ssl_certificate /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    # Example proxy ceiling: allow headroom for multipart request overhead.
    client_max_body_size 110m;
    client_body_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Check and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

The forwarding headers above assume nginx directly receives client requests. They intentionally replace incoming client-IP headers. If nginx is behind a trusted proxy, configure nginx's real-IP handling for that proxy before using `$remote_addr`. Request buffering and proxy timeout options are described in [nginx's proxy module documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Align all upload limits

An upload crosses several independent limits: browser/tool behavior, CDN or tunnel, reverse proxy, Flare's maximum file size, the user's remaining quota, and available storage. Increasing the Flare setting does not change the others.

Flare defaults to a **100 MB** maximum file size, calculated in binary units. The nginx example leaves extra room above that for a multipart request. If you increase the application limit, increase the proxy ceiling to fit the largest request you intend to accept. Chunking can reduce the size of individual requests, but direct upload clients still send their whole file in one request.

Builds before this fix cut every API request body off at 10 MB inside Flare itself, whatever the proxy allowed. Next.js copies a request's body when its proxy (formerly called middleware) runs for it and keeps only the first 10 MB of the copy the route reads. A direct upload larger than that failed with `500` and "Upload could not be completed." A chunk part between 10 MB and 64 MiB was stored short, so completing that upload failed with `400` and "Uploaded size does not match the declared file size." and Flare discarded it; no shortened file was published. Browser uploads were unaffected because the dashboard sends 5 MiB parts. Flare's proxy no longer runs for `/api` routes, so request bodies reach them whole, up to your configured limits. Retry uploads that failed this way after upgrading.

## Keep access decisions in Flare

Send file routes to the application. Do not publish the uploads directory as an unrestricted static directory; doing that would bypass the visibility and password checks on Flare's file routes. Similarly, do not add blanket shared caching for authenticated APIs, account pages, or protected file responses.

Flare sends `Cache-Control: private, no-store` with content, downloads, signed-URL redirects, and access denials for private and password-protected files, so a CDN or caching proxy that follows origin headers does not store them. Do not add rules that cache `/api/files/` or `/raw` paths regardless of those headers. Public files without a password can be cached: video at `/api/files/{path}` with `public, max-age=31536000`, and thumbnails at `/api/files/{id}/thumbnail` with `public, max-age=31536000, immutable`. When someone makes such a file private or adds a password, purge both paths from your CDN. Flare cannot recall a copy that a cache or browser already holds; browsers keep theirs until it expires or their cache is cleared.

Earlier releases sent `public, max-age=31536000` for every video at `/api/files/{path}`, including private and password-protected ones. If a CDN or shared cache sits in front of Flare, purge its cached `/api/files/` paths once after upgrading. Purging the whole prefix is simplest; public content is fetched again on the next request.

For S3, Flare can issue temporary signed object URLs after authorizing access. Those URLs are bearer links until they expire; see [S3 access behavior](/hosting/storage#private-files-and-signed-links).

Flare uses forwarded client addresses for request throttling and session history. Keep the app port private to the proxy and replace untrusted headers at the edge, as described in [client addresses and rate limits](#client-addresses-and-rate-limits).

## Client addresses and rate limits

Behind a proxy, every connection reaches Flare from the proxy itself, so Flare reads the client address from forwarding headers. Request rate limits, sign-in and email limits, shared-archive limits, login history, and active sessions all use the same address:

1. `X-Real-IP`, when it holds an IPv4 or IPv6 address.
2. Otherwise the first entry of `X-Forwarded-For`.

Values that are not addresses are skipped. Brackets and ports are removed, so `[2001:db8::1]:443` counts as `2001:db8::1` and `203.0.113.9:51234` as `203.0.113.9`, and an IPv4-mapped address counts as its IPv4 address however it is written, so `::ffff:203.0.113.9`, `::ffff:cb00:7109`, and `0:0:0:0:0:ffff:203.0.113.9` all count as `203.0.113.9`. Other IPv6 addresses are compared in their standard shortest form, so `2001:0db8:0:0:0:0:0:1` and `2001:db8::1` are the same client. Requests that carry no usable address count as one client in each limit, except file password checks, which count them only toward the file's own limit, as [incorrect password attempts](/guide/sharing#incorrect-password-attempts) explains. The in-memory limits described below count them as `127.0.0.1`, together with any request from that address. Their sessions and login history show no address.

Both headers contain whatever your proxy forwards, so configure the edge to **set or overwrite** them, as the Caddy and nginx examples above do. A widely copied nginx line, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, appends the real address to any `X-Forwarded-For` value the client sent, which leaves the client's own value first. Flare reads `X-Real-IP` before `X-Forwarded-For` for that reason: set `X-Real-IP` to `$remote_addr` and never pass a client-supplied one through. Clients that can reach the application port directly can send either header themselves.

- **Railway:** the edge proxy sets `X-Real-IP` to the address that connected to it, which is the client when nothing sits in front of Railway. No setting is needed.
- **A CDN or load balancer in front of your proxy or platform:** the connecting address is the CDN's, so everyone served by one CDN location would share each limit. Either restore the client address at your proxy so it arrives in `X-Real-IP` (for example with nginx's `real_ip` module and the CDN's published address ranges), or set `FLARE_CLIENT_IP_HEADER` to the header your CDN sends, such as `CF-Connecting-IP` for Cloudflare, `Fly-Client-IP` on Fly.io, or `True-Client-IP` where your CDN provides it.

With `FLARE_CLIENT_IP_HEADER` set, Flare reads only that header, using its first entry if it is a list, and ignores `X-Real-IP` and `X-Forwarded-For`. Use it only when every request reaches Flare through that edge and the edge overwrites the header. A request that bypasses the edge could otherwise choose its own address. Requests without the header share one limit. See [configuration](/hosting/configuration#core-environment-variables).

Request rate limits, other than the database-backed sign-in and email limits, are kept in memory by each Flare process and reset when it restarts. Separate replicas count separately; the [hosting overview](/hosting/#multiple-replicas-and-serverless-hosts) recommends one.

Earlier versions read the first `X-Forwarded-For` entry before `X-Real-IP` for upload, registration, setup, invite, upload-token, and shared-archive limits, while sign-in, email, and session history read `X-Real-IP` first, and none of them checked that the value was an address. Every limit now uses the order above. With the proxy examples in this guide, both headers carry the same address and nothing changes. Behind a proxy that appends to `X-Forwarded-For` and sets `X-Real-IP`, those limits now follow `X-Real-IP`, so a client can no longer reset them by sending its own `X-Forwarded-For`. Header values that are not addresses no longer become limit keys of their own.

## Client addresses in session history

[Active sessions and login history](/guide/account#login-history-and-active-sessions) record client-address and browser information when it is available. The address follows the [rules above](#client-addresses-and-rate-limits); an IP value is not independent proof of identity. Keep the application port private and have the trusted edge replace incoming forwarding headers, as in the examples above. A user-agent string is supplied by the client and can be imitated. Do not infer an exact device or physical location from these fields.

## Browser origin checks

When a browser's session cookie authenticates a change, such as saving settings, uploading or deleting, Flare accepts it only from its own pages. The request's `Origin` must be the origin of `NEXTAUTH_URL`, or the address the app itself serves, which is what you use when you open `http://localhost:3000` directly. Behind a proxy that ends TLS, only the first can match, so set `NEXTAUTH_URL` to the exact scheme, hostname and port people use; otherwise every change answers `403` with `Cross-origin requests are not allowed.` Flare never reads the origin from `Host` or `X-Forwarded-Host`. API tokens aren't checked. The [browser-session write rule](/api/authentication#browser-session-writes) has the details.

Flare reads `NEXTAUTH_URL` in one place. It must be an `http` or `https` URL without a username or password. Origin checks, passkeys, the default email link address, archive unlock cookies and upload links ignore any other value, and generated screenshot-tool configurations refuse it with `Invalid server URL configuration`.

Earlier builds read it seven ways. Account security accepted only the exact `NEXTAUTH_URL` origin and answered `503` while it was unset; account email also accepted the origin of the email public URL, and failed with an unrelated error when `NEXTAUTH_URL` wasn't a URL. Both now follow the rule above, and only passkeys need `NEXTAUTH_URL`. A value without `http://` or `https://` used to end up in upload links as written.

## Pass request paths through unchanged

Proxy Flare at the root of its hostname and pass each request path to it as the browser sent it. Do not add or strip a path prefix, and do not let the proxy decode and encode the path again. Account key changes, such as a passphrase change, are [signed requests](/api/account-keys#signed-requests): the browser signs the method, the path and the body, and Flare verifies them against the request it received. If the proxy changed the path, the two no longer match and those requests answer `400`. The Caddy and nginx examples above already pass paths through unchanged.

## CORS and proxies

Configure cross-origin access with [`FLARE_CORS_ORIGINS`](./configuration#cross-origin-browser-access), not proxy rules. Flare answers preflight requests itself and sends CORS headers only on routes where named tokens or anonymous file reads apply. A proxy rule that adds `Access-Control-Allow-Origin` to every response would also expose session-only routes to the listed sites, and one added on top of Flare's produces two values, which browsers reject. Pass `OPTIONS` requests and the `Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers` headers through unchanged, as the examples above do.

With a list of origins, file content answers vary by the requesting site and carry `Vary: Origin`. A CDN that caches public videos or thumbnails but ignores `Vary` can then serve one site's answer to another, and the browser refuses it. Either set `FLARE_CORS_ORIGINS=*`, whose answers are the same for every site, or include `Origin` in the CDN's cache key.

## Passkeys and hostname changes

Passkey registration and sign-in verify the origin and relying-party hostname derived from `NEXTAUTH_URL`. Use the canonical HTTPS hostname in both the environment and the browser. Do not rely on a forwarded `Host` header to select a different passkey origin. Local HTTP localhost is for development; use HTTPS for a deployed instance.

A passkey registered at one hostname cannot sign in at a different hostname. Before moving domains, users who require passkeys must preserve their dedicated passkey recovery codes, or explicitly choose **Allow other sign-in methods** while a passkey still works. Password plus authenticator/recovery code or SSO is a fallback only with that requirement off. After the move, sign in through an allowed method and register new passkeys. Dedicated passkey recovery works with the account's current email and a saved code, keeps the requirement on, and provides five minutes to enroll a replacement key. Keep the previous hostname available during a planned transition when possible, and communicate the cutover before relying on the new host. [Sign-in security](/guide/security) covers account recovery.

## Security headers

Flare sends these headers on every response. Pass them through unchanged rather than overriding them at the proxy:

| Header                       | Value                                          |
| ---------------------------- | ---------------------------------------------- |
| `X-Content-Type-Options`     | `nosniff`                                      |
| `X-Frame-Options`            | `SAMEORIGIN`                                   |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`              |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=()`     |
| `Strict-Transport-Security`  | `max-age=63072000; includeSubDomains; preload` |
| `Cross-Origin-Opener-Policy` | `same-origin`                                  |

Sign-in pages also send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. File content routes add `Content-Security-Policy: sandbox`, so uploaded HTML, SVG, and other active documents can't run script as Flare; see [file content and access checks](/api/endpoint-inventory#file-content-and-access-checks). Every page also sends a `Content-Security-Policy` with a per-response nonce, described next.

### Content-Security-Policy

Flare's browser code holds encryption keys, so every HTML page sends a policy that lets script come only from the application:

```text
default-src 'self';
script-src 'self' 'nonce-<random>' 'strict-dynamic' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline' https: http:;
img-src 'self' data: blob: https: http:;
media-src 'self' blob: https: http:;
font-src 'self' data: https: http:;
connect-src 'self' https: http: ws: wss:;
frame-src 'self' blob:;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
frame-ancestors 'self'
```

- The nonce is new for every response. A script runs only if it carries it: Flare's own scripts, and each script of the administrator's [Custom HTML](/admin/appearance#custom-css-and-head-html). An injected inline script or inline event handler does not run.
- `'wasm-unsafe-eval'` lets the browser compile the Argon2id module that stretches passphrases. It does not allow `eval` of text.
- `blob:` and `data:` are where the page puts decrypted images, media and documents.
- Images, media, fonts, styles and connections to other sites stay allowed, because storage, CDNs and Custom HTML use them and none of them can run script.

What this means for a proxy:

- **Do not cache HTML pages.** A cached page would repeat one nonce for many visitors. Flare's pages are rendered per request; keep any proxy cache to `/_next/static/` and file content.
- **Do not rewrite page bodies** to inject scripts, such as a proxy-level analytics snippet or a "rocket loader" that rewrites script tags. The injected script has no nonce and is blocked. Put scripts in Custom HTML instead.
- **Do not add a second `Content-Security-Policy`** at the proxy. Browsers enforce every policy they receive, so a proxy policy can only remove permissions, and one without the nonce blocks all of Flare's scripts. If your proxy sets one by default, turn that off for Flare. Do not replace the header on file content routes either: those send `sandbox`.
- The API routes under `/api/` send no page policy. File content routes keep `Content-Security-Policy: sandbox`.

Flare reads no policy from the environment and has no setting for it in this release.

### The service worker for encrypted files

Encrypted video, audio, PDF and downloads are decrypted by a service worker in the visitor's browser ([what it does](/guide/encryption#video-audio-and-downloads)). Its script is one file:

```text
/_next/static/service-worker/sw.js
```

Flare serves it with two headers that matter:

| Header                    | Value                                                       | Why                                                                                                                           |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Service-Worker-Allowed`  | `/`                                                         | A worker may control only pages under its script's own path unless this header names a wider scope. Flare's pages are at `/`. |
| `Content-Security-Policy` | `default-src 'none'; connect-src 'self'; script-src 'self'` | The worker may fetch from your instance and nothing else, and runs no other script.                                           |

What this means for a proxy:

- **If the proxy or a CDN serves `/_next/static/` itself** (from a copy of the build, not by passing requests to Flare), it must send `Service-Worker-Allowed: /` for that file. Without it the browser refuses to register the worker. Nothing breaks for visitors: Flare falls back to decrypting whole files in memory, with [size limits for previews](/guide/encryption#video-audio-and-downloads). In nginx: `location = /_next/static/service-worker/sw.js { add_header Service-Worker-Allowed "/"; ... }`.
- **Do not cache that file for long.** Flare sends `Cache-Control: public, max-age=0, must-revalidate` for it, unlike the hashed files next to it. Browsers check it for updates on their own; a proxy that pins an old copy keeps visitors on an old worker after an upgrade.
- **Pass `Range` request headers and `206` answers through** for `/api/files/`. The worker reads ciphertext in byte ranges. A proxy that strips `Range`, or buffers and answers `200` with the whole file, makes every encrypted video fail its length check: the player shows an error and downloads fall back to memory.
- Requests for `/_flare/local/...` never reach your proxy. The worker answers them inside the browser. If you see one in an access log, that browser had no worker at that moment; Flare answers it like any unknown page.
- The worker needs a secure origin. Serve Flare over HTTPS. On plain HTTP (other than `localhost`) browsers have no service workers and Flare uses the fallback.

`Cross-Origin-Opener-Policy: same-origin` means a Flare page and a page on another site never get a window reference to each other, even when one opens the other. Links between them still work. Builds before this header was added let a page that opened Flare in a new tab keep a reference to it, though Flare's own outgoing links already used `noopener`.

## Verify the public origin

After changing `NEXTAUTH_URL`, recreate the app container and use the final hostname in your browser. Verify:

- Sign-in and sign-out stay on the HTTPS hostname.
- Passkey registration and sign-in succeed on the canonical origin with a disposable account, and a signed-out private window still enforces the device prompt.
- Saving Settings succeeds without an origin error.
- A generated screenshot-tool configuration contains the public URL.
- A large upload succeeds and a video can seek to a later position.
- A private file stays unavailable in a signed-out browser.
- If configured, OIDC returns to `/api/auth/callback/oidc` on this hostname, and account email links use the same public origin.
