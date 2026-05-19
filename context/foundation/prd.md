---
project: VARtownik
version: 1
status: draft
created: 2026-05-19
context_type: brownfield
product_type: web-app
target_scale:
  users: small
  qps: "# TODO: target_scale.qps — see Open Questions"
  data_volume: "# TODO: target_scale.data_volume — see Open Questions"
timeline_budget:
  delivery_weeks: 4
  hard_deadline: "2026-06-30"
  after_hours_only: true
---

## Current System Overview

VARtownik is a football quiz simulator for individual competitive training. It is a fully server-rendered web application built with Astro 5 (SSR), Vue 3 (Composition API), TypeScript 5, Supabase (authentication, PostgreSQL database, and Storage), OpenRouter (LLM integration for quiz generation), Tailwind 4, shadcn-vue, and Nano Stores.

**Core functionality today:**
- User authentication (sign-in, sign-up, email confirmation via Supabase Auth with `@supabase/ssr` cookie-based sessions)
- AI-powered quiz generation: a 40-question set (4 rounds of 10 questions, mixed football categories) generated via a single LLM call through OpenRouter, using few-shot prompting at expert level
- Active game engine: question-by-question flow with a countdown timer, scratchpad field, and round/question progress indicators
- Dashboard with stats widgets (category radar chart, stat cards, recent sessions table)
- API routes and a services layer covering auth, categories, questions, sessions, generation-batches, tags
- Row Level Security enforcing per-user data isolation across all database tables

**Current user base:** Single-user private tool (personal use); data isolated per user at the database level.

**What is missing (gaps from original specification):**
- Round summary / self-assessment screen (no `RoundSummary` component exists)
- Question CRUD management page (no admin/manage page)
- Question flagging UI (the `flagged` status exists in the database but no UI exposes it)
- Stats/analytics completeness (dashboard widgets exist but underlying self-assessment data is not yet recorded)

---

## Problem Statement & Motivation

The existing codebase covers quiz generation and the active game engine. Three gaps block a user from completing a meaningful training session end-to-end:

1. **No post-round self-assessment loop.** After a round of 10 questions ends, there is no screen showing correct answers alongside scratchpad notes, and no mechanism to record whether the user knew each answer. Without this, training data cannot be captured and the session is incomplete.
2. **No question management panel.** AI-generated questions can contain errors. There is no UI to review, correct, or delete them, and no way to surface flagged (suspected-incorrect) questions for resolution. The `flagged` column exists in the database but is unusable.
3. **Incomplete progress analytics.** Dashboard widgets exist in code, but the underlying per-round self-assessment data is not recorded, so accuracy metrics cannot be computed or displayed.

The trigger for completing these gaps now is the 10xDevs course sprint cycle (hard deadline: 2026-06-30) and the goal of having a fully functional personal training tool by that date.

**Current workaround:** None — the missing features make a full end-to-end training session impossible.

---

## User & Persona

**Primary persona:** Solo competitive football quiz player — an individual who regularly participates in organized football trivia tournaments (e.g. PilkarskiQuiz.pl), trains individually at home, and wants to simulate tournament pressure: high-difficulty questions, strict time limits (15–30 seconds per question), mixed categories, and a personal verified question bank.

**Access:** Email and password authentication (already implemented). Single-user private tool; flat user model with no role separation. Each user's data is fully isolated from all others.

No secondary persona.

---

## Success Criteria

### Primary

A user can complete a full 40-question game session (4 rounds of 10 questions) without a single dead-end:

1. User starts quiz generation — loading screen with football facts appears.
2. Questions are presented one by one with timer and scratchpad.
3. After each round of 10 questions, the round summary screen appears with correct answers and scratchpad notes displayed side-by-side.
4. User marks each question "Wiedziałem" (knew it) or "Nie wiedziałem" (did not know) before proceeding.
5. User can optionally flag any question as suspected incorrect AI output.
6. All 4 rounds complete — session score is persisted.
7. Dashboard reflects the completed session in history and per-category accuracy.

### Secondary

A user can review and correct their question bank from a dedicated management page:
- View all personal questions, with a dedicated tab for flagged (suspected-incorrect) questions showing the count of unresolved flags.
- Edit, delete, or resolve flagged questions without leaving the app.

### Guardrails

- Existing sessions and questions data must not be wiped or corrupted.
- Per-user data isolation must remain complete — no user can access another's data.
- Auth sessions must not be invalidated by this change — users must not be logged out.
- Quiz generation time must remain ≤ 40 seconds from clicking "Generate" to the first question appearing.
- AI question quality: ≥ 80% of generated questions must contain at least two identifying parameters (e.g. player name + year, or club + season), confirming expert-level difficulty as assessed by the user over time.
- The game timer and round flow must be preserved exactly: no pause, no mid-round save, refresh = round lost.

---

## User Stories

### US-01: Complete a round with self-assessment

**Given** a player has answered all 10 questions of a round (either by answering or timer expiry),
**When** the round ends,
**Then** the player sees the round summary screen with all 10 questions, correct answers, and their scratchpad notes displayed side-by-side, and must mark each as "Wiedziałem" or "Nie wiedziałem" before the "Next round" button becomes active.

*Before this change: the game had no round summary screen; the round ended with no record of answers or self-assessment.*

### US-02: Flag a suspected AI error

**Given** a player is on the round summary screen,
**When** they see a question they believe is factually incorrect,
**Then** they can flag it from that screen and it will no longer appear in future generated quizzes until resolved.

*Before this change: there was no way to flag questions from within the game flow.*

### US-03: Manage the question bank

**Given** a logged-in user is on the question management page,
**When** they want to fix an AI-generated question,
**Then** they can find it (by flagged status), edit its text and answer, and change its status back to active.

*Before this change: there was no question management UI.*

---

## Scope of Change

### Gap A — Round Summary & Self-Assessment

- [new] Round summary screen shown after each 10-question round, displaying each question with its correct answer and player's scratchpad note side-by-side (FR-006)
- [new] Per-question self-assessment marking ("Wiedziałem" / "Nie wiedziałem") on the round summary screen (FR-007)
- [new] Gate: the "Next round" button is inactive until all 10 questions in the current round are marked (FR-008)
  > Socrates: Counter considered: "the gate is gameable — users can click all 'Wiedziałem' to skip." Resolution: kept; the product trusts the user's self-assessment (explicit design choice — no automatic validation). Gaming the gate undermines only the user's own training data.
- [new] Per-question flagging from the round summary screen; flagged questions excluded from future quiz generation until resolved (FR-009)
  > Socrates: Counter considered: "flagging from the CRUD page is enough; don't add it to the game flow." Resolution: kept; the summary screen is the moment the user notices a problem. Requiring a separate CRUD visit creates friction that leads to unflagged errors staying in rotation.
- [new] Round score persisted to the session record after all questions in the round are marked (FR-010)

### Gap B — Question Management

- [new] Dedicated question management page showing the user's personal question bank (FR-011)
- [new] User can manually add a new question (text, correct answer, category, difficulty score) (FR-012)
- [new] User can edit an existing question's text, answer, category, or difficulty (FR-013)
- [new] User can delete a question from their bank (FR-014)
- [new] Dedicated "Flagged" tab within the management page; user can resolve or delete flagged questions; tab displays the count of unresolved flags as a badge (FR-015)
  > Socrates: Counter considered: "a filter on the main list achieves the same without a dedicated tab." Resolution: kept; a dedicated tab makes the review workflow explicit and surfaces the count of unfixed AI errors passively (badge on the tab label).
- [new] Flagged questions are excluded from AI quiz generation until manually resolved (FR-016)
  > Socrates: Counter considered: "excluding questions shrinks the pool and could degrade quiz quality." Resolution: kept; the whole point of flagging is to prevent known errors from appearing. Pool degradation is bounded — users typically flag a small fraction.
- [new] User can attach an image to a manually added question via cloud storage (FR-017) — Priority: nice-to-have

### Gap C — Stats & Analytics

- [new] Dashboard displays the user's overall correct-answer percentage based on self-assessment records (FR-018)
- [new] Dashboard displays per-category accuracy as a chart or list (FR-019)
  > Socrates: Counter considered: "a chart adds complexity; a list is equally useful." Resolution: kept as chart OR list — implementation choice deferred to downstream. The PRD mandates the capability, not the rendering format.
- [new] Dashboard displays the last 10 sessions with their scores and dates (FR-020)

### Preserved

- [preserved] User registration and login via email and password (FR-001)
- [preserved] AI-powered quiz generation: 40 questions across 4 rounds of 10 (FR-002)
- [preserved] Loading screen with rotating football facts during quiz generation (FR-003)
- [preserved] Question-by-question gameplay with countdown timer and scratchpad (FR-004)
- [preserved] Timer locks the scratchpad when it reaches zero (FR-005)

---

## Constraints & Compatibility

- **AI generation integration must not change.** The quiz generation logic, prompting strategy, and external AI integration must not be modified as part of this completion work.
- **No destructive database schema changes.** Existing tables (questions, sessions, attempts, categories, tags) and their current columns must remain structurally compatible — no columns may be removed or renamed. New columns or tables may be added.
- **Per-user data isolation must remain intact.** Any new tables or columns must have per-user data isolation policies applied from the moment of creation.
- **Game timer and round flow must be preserved exactly.** No pause functionality, no mid-round save, refresh = round lost — this is a deliberate tournament simulation constraint.
- **No backward-compatibility obligations to external consumers.** This is a private single-user app with no public API surface.

---

## Business Logic Changes

No domain logic change. This is a completion change — the core quiz generation domain rule is preserved unchanged.

**Existing rule (preserved):** VARtownik assembles a balanced, expert-difficulty question set from the user's personal question bank on demand. The rule consumes: a set of predefined categories with fixed weights (Ekstraklasa, Historia MŚ/Euro, Statystyki, Piłka zagraniczna, Reprezentacja Polski), a target of 4 rounds with 10 questions each, and the user's flagged-question exclusion list. It produces 40 questions grouped into 4 rounds, with category distribution matching the defined weights within each round, generated in a single AI generation call at expert level (minimum two identifying parameters per question: e.g. player name + year + club). On a malformed AI response, the rule retries up to 2 times before surfacing an error to the user. The user encounters the rule each time they press "Generate" — the loading screen is the system executing this rule.

**Delta:** The flagged-question exclusion list is now actively enforced (FR-016). This is an application of the existing rule's stated input — not a change to the rule itself.

---

## Access Control Changes

No access control changes — current model preserved.

- Authentication: email and password
- User model: flat — one user type, no role separation
- Data isolation: per-user isolation enforced at the data layer on all tables
- Completing the missing features does not require any changes to the authentication or access model

---

## Non-Goals

- **Multiplayer or shared quiz functionality** — no leaderboards, shared decks, or team training modes. Single-user private tool only.
- **Team workspaces or multi-user organization accounts** — one account = one user's private data. No group features.
- **Public or shared question bank** — every user's questions are private; no browseable public library.

---

## Open Questions

1. **What is `target_scale.qps`?** — Not explicitly stated in shape-notes. For a single-user private app the effective rate is well under 1 request per second, but a concrete value has not been confirmed. Block: no (informational for `/10x-stack-assess`).
2. **What is `target_scale.data_volume`?** — Not explicitly stated in shape-notes. For a single user with hundreds to low-thousands of questions and dozens of sessions the volume is effectively `small`, but a concrete value has not been confirmed. Block: no (informational for `/10x-stack-assess`).
