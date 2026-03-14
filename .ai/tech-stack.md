Frontend - Astro 5 z Vue 3 (Island Architecture):

Astro 5: Służy jako szkielet aplikacji, zapewniając szybkie ładowanie (SEO) i routing.

Vue 3 (Composition API): Obsługuje interaktywne części quizu (licznik czasu, reaktywne formularze, system VAR).

Shadcn-Vue + Radix Vue: Zapewnia zestaw dostępnych i stylowalnych komponentów UI dostosowanych do Vue.

Nano Stores: Lekki menedżer stanu do komunikacji między niezależnymi wyspami Vue na stronie.

Tailwind 4: Silnik CSS do szybkiego i nowoczesnego stylowania.

Backend & RAG - Supabase (PostgreSQL + pgvector):

PostgreSQL: Przechowywanie danych użytkowników, wyników i ustrukturyzowanych pytań.

pgvector: Rozszerzenie bazy danych umożliwiające przechowywanie tzw. embeddings (wektorów) dla systemu RAG.

Supabase Edge Functions: Bezserwerowe funkcje w TypeScript do obsługi logiki AI i weryfikacji VAR.

Supabase Storage: Przechowywanie obrazów dodawanych manualnie do pytań.

AI - Komunikacja i Embeddings (OpenRouter.ai):

OpenRouter.ai: Dostęp do modeli generatywnych (np. GPT-4o-mini lub Claude Haiku) dla silnika quizu i systemu VAR.

Text-Embedding Models: Użycie modelu (np. od OpenAI przez OpenRouter lub HuggingFace) do zamiany Twojego JSON-a na wektory przeszukiwalne przez RAG.

CI/CD i Hosting:

GitHub Actions: Automatyzacja testów i budowania obrazów Docker.

DigitalOcean App Platform: Hosting zoptymalizowanego obrazu Docker (zawierającego tylko środowisko Node.js).

Admin Workflow: Lokalny skrypt/narzędzie do konwersji PPTX -> JSON przed wysłaniem do bazy.