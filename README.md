<div align="center">

<img src="public/corey-robot-builder.png" alt="COREY logo" width="140" />

# COREY

### Review IFC model data visually, configure validation clauses, fix it in Excel, validate again.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Runs in Docker](https://img.shields.io/badge/Runs%20in-Docker-blue?logo=docker&logoColor=white)](#-easy-setup-recommended)

</div>

---

## 🤔 What is COREY?

COREY helps project teams review IFC model data for **CORENET X** workflows. It
was built for a world where BIM submissions carry heavier data requirements, and
teams need a faster way to check and correct those requirements before submission.

The workflow is simple:

```text
Open IFC -> validate against checking clauses -> export to Excel
-> batch edit -> import back into COREY -> validate again
```

You can see the building in 3D, click problem elements, inspect their data, and
use familiar Excel workflows to fix repeated data gaps.

> 💡 **No account, no upload required.** By default everything runs locally on your
> machine — your model files never leave your computer.

## ✨ What can it do?

| | Feature |
|---|---|
| 📂 | Open IFC files straight from your computer |
| 🧱 | Explore the building in an interactive **3D viewport** |
| 🔍 | Click any element to inspect its **properties** and place in the building tree |
| 👁️ | **Hide, isolate, slice (section), and measure** parts of the model |
| 📊 | Review model data in tables, with **Excel import/export** |
| ✏️ | Batch update IFC data through an Excel round trip |
| ✅ | Run **rule-based checks** and highlight validation issues |
| 🗄️ | *(Optional)* Save models to your own server with a database & file storage |

---

## 🚀 Easy Setup (Recommended)

The simplest way to run COREY is with **Docker** — one command, nothing else to install.

**Before you start:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
and make sure it's running.

**1.** Download or clone this project, then open a terminal inside the project folder.

**2.** Create your settings file from the example:

```bash
cp .env.example .env
```

**3.** Start everything (the app, database, and file storage):

```bash
docker compose --env-file .env -f docker/docker-compose.yml up --build
```

**4.** Open your browser to **[http://localhost:4000](http://localhost:4000)** 🎉

That's it. The first run takes a few minutes to download and build; later runs are fast.

> 📦 Prefer not to build from source? Pull a ready-made image:
> ```bash
> docker pull ghcr.io/jhjhjhjh/corey:latest
> ```

---

## 🧑‍💻 For Developers

<details>
<summary><strong>Run locally with Node + pnpm</strong></summary>

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:4000` and choose an IFC file from disk.

</details>

<details>
<summary><strong>Develop inside Docker (live reload)</strong></summary>

Use the development Compose file to run the app, Postgres, and MinIO in Docker
while editing source on the host:

```bash
cp .env.example .env
docker compose --env-file .env -f docker/docker-compose.dev.yml up --build
```

Open `http://localhost:4000`.

The dev container bind-mounts the repository and keeps `node_modules`, `.next`,
generated Prisma files, and the pnpm store in Docker volumes. It intentionally
runs `next dev --webpack` with polling enabled because Next.js 16 uses Turbopack
by default, and Turbopack can miss hot reload invalidation on Docker-mounted
filesystems.

If you change the Compose file or the dev server command, recreate the app service:

```bash
docker compose --env-file .env -f docker/docker-compose.dev.yml up -d --force-recreate app
```

</details>

<details>
<summary><strong>Run without MinIO (Postgres only)</strong></summary>

Use the release Compose file when you only need the local-first viewer plus
Postgres-backed routes, or when object storage is provided separately:

```bash
docker compose --env-file .env -f docker/docker-compose.release.yml up --build
```

This stack starts the app, Postgres, and migrations only. It sets placeholder S3
values so the app and health check can start, but server-backed model
upload/download still requires real S3-compatible storage. To avoid a local port
conflict, set `APP_PORT` for the host binding:

```bash
APP_PORT=4010 docker compose --env-file .env -f docker/docker-compose.release.yml up --build
```

</details>

<details>
<summary><strong>Configuration (environment variables)</strong></summary>

Copy `.env.example` to `.env` for local development. Required backend variables:

- `DATABASE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `COREY_MAX_MODEL_BYTES`

The backend is intended for single-tenant / self-hosted deployments. Put a reverse
proxy in front of it on public networks, and configure payload limits, TLS,
authentication, and rate limits there.

</details>

<details>
<summary><strong>Documentation, assets & verification</strong></summary>

**Docs** are built with Fumadocs and served at `http://localhost:4000/docs`.
Content lives in `content/docs`. After editing:

```bash
pnpm docs:generate
pnpm build
```

**Runtime assets** served from `public/`:

- `public/workers/thatopen-fragments-worker.mjs`
- `public/wasm/web-ifc.wasm`
- `public/wasm/web-ifc-mt.wasm`

If `@thatopen/fragments` or `web-ifc` changes, refresh the copied files from
`node_modules` and run `pnpm check:assets`.

**Sample assets:** COREY does not ship a public sample IFC by default. Commit IFC
samples only when their redistribution rights are explicit and documented in
`public/resources/README.md`.

**Verification:**

```bash
pnpm lint
pnpm check:assets
pnpm build
pnpm audit --prod
```

`pnpm build` generates Fumadocs sources, then intentionally uses `next build --webpack`.

</details>

---

## 🛠️ Built With

Next.js 16 · React 19 · Tailwind CSS 4 · [That Open](https://thatopen.com) · Three.js ·
web-ifc · Prisma · Postgres · S3-compatible object storage

## 📄 License

MIT — see [`LICENSE`](LICENSE) and [`docs/third-party-notices.md`](docs/third-party-notices.md).
