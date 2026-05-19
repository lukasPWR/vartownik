---
project: VARtownik
context_type: brownfield
updated: 2026-05-19
timeline_budget:
  delivery_weeks: 4
  hard_deadline: "2026-06-30"
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed:
    - 1
    - 2
    - 3
    - 4
    - 5
    - 6
    - 7
  frs_drafted: 20
  quality_check_status: accepted
---

## Current System

VARtownik is a partially built Astro 5 SSR football quiz simulator, originally started during the 10xDevs 2.0 course. The system is now being shaped and completed using the updated 10xDevs 3.0 methodology.

**Tech stack (existing):** Astro 5 (SSR, `output: "server"`), Vue 3 (Composition API), TypeScript 5, Supabase (auth + PostgreSQL + Storage), OpenRouter (LLM integration), Tailwind 4, shadcn-vue, Nano Stores.

**What exists today:**
- Auth: sign-in, sign-up, confirm-email pages and Supabase Auth integration
- Dashboard page with stats widgets (CategoryRadarChart, StatCard, RecentSessionsTable, etc.)
- AI quiz generation flow: generation loading screen, error handling, football fact carousel
- Game engine: GameView, TimerWidget, Scratchpad, QuestionBlock, RoundHeader, QuizFocusMode, QuestionProgressIndicator
- API routes: auth, categories, generation-batches, questions, sessions, stats, tags
- Services layer: categories, questions, sessions, generation-batches, tags

**What is missing (gaps from PRD):**
- Round summary / self-assessment screen (no RoundSummary component)
- Question CRUD management page (no admin/manage page)
- Question flagging UI (flagged status in DB but no UI exposed)
- Stats / analytics completeness uncertain

**Must preserve:**
- Auth sessions — users must not get logged out or lose access
- Existing Supabase data (questions, sessions records)
- RLS data isolation policies
- Overall app reset is acceptable if needed (early-stage)

---

## Vision & Problem Statement

**Change type:** Completing remaining features of an existing system

Competitive football quiz participants (e.g. participants of PilkarskiQuiz.pl) need a dedicated training tool that simulates tournament conditions at expert level — high-difficulty questions, strict time pressure (15–30s per question), mixed categories, and a mechanism to build a personal verified question bank. VARtownik is that tool.

The existing codebase covers quiz generation and the active game engine. The missing parts are:
1. The **post-round self-assessment loop** — without it, users cannot verify answers or record their performance.
2. The **question management panel** — without it, users cannot correct AI errors or build a clean bank.
3. **Completeness of progress analytics** — without it, users cannot identify knowledge gaps.

The change is not a redesign — it is completing the product as originally specified in the PRD.

---

## User & Persona

**Primary persona:** Solo competitive football quiz player — an individual who regularly participates in organized football trivia tournaments (e.g. PilkarskiQuiz.pl), trains individually, and wants to simulate tournament pressure at home. Single-user, private data model.

**Access model:** Email + password via Supabase Auth (already implemented). Flat user model — no roles. Each user's data is isolated by RLS.

---

## Access Control

No changes planned — current model preserved.

- Auth mechanism: email + password via Supabase Auth with cookie-based sessions (`@supabase/ssr`)
- User model: flat — one user type, no role separation
- Data isolation: Row Level Security (RLS) in PostgreSQL enforces per-`user_id` access on all tables
- Completing the missing features does not require any changes to the auth or access model

---

## Success Criteria

### Primary

A user can complete a full 40-question game session (4 rounds of 10 questions) without a single dead-end:
1. User starts quiz generation — loading screen with football facts appears
2. Questions are presented one by one with timer and scratchpad
3. After each round of 10 questions, the round summary screen appears with correct answers and scratchpad notes side-by-side
4. User marks each question "Wiedziałem" / "Nie wiedziałem" before proceeding
5. User can optionally flag any question as incorrect AI output
6. All 4 rounds complete — session score saved to Supabase
7. Dashboard reflects the completed session in history and per-category accuracy

### Secondary

The full 40-question game session (4 rounds) can be completed without a single dead-end — all flows connect.

### Guardrails

- Existing sessions and questions data in Supabase must not be wiped or corrupted
- RLS continues to isolate each user's data completely

## Timeline acknowledgment

Acknowledged on 2026-05-19: 4-week delivery requires sustained after-hours dedication; user accepted.

---

## Functional Requirements

### Preserved (already built — must not regress)

- FR-001: User can register and log in via email + password. Priority: must-have. Change: preserved
- FR-002: User can generate a 40-question quiz (AI-powered, 4 rounds of 10 questions, mixed categories). Priority: must-have. Change: preserved
- FR-003: Player sees a loading screen with rotating football facts during quiz generation. Priority: must-have. Change: preserved
- FR-004: Player answers questions one at a time with a countdown timer (15–30s) and a scratchpad text field. Priority: must-have. Change: preserved
- FR-005: Timer locks the scratchpad input when it reaches zero. Priority: must-have. Change: preserved

### Gap A — Round Summary & Self-Assessment (new)

- FR-006: Player can view the round summary screen after completing a 10-question round, showing each question alongside its correct answer and the player's scratchpad note. Priority: must-have. Change: new
  > Socrates: Counter considered: "show answers immediately after each question rather than deferring to round end." Resolution: kept; deferred revelation is a deliberate simulation of tournament conditions where answers aren't shown mid-round.

- FR-007: Player can mark each question on the summary screen as "Wiedziałem" (correct) or "Nie wiedziałem" (incorrect). Priority: must-have. Change: new

- FR-008: Player cannot proceed to the next round until all 10 questions in the current round have been marked. Priority: must-have. Change: new
  > Socrates: Counter considered: "the gate is gameable — users can click all 'Wiedziałem' to skip." Resolution: kept; the product trusts the user's self-assessment (explicit design choice from PRD section 4: no automatic validation). Gaming the gate undermines only the user's own training data.

- FR-009: Player can flag any question on the summary screen as suspected incorrect AI output. Priority: must-have. Change: new
  > Socrates: Counter considered: "flagging from the CRUD page is enough; don't add it to the game flow." Resolution: kept; the summary screen is the moment the user notices a problem. Requiring a separate CRUD visit creates friction that leads to unflagged errors staying in rotation.

- FR-010: Round score is persisted to the session record in Supabase after all questions are marked. Priority: must-have. Change: new

### Gap B — Question Management (new)

- FR-011: User can view their personal question bank in a dedicated management page. Priority: must-have. Change: new
- FR-012: User can manually add a new question (text, correct answer, category, difficulty score). Priority: must-have. Change: new
- FR-013: User can edit an existing question's text, answer, category, or difficulty. Priority: must-have. Change: new
- FR-014: User can delete a question from their bank. Priority: must-have. Change: new
- FR-015: User can view flagged questions in a dedicated tab within the management page and resolve or delete them. Priority: must-have. Change: new
  > Socrates: Counter considered: "a filter on the main list achieves the same without a dedicated tab." Resolution: kept; a dedicated tab makes the review workflow explicit and surfaces the count of unfixed AI errors passively (badge on the tab label).

- FR-016: Flagged questions are excluded from AI quiz generation until the user manually resolves their flagged status. Priority: must-have. Change: new
  > Socrates: Counter considered: "excluding questions shrinks the pool and could degrade quiz quality." Resolution: kept; the whole point of flagging is to prevent known errors from appearing. Pool degradation is bounded — users typically flag a small fraction.

- FR-017: User can attach an image to a manually added question via Supabase Storage. Priority: nice-to-have. Change: new

### Gap C — Stats & Analytics (new/modified)

- FR-018: Dashboard displays the user's overall correct-answer percentage based on self-assessment records. Priority: must-have. Change: new
- FR-019: Dashboard displays per-category accuracy as a chart or list. Priority: must-have. Change: new
  > Socrates: Counter considered: "a chart adds complexity; a list is equally useful." Resolution: kept as chart OR list — implementation choice deferred to downstream stack selection. The PRD mandates the capability, not the rendering format.

- FR-020: Dashboard displays the last 10 sessions with their scores and dates. Priority: must-have. Change: new

---

## User Stories

### US-01: Complete a round with self-assessment

Given a player has answered all 10 questions of a round (either by answering or timer expiry),
When the round ends,
Then the player sees the round summary screen with all 10 questions, correct answers, and their scratchpad notes displayed side-by-side, and must mark each as "Wiedziałem" or "Nie wiedziałem" before the "Next round" button becomes active.

### US-02: Flag a suspected AI error

Given a player is on the round summary screen,
When they see a question they believe is factually incorrect,
Then they can flag it from that screen and it will no longer appear in future generated quizzes until resolved.

### US-03: Manage the question bank

Given a logged-in user is on the question management page,
When they want to fix an AI-generated question,
Then they can find it (by flagged status), edit its text and answer, and change its status back to active.

---

## Business Logic

**Core domain rule:** VARtownik assembles a balanced, expert-difficulty question set from the user's personal question bank on demand.

The rule consumes: a set of predefined categories with fixed weights (e.g. Ekstraklasa, Historia MŚ/Euro, Statystyki, Piłka zagraniczna, Reprezentacja Polski), a target round count (4) and questions-per-round (10), and the user's flagged-question exclusion list. It produces 40 questions grouped into 4 rounds, with category distribution matching the defined weights within each round, generated in a single LLM API call using Few-Shot Prompting at expert level (minimum two identifying parameters per question: e.g. player name + year + club). The user encounters the rule each time they press "Generate" — the loading screen is the system executing this rule. On bad JSON output, the rule retries up to 2 times before surfacing an error.

**Change classification:** Infrastructure-only for this session — the generation rule itself is not changing. The completion work adds the post-round self-assessment loop, the question management UI, and the stats display.

---

## Non-Functional Requirements

- Quiz generation time: from clicking "Generate" to the first question appearing must be ≤40 seconds.
- AI question quality: ≥80% of generated questions must contain at least two identifying parameters (e.g. player name + year, or club + season), confirming expert-level difficulty as assessed by the user over time.

---

## Constraints & Preserved Behavior

- The AI generation rule, prompt structure, and OpenRouter integration must not change as part of this completion work.
- Existing Supabase database schema (questions, sessions, attempts, categories, tags tables) must remain compatible — no destructive migrations.
- RLS policies must not regress; any new tables or columns must have per-user RLS applied from the start.
- The game timer and round flow (no pause, no mid-round save, refresh = round lost) must be preserved exactly as designed.
- No backward-compatibility concerns with external API consumers — this is a private single-user app.

---

## Product Framing

- Product type: web-app
- Target scale: small (just me, or a handful of users); fully private per-user even at 100x scale — no shared infrastructure needed
- Hard deadline: 2026-06-30
- After-hours only: true
- Delivery weeks: 4 (acknowledged in Timeline acknowledgment block)

---

## Non-Goals

- **Multiplayer or shared quiz functionality** — no leaderboards, shared decks, or team training modes. Single-user private tool only.
- **Team workspaces or multi-user organization accounts** — one account = one user's private data. No group features.
- **Public or shared question bank** — every user's questions are private; no browseable public library.

---

## Quality cross-check

All 6 brownfield elements: **accepted** (2026-05-19).

| Element | Status |
|---|---|
| Access Control | present |
| Business Logic (one-sentence rule) | present |
| Project artifacts | present |
| Timeline-cost acknowledged | present |
| Non-Goals | present |
| Preserved behavior | present |


