Frontend – Astro + Vue (Szybkość i Interaktywność)
Astro 5: Służy jako szkielet (meta-framework). Wykorzystamy go do statycznego renderowania większości stron, co zapewni błyskawiczne ładowanie.

Vue 3.5+ (Composition API): Nasza „interaktywna broń”. Użyjemy go do budowy Silnika Gry (timer, scratchpad) oraz formularzy w panelu CRUD.

TypeScript 5: Ścisłe typowanie dla modeli danych (np. interfejs Question), co wyeliminuje błędy typu undefined w trakcie quizu.

Tailwind CSS 4: Nowoczesne podejście do stylowania. Wykorzystamy nowe możliwości silnika do budowy responsywnego UI.

Shadcn-vue: Biblioteka komponentów (oparta na Radix Vue), która zapewni profesjonalny wygląd bez pisania wszystkiego od zera.

Backend – Supabase (Kompleksowy Backend-as-a-Service)
PostgreSQL: Relacyjna baza danych, która idealnie obsłuży strukturę Quiz -> Rundy -> Pytania.

Supabase Auth: Gotowy moduł rejestracji i logowania (email/hasło)

Supabase Storage: Przechowywanie zdjęć do pytań (bucket „quiz-images”) z optymalizacją dostarczania plików.

Row Level Security (RLS): Zapewnienie, że tylko Ty masz dostęp do swoich pytań i wyników.

AI – OpenRouter.ai (Agregator Modeli)
Model Flexibility: Dostęp do GPT-4o, Claude 3.5 Sonnet czy Llama 3 przez jedno API. Pozwoli nam to na testowanie, który model najlepiej radzi sobie z „piłkarskim ekspertem”.

Cost Management: Ustawienie twardych limitów na klucze API, aby uniknąć niespodzianek na karcie kredytowej.

CI/CD i Hosting
GitHub Actions: Automatyczne testy i budowanie obrazu Docker po każdym „pushu” do gałęzi głównej.

Docker: Konteneryzacja aplikacji, co gwarantuje, że „u mnie działa” przełoży się na „na serwerze też działa”.

DigitalOcean: Hosting na sprawdzonym VPS (Droplet), co daje nam pełną kontrolę nad środowiskiem.