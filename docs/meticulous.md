# Meticulous visual tests

Flare uses both the browser recorder and the backend recorder for Next.js server
rendering. The browser passes a session ID to the backend recorder, which instruments
Prisma and other supported clients. Production recording stays off unless explicitly
enabled. Meticulous's injected replay mode enables backend instrumentation during tests.
The Prisma client applies the recorder's extension explicitly, as required when
Next.js bundles database calls.

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
browser captures HTTP-only cookies, unlike the page script alone. Sign in with the
fixture user, then start a fresh recording by opening `http://localhost:3000/dashboard`
in a new tab of the same recording browser. The session must start with its
authentication cookie already present: a stubbed sign-in response does not create
a server session for subsequent server-rendered requests. Exercise the UI from
there. When automating this browser, call `window.Meticulous.record.flush()` before
closing it so the final interactions are uploaded.

## CI activation

The workflow builds the image and checks that the fresh database and app start.
`METICULOUS_API_TOKEN` is the only required GitHub secret. No database or NextAuth
secret needs to be provisioned externally.

The project's Network Stubbing setting must be **Stub all requests, apart from
requests for server components and static assets**. This is configured in the
Meticulous dashboard, and lets each build render its own React Server Components
instead of reusing recorded development-build responses.

Before the setup is merged into `main`, CI uploads a reusable deployment and saves
its ID as the `meticulous-deployment` artifact. This allows a cloud replay before
comparisons have a baseline. Once `main` contains `Dockerfile.meticulous`, the
workflow automatically switches to standard base/head comparisons. No repository
activation variable or support approval is required. Record new sessions with the
backend recorder installed; older browser-only sessions do not contain backend
recordings.
