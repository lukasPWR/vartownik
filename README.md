# VARtownik

**VARtownik** is an expert-class tournament simulator designed for participants of professional football quizzes. The application replicates the rigorous conditions of elite competitions, focusing on high substantive difficulty, time pressure, and the necessity of rapid context switching between various football categories.

Built with a modern stack featuring **Astro 5**, **Vue 3.5**, and **Supabase**, it leverages AI models to generate unique sets of expert-level questions, forcing focus and honest self-assessment.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Scope](#project-scope)
- [Getting Started Locally](#getting-started-locally)
- [Available Scripts](#available-scripts)
- [Project Status](#project-status)
- [License](#license)

---

## Tech Stack

### Frontend & UI
- **Astro 5**: Core meta-framework for high-performance server-side rendering (SSR).
- **Vue 3.5+ (Composition API)**: Powering interactive "islands" like the Game Engine and CRUD forms.
- **TypeScript 5**: Ensuring strict typing across the entire codebase.
- **Tailwind CSS 4**: Modern utility-first styling.
- **Shadcn-vue**: Professional UI components based on Radix Vue.
- **Lucide Vue Next**: For consistent iconography.
- **Nano Stores**: Lightweight state management for cross-island communication.

### Backend & Infrastructure
- **Supabase**: 
  - **PostgreSQL**: Relational database for structured quiz data.
  - **Auth**: Email/password authentication.
  - **Storage**: Image hosting for quiz assets.
  - **RLS (Row Level Security)**: Strict data isolation per user.
- **AI Integration**: **OpenRouter.ai** API (GPT-4o, Claude 3.5 Sonnet, etc.) via optimized Prompt Engineering.
- **Deployment**: Dockerized environment, CI/CD via GitHub Actions, hosted on DigitalOcean.

---

## Project Scope

### Key Features
- **AI-Powered Generator**: Generates 40 expert-level questions (4 rounds of 10) in a single session with mixed categories (Ekstraklasa, World Cup/Euro history, stats, etc.).
- **Game Engine**: 
  - 15-30 second timer per question.
  - **Scratchpad**: Practice area for drafting answers before revelation.
  - No pause/save during rounds to prevent cheating.
- **Self-Assessment System**: Users verify their own answers ("I knew it" / "I didn't know it") with full history tracking.
- **CRUD Dashboard**: Manage a private database of questions, including manual entry and correction of AI-generated content.
- **Analytics**: Performance tracking by category and difficulty score (1-5).

---

## Getting Started Locally

### Prerequisites
- **Node.js**: v22.14.0 (Check `.nvmrc`)
- **Docker**: Required for running local Supabase containers.
- **Supabase CLI**: Installed via `npm` (run via `npx`).

### Installation
1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/vartownik.git
   cd vartownik
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Environment Variables**:
   Copy `.env.example` to `.env` and fill in your Supabase and OpenRouter credentials.
   ```bash
   cp .env.example .env
   ```

4. **Initialize Supabase**:
   ```bash
   npx supabase start
   ```

5. **Run the development server**:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

---

## Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts the Astro development server. |
| `npm run build` | Builds the production-ready SSR application. |
| `npm run preview` | Previews the production build locally. |
| `npm run lint` | Runs ESLint for code quality checks. |
| `npm run lint:fix` | Automatically fixes linting issues. |
| `npm run format` | Formats code using Prettier. |
| `npm run ai:rules` | Syncs AI-specific rules for the development environment. |

---

## Project Status

**Current Version:** 0.0.1 (Early Development)

- [x] Tech stack defined and initialized.
- [x] Basic Auth flow implemented with Supabase.
- [x] Project structure and guidelines established.
- [ ] AI Question Generator implementation (In Progress).
- [ ] Game Engine development.
- [ ] Analytics & Statistics module.

---

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for more details.
