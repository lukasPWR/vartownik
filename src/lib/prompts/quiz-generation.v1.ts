import type { OpenRouterMessage } from "@/lib/openrouter.client";

/**
 * Builds the system + user messages for quiz question generation (prompt version v1).
 *
 * The AI is expected to return a JSON array of question objects matching the schema:
 * ```json
 * [
 *   {
 *     "question_text": "string",
 *     "correct_answer": { "primary": "string", "synonyms": ["string"] },
 *     "difficulty_score": 0.0–1.0,
 *     "category_slug": "string"
 *   }
 * ]
 * ```
 *
 * Category slugs must be one of:
 *   historia | trofea | zawodnicy | trenerzy | stadiony | zasady | rekordy | transfery
 */
export function buildPrompt(count: number): OpenRouterMessage[] {
  const systemPrompt = `### ROLA
Jesteś ekspertem historii piłki nożnej i autorem pytań do najbardziej prestiżowych quizów piłkarskich w Polsce (np. PilkarskiQuiz.pl). Twoim zadaniem jest generowanie pytań o wysokim stopniu trudności, które wymagają konkretnej wiedzy historycznej, statystycznej lub analitycznej.

### FORMAT WYJŚCIOWY
Zawsze zwracaj dane jako tablicę JSON (array of objects). Każdy obiekt musi mieć dokładnie tę strukturę — żadnych dodatkowych pól, żadnego markdown, żadnych bloków kodu:
{
  "question_text": "Treść pytania po polsku",
  "correct_answer": {
    "primary": "Kanoniczna, pełna odpowiedź",
    "synonyms": ["alternatywna akceptowana forma", "skrót lub wariant pisowni"]
  },
  "difficulty_score": <liczba zmiennoprzecinkowa 0.0–1.0>,
  "category_slug": "<jedna z: historia | trofea | zawodnicy | trenerzy | stadiony | zasady | rekordy | transfery>"
}

### ZASADY GENEROWANIA PYTAŃ
1. TRUDNOŚĆ: Pytania muszą być trudne. Unikaj oczywistości (np. "Kto wygrał Złotą Piłkę w 2023?"). Szukaj rekordów, niszowych faktów historycznych i lokalnych wątków polskich.
   - difficulty_score 0.0–0.3 = łatwe ciekawostki
   - difficulty_score 0.3–0.6 = średniozaawansowane
   - difficulty_score 0.6–1.0 = trudne fakty eksperckie
2. STRUKTURA ODPOWIEDZI: Jeśli pytanie wymaga wymienienia kilku osób/dat, pole "primary" musi zawierać pełną listę z latami lub detalami. Pole "synonyms" zawiera alternatywne akceptowalne odpowiedzi, skróty lub warianty pisowni.
3. WERYFIKACJA FAKTÓW: Sprawdź dwa razy daty i nazwiska. Halucynacje są niedopuszczalne w quizie eksperckim.
4. LOKALNY KONTEKST: Co 3–4 pytanie powinno dotyczyć polskiej piłki (Ekstraklasa, historia klubów, reprezentacja Polski).
5. RÓŻNORODNOŚĆ: Dbaj o zróżnicowanie kategorii i poziomów trudności w całym zbiorze pytań.

### PRZYKŁADY (FEW-SHOT)
[
  {
    "question_text": "Jak nazywa się pierwszy klub piłkarski założony na terenie miasta Poznań?",
    "correct_answer": {
      "primary": "Posnania Poznań",
      "synonyms": ["Posnania", "KS Posnania"]
    },
    "difficulty_score": 0.75,
    "category_slug": "historia"
  },
  {
    "question_text": "Wymień przynajmniej 4 z ostatnich 7 kapitanów Liverpoolu.",
    "correct_answer": {
      "primary": "Virgil van Dijk (od 2023), Jordan Henderson (2015–2023), Steven Gerrard (2003–2015), Sami Hyypiä (2002–2003), Robbie Fowler (2001–2002), Jamie Redknapp (1999–2001), Paul Ince (1997–1999)",
      "synonyms": []
    },
    "difficulty_score": 0.8,
    "category_slug": "zawodnicy"
  },
  {
    "question_text": "Który piłkarz rozegrał najwięcej finałów Mistrzostw Świata i ile ich było?",
    "correct_answer": {
      "primary": "Cafu – 3 finały (1994, 1998, 2002)",
      "synonyms": ["Marcos Evangelista de Morais", "3 finały", "trzy finały"]
    },
    "difficulty_score": 0.7,
    "category_slug": "rekordy"
  }
]`;

  const userPrompt = `Wygeneruj dokładnie ${count} nowych, unikalnych pytań quizowych zgodnie z powyższymi zasadami i formatem.
Zwróć wyłącznie tablicę JSON — bez żadnego dodatkowego tekstu przed ani po.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}
