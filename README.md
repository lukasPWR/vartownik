# VARtownik

> A football quiz web application powered by AI question generation and intelligent answer verification.

## Table of Contents

- [Project Description](#project-description)
- [Tech Stack](#tech-stack)
- [Getting Started Locally](#getting-started-locally)
- [Available Scripts](#available-scripts)
- [Project Scope](#project-scope)
- [Project Status](#project-status)
- [License](#license)

## Project Description

VARtownik is an MVP web application for football quiz enthusiasts. It replicates the structure of professional football quiz competitions and extends it with two AI-powered systems:

- **RAG Question Generator** — produces fresh quiz questions derived exclusively from an imported knowledge base (JSON), guided by an administrator-defined Style Guide.
- **VAR Verification System** — validates user answers in two stages: first via the Levenshtein distance algorithm for typo tolerance, then via an LLM call for contextual synonym matching (e.g. accepting "Luluś" for "Lewandowski"). Users can appeal incorrect VAR decisions, which are logged for admin review.

Additional features include user account management, multiple game modes (Quick Training, Full Quiz, Marathon, Custom), a score summary after each session, and an admin panel for knowledge base management.

## Tech Stack

### Frontend

| Technology | Role |
|---|---|
| [Astro 5](https://astro.build/) | SSR framework, routing, page rendering (`output: "server"`) |
| [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`) | Interactive quiz islands |
| [TypeScript 5](https://www.typescriptlang.org/) | Type-safe code across the entire stack |
| [Tailwind CSS 4](https://tailwindcss.com/) | Utility-first styling |
| [shadcn-vue](https://www.shadcn-vue.com/) + [Radix Vue](https://www.radix-vue.com/) | Accessible, composable UI components |
| [Nano Stores](https://github.com/nanostores/nanostores) + [@nanostores/vue](https://github.com/nanostores/vue) | Lightweight cross-island state management |
| [lucide-vue-next](https://lucide.dev/) | Icon library |

### Backend & Data

| Technology | Role |
|---|---|
| [Supabase](https://supabase.com/) (PostgreSQL + pgvector) | Database, authentication, storage, edge functions |
| [Supabase Edge Functions](https://supabase.com/docs/guides/functions) | AI logic and VAR verification serverless handlers |
| [@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/) | SSR adapter (standalone mode) |

### AI

| Technology | Role |
|---|---|
| [OpenRouter.ai](https://openrouter.ai/) | Access to generative models (GPT-4o-mini, Claude Haiku) for RAG and VAR |
| Text-Embedding Models | Converting JSON knowledge base entries into pgvector-searchable embeddings |

### Tooling & CI/CD

| Technology | Role |
|---|---|
| GitHub Actions | CI/CD pipeline, Docker image builds |
| DigitalOcean App Platform | Production hosting (Node.js Docker image) |
| ESLint + Prettier | Linting and formatting (flat config) |
| Husky + lint-staged | Pre-commit hooks |

## Getting Started Locally

### Prerequisites

- **Node.js v22.14.0** (see `.nvmrc`) — use [nvm](https://github.com/nvm-sh/nvm) to install: `nvm use`
- **npm** (bundled with Node.js)
- **Docker** — required for running the local Supabase stack (~7 GB RAM)

### Setup

1. **Clone the repository:**

```bash
git clone <repository-url>
cd vartownik
```

2. **Install dependencies:**

```bash
npm install
```

3. **Configure environment variables:**

```bash
cp .env.example .env
```

4. **Start the local Supabase stack** (downloads Docker images on first run):

```bash
npx supabase start
```

After startup, the CLI prints the local credentials. Copy them into your `.env`:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key printed by CLI>
```

The local Supabase Studio UI is available at `http://localhost:54323`.

5. **Start the development server:**

```bash
npm run dev
```

The application runs at `http://localhost:3000`.

6. **Stop the local Supabase stack when done:**

```bash
npx supabase stop
```

### Using a hosted Supabase project

If you prefer a cloud Supabase project, set the following variables in `.env`:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase dashboard → Settings → API → `anon` public key |

> **Note:** In local development, disable email confirmation via Supabase dashboard → Authentication → Email → **Confirm email: off**, so users can sign in immediately after registration.

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server on port 3000 |
| `npm run build` | Production build (SSR via `@astrojs/node` standalone adapter) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the codebase |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format all files with Prettier |
| `npm run ai:rules` | Sync AI coding rules (runs `scripts/sync-ai-rules.sh`) |
| `npm run openspec:init` | Initialize OpenAPI spec (runs `scripts/init-openspec.sh`) |

Pre-commit hooks (Husky + lint-staged) automatically run `eslint --fix` on `*.{ts,vue,astro}` and `prettier --write` on `*.{json,css,md}` before each commit.

## Project Scope

### In scope (MVP)

- User registration and authentication (email/password via Supabase Auth)
- Admin panel for JSON data import with structural validation
- Admin panel for manual record management and AI index updates
- AI-powered question generation using RAG (based solely on the imported JSON knowledge base)
- Style Guide (few-shot prompting) configuration per category in the admin panel
- Optimistic UI: question pre-generation in the background during user interactions
- VAR answer verification: Levenshtein algorithm + LLM contextual synonym matching
- VAR decision logging for admin review and prompt optimisation
- User VAR appeal system (`Zgłoś błąd VAR`)
- Game modes: Quick Training, Full Quiz, Marathon, Custom (configurable time and rounds)
- Session score summary and results presentation
- Responsive web interface (desktop and mobile web)

### Out of scope (post-MVP)

- Automatic `.pptx` file parsing (manual admin conversion required)
- Multiplayer competition mode (Arena)
- Quiz sharing between user profiles
- AI-generated images for questions

## Project Status

**MVP — active development.**

Current success metrics targets:

| Metric | Target |
|---|---|
| AI question quality (user-accepted) | ≥ 80% |
| AI-generated question sessions | ≥ 60% of all sessions |
| Reduction in manual VAR error reports | ≥ 40% thanks to Levenshtein + LLM |
| VAR LLM response time | < 2 seconds average |

## License

MIT
