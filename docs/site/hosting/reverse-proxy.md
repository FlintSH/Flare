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

Builds before this fix cut every API request body off at 10 MB inside Flare itself, whatever the proxy allowed. Next.js copies a request's body when middleware runs for it and keeps only the first 10 MB of the copy the route reads. A direct upload larger than that failed with `500` and "Upload could not be completed." A chunk part between 10 MB and 64 MiB was stored short, so completing that upload failed with `400` and "Uploaded size does not match the declared file size." and Flare discarded it; no shortened file was published. Browser uploads were unaffected because the dashboard sends 5 MiB parts. Middleware no longer runs for `/api` routes, so request bodies reach them whole, up to your configured limits. Retry uploads that failed this way after upgrading.

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

Values that are not addresses are skipped. Brackets and ports are removed, so `[2001:db8::1]:443` counts as `2001:db8::1` and `203.0.113.9:51234` as `203.0.113.9`, and an IPv4-mapped address counts as its IPv4 address however it is written, so `::ffff:203.0.113.9`, `::ffff:cb00:7109`, and `0:0:0:0:0:ffff:203.0.113.9` all count as `203.0.113.9`. Other IPv6 addresses are compared in their standard shortest form, so `2001:0db8:0:0:0:0:0:1` and `2001:db8::1` are the same client. Requests that carry no usable address share a single limit with each other, and their sessions and login history show no address.

Both headers contain whatever your proxy forwards, so configure the edge to **set or overwrite** them, as the Caddy and nginx examples above do. A widely copied nginx line, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, appends the real address to any `X-Forwarded-For` value the client sent, which leaves the client's own value first. Flare reads `X-Real-IP` before `X-Forwarded-For` for that reason: set `X-Real-IP` to `$remote_addr` and never pass a client-supplied one through. Clients that can reach the application port directly can send either header themselves.

- **Railway:** the edge proxy sets `X-Real-IP` to the address that connected to it, which is the client when nothing sits in front of Railway. No setting is needed.
- **A CDN or load balancer in front of your proxy or platform:** the connecting address is the CDN's, so everyone served by one CDN location would share each limit. Either restore the client address at your proxy so it arrives in `X-Real-IP` (for example with nginx's `real_ip` module and the CDN's published address ranges), or set `FLARE_CLIENT_IP_HEADER` to the header your CDN sends, such as `CF-Connecting-IP` for Cloudflare, `Fly-Client-IP` on Fly.io, or `True-Client-IP` where your CDN provides it.

With `FLARE_CLIENT_IP_HEADER` set, Flare reads only that header, using its first entry if it is a list, and ignores `X-Real-IP` and `X-Forwarded-For`. Use it only when every request reaches Flare through that edge and the edge overwrites the header. A request that bypasses the edge could otherwise choose its own address. Requests without the header share one limit. See [configuration](/hosting/configuration#core-environment-variables).

Request rate limits, other than the database-backed sign-in and email limits, are kept in memory by each Flare process and reset when it restarts. Separate replicas count separately; the [hosting overview](/hosting/#multiple-replicas-and-serverless-hosts) recommends one.

Earlier versions read the first `X-Forwarded-For` entry before `X-Real-IP` for upload, registration, setup, invite, upload-token, and shared-archive limits, while sign-in, email, and session history read `X-Real-IP` first, and none of them checked that the value was an address. Every limit now uses the order above. With the proxy examples in this guide, both headers carry the same address and nothing changes. Behind a proxy that appends to `X-Forwarded-For` and sets `X-Real-IP`, those limits now follow `X-Real-IP`, so a client can no longer reset them by sending its own `X-Forwarded-For`. Header values that are not addresses no longer become limit keys of their own.

## Client addresses in session history

[Active sessions and login history](/guide/account#login-history-and-active-sessions) record client-address and browser information when it is available. The address follows the [rules above](#client-addresses-and-rate-limits); an IP value is not independent proof of identity. Keep the application port private and have the trusted edge replace incoming forwarding headers, as in the examples above. A user-agent string is supplied by the client and can be imitated. Do not infer an exact device or physical location from these fields.

## Passkeys and hostname changes

Passkey registration and sign-in verify the origin and relying-party hostname derived from `NEXTAUTH_URL`. Use the canonical HTTPS hostname in both the environment and the browser. Do not rely on a forwarded `Host` header to select a different passkey origin. Local HTTP localhost is for development; use HTTPS for a deployed instance.

A passkey registered at one hostname cannot sign in at a different hostname. Before moving domains, users who require passkeys must preserve their dedicated passkey recovery codes, or explicitly choose **Allow other sign-in methods** while a passkey still works. Password plus authenticator/recovery code or SSO is a fallback only with that requirement off. After the move, sign in through an allowed method and register new passkeys. Dedicated passkey recovery works with the account's current email and a saved code, keeps the requirement on, and provides five minutes to enroll a replacement key. Keep the previous hostname available during a planned transition when possible, and communicate the cutover before relying on the new host. [Sign-in security](/guide/security) covers account recovery.

## Verify the public origin

After changing `NEXTAUTH_URL`, recreate the app container and use the final hostname in your browser. Verify:

- Sign-in and sign-out stay on the HTTPS hostname.
- Passkey registration and sign-in succeed on the canonical origin with a disposable account, and a signed-out private window still enforces the device prompt.
- Saving Settings succeeds without an origin error.
- A generated screenshot-tool configuration contains the public URL.
- A large upload succeeds and a video can seek to a later position.
- A private file stays unavailable in a signed-out browser.
- If configured, OIDC returns to `/api/auth/callback/oidc` on this hostname, and account email links use the same public origin.
