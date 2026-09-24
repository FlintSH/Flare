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

## Keep access decisions in Flare

Send file routes to the application. Do not publish the uploads directory as an unrestricted static directory; doing that would bypass the visibility and password checks on Flare's file routes. Similarly, do not add blanket shared caching for authenticated APIs, account pages, or protected file responses.

For S3, Flare can issue temporary signed object URLs after authorizing access. Those URLs are bearer links until they expire; see [S3 access behavior](/hosting/storage#private-files-and-signed-links).

Flare uses forwarded client IPs for request throttling. Keep the app port private to the proxy and replace untrusted headers at the edge. This also keeps many users from incorrectly sharing the proxy's IP-based limit.

## Verify the public origin

After changing `NEXTAUTH_URL`, recreate the app container and use the final hostname in your browser. Verify:

- Sign-in and sign-out stay on the HTTPS hostname.
- Saving Settings succeeds without an origin error.
- A generated screenshot-tool configuration contains the public URL.
- A large upload succeeds and a video can seek to a later position.
- A private file stays unavailable in a signed-out browser.
- If configured, OIDC returns to `/api/auth/callback/oidc` on this hostname, and account email links use the same public origin.
