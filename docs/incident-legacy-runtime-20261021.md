# Older Flare incident runtime image

This maintenance branch starts at the source attested by the deployed 1.7.4
image: `ebe6eda017b23a7c7b24e4a7c1c0667c74d153b3`. It updates Next.js from
15.5.18 to 15.5.28 and explicitly locks Sharp 0.35.5. The original React 18.3.1,
application source, Prisma schema/migrations, authentication and encryption
code are retained. All Docker stages use the independently identified original
Node 24.17.0 base image digest.

The change addresses the [October 14 Next.js security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
and its [glibc image-optimizer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
The direct Sharp pin prevents an existing lockfile from retaining a vulnerable
version allowed by Next's broader dependency range.

The incident workflow runs only on `incident/older-flare-runtime-20261021`. It
builds one Linux AMD64 image, verifies the actual optimizer's resolved native
Sharp library and harmless SVG conversion, then runs the inherited entrypoint
against an isolated disposable PostgreSQL fixture. Assertions cover all six
Prisma migrations, config creation/upgrade, file-password migration and restart
idempotence, HTTP health, unauthenticated file access and invalid image requests.
No production database or credential is supplied to these tests.

After those checks pass, the exact tested image is pushed once under
`flintsh/flare:incident-20261021-legacy-<full-source-commit>`. Re-pulling must
produce the same image configuration digest. The run summary records the
immutable registry digest and source commit; labels record the source and base
digest. This Docker-load/push route has no separate BuildKit provenance
attestation. It preserves the exact tested artifact rather than rebuilding it
after verification.

The workflow does not update rolling, stable, latest or semantic-version tags,
and does not deploy the image. Runtime deployment requires selecting the
verified immutable digest separately. Successful fixture checks do not prove
production credential cutover or successful restoration of application data.
