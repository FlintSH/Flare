# Meticulous visual tests

Flare uses both the browser recorder and the backend recorder for Next.js server
rendering. The browser passes a session ID to the backend recorder, which instruments
Prisma and other supported clients. Production recording stays off unless explicitly
enabled. Meticulous's injected replay mode enables backend instrumentation during tests.

## Disposable test environment

No hosted PostgreSQL database is required. `Dockerfile.meticulous` extends the normal
app image with PostgreSQL and a process supervisor. On each container start it creates
a fresh database, runs migrations, adds public test fixtures, then starts Flare. The
database listens only on loopback inside that container; it is not exposed as a port.
The test entrypoint ignores external `DATABASE_URL` values. Never deploy this test
image as your real Flare instance.

```sh
docker build --build-arg METICULOUS_BUILD=true -t flare-meticulous-app .
docker build -f Dockerfile.meticulous -t flare-meticulous .
docker run --rm -p 3000:3000 flare-meticulous
```

Fixture login: `meticulous@example.test` / `Flare-test-only-2026!`. The fixed session
secret and fixture credentials are deliberately public and used only in this isolated
test image. Existing authentication guards remain enabled.

## Recording

For ordinary development, set `NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN` in your
gitignored `.env.local`. Backend recording starts before application imports.

To record against the production-built disposable image, explicitly enable recording
and pass the public token at runtime:

```sh
docker run --rm -p 3000:3000 \
  -e METICULOUS_RECORDING_ENABLED=true \
  -e NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN \
  flare-meticulous
```

Use `npx @alwaysmeticulous/cli record session` to record authenticated flows: its
browser captures HTTP-only cookies, unlike the page script alone. Navigate to
`http://localhost:3000/auth/login`, sign in with the fixture user, and exercise the
UI. When automating this browser, call `window.Meticulous.record.flush()` before
closing it so the final interactions are uploaded.

## CI activation

The workflow builds the image and checks that the fresh database and app start.
`METICULOUS_API_TOKEN` is the only required GitHub secret. No database or NextAuth
secret needs to be provisioned externally.

During initial verification, with `METICULOUS_REPLAY_READY` unset, CI uploads a reusable
deployment and saves its ID as the `meticulous-deployment` artifact. This allows a
cloud replay before enabling comparisons. Once verified, setting the repository
variable `METICULOUS_REPLAY_READY=true` enables the standard base/head comparison
workflow. The workflow must also be merged into `main` so future PRs can build their
baseline. Record new sessions with the backend recorder installed; older browser-only
sessions do not contain backend recordings.
