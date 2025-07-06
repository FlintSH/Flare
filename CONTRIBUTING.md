# Contributing to Flare

Contributing to the app is pretty simple, I try to keep the rules pretty straight forward and open ended.

## Overall, the process is:

1. Fork the repo
2. Make your changes
3. Test that it works
4. Submit a pull request
5. Profit

## Basic Rules

- Use TypeScript, keep any new methods type safe and don't use `any`.
- Make sure your fork builds and runs. A CI step will test this for you in your PR later on
- Try to follow existing patterns, look at the codebase for examples. You can find common imports in the `/lib` directory.
- **Do not over-engineer!!!** Try to keep your PRs small and focused.

## AI Usage

Given that AI written code is such a contentious topic in 2025, I want to make it explicitly clear for this repository: **AI written code is totally fine for Flare, just be responsible.**

\***\*Being responsible means\*\***:

- Only using AI to generate code you could have written and understood yourself
- Carefully reviewing and modifying any AI generated code before submitting
- Ensuring the code fits Flare's style and standards
- Never submitting AI code blindly or without your own input and changes

<sub>**Note:** All code (AI or not) will be manually reviewed by me, so if an AI model messes something up, I'll catch it during review. I work for an AI company, I am optimistic about this technology, but please do not try to contribute AI written code if its not code you could have written yourself.</sub>

## Setting up Local Dev

Flare is (by design) pretty easy to develop for. Since the backend and frontend are bundled together as one Next.JS server, everything is pretty plug and play. To get going you just need a Postgres instance running, Docker and Bun.

```bash
# intall deps
bun install

# setup db (using docker, optional)
docker run --name flare-db -e POSTGRES_PASSWORD=postgres -d -p 5432:5432 postgres:16

# configure your local envs
cp .env.example .env
# edit .env with your connection string and a auth secret

# run any db migrations
bunx prisma migrate dev

# start flare dev server
bun dev
```

## Making Commits

No strict rules here on your commits, just make sure your commit messages describe what the change does in some capacity. The exact format isn't important to me. What matters is that anyone reading it can understand what was changed and why.

## Pull Requests

Follow the PR template and fill in all required info. If your PR includes any frontend changes please try to include screenshots/screen-recordings to make reviewing easier please.

All PRs will be manually reviewed by me.

---

That's all, short and sweet. If you want any help or if you want my input on anything you're working on feel free to reach out on the [Discord](https://discord.gg/t4rGHBJy) and I'd be happy to help.
