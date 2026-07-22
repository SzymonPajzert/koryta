# Newsletter — plan wdrożenia (Mailgun)

Cel: regularny kanał, który prowadzi odbiorców przez lejek
**czytelnik → zarejestrowany użytkownik → wolontariusz (ankieta / rola datascience) → patron**.
Newsletter jest jedynym kanałem, którego zasięg należy do nas (w przeciwieństwie do social mediów).

## 1. Zgody i RODO (do zrobienia przed pierwszą wysyłką)

- Rejestracja konta ≠ zgoda na newsletter. Potrzebny jest osobny, wyraźny opt-in:
  - checkbox przy rejestracji (domyślnie odznaczony),
  - przełącznik na stronie `/profil` dla istniejących kont,
  - formularz e-mail dla niezalogowanych (stopka + strona główna).
- **Double opt-in**: po zapisie wysyłamy mail z linkiem potwierdzającym. Standard w PL,
  chroni przed spam-trapami i sporami o zgodę.
- Aktualizacja `polityka_prywatnosci`: Mailgun jako podmiot przetwarzający.
  Używamy **regionu EU Mailguna** (`api.eu.mailgun.net`), co upraszcza kwestię transferu danych.

## 2. Konfiguracja Mailguna

- Dedykowana subdomena wysyłkowa, np. `mg.koryta.pl` (SPF + DKIM + DMARC) —
  oddziela reputację wysyłki od głównej domeny.
- Region EU.
- Źródłem prawdy o subskrybentach jest Firestore (nie listy Mailguna) — łatwiejsza
  integracja z kontami i rolami. Mailgun służy tylko do wysyłki (batch API, do 1000
  odbiorców na request, personalizacja przez recipient variables).
- Wypisy: `%unsubscribe_url%` w stopce + nagłówek `List-Unsubscribe`;
  webhook Mailguna aktualizuje Firestore.

## 3. Elementy do zaimplementowania (Nuxt/Nitro)

Dane: kolekcja `newsletter_subscribers`:
`{ email, uid?, source, consentAt, confirmedAt?, unsubscribedAt?, token }`.

Endpointy:

- `POST /api/newsletter/subscribe` — walidacja + rate limit, zapis „pending",
  wysyłka maila potwierdzającego z podpisanym tokenem.
- `GET /api/newsletter/confirm?token=…` — potwierdzenie zapisu.
- `POST /api/newsletter/webhook` — obsługa `unsubscribed` / `failed` / `complained`
  (weryfikacja podpisu webhooka).

UI:

- komponent formularza zapisu (stopka + sekcja na stronie głównej),
- przełącznik subskrypcji na `/profil` (prefill mailem z konta),
- checkbox przy rejestracji.

Sekrety (`apphosting.yaml` → Secret Manager): `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`,
`MAILGUN_WEBHOOK_SIGNING_KEY`.

Wysyłka (MVP — ręczna): `scripts/send-newsletter.ts` — bierze plik markdown,
renderuje szablon HTML (logo, stopka z wypisem) i wysyła batchem do potwierdzonych
subskrybentów. Panel administracyjny / automatyzacja dopiero, gdy wysyłki będą regularne.

## 4. Treść i lejek

Rytm: **raz w miesiącu**, stały format („Koryto miesiąca"):

1. jedno konkretne znalezisko z bazy (z linkiem do strony osoby/instytucji),
2. statystyki postępu (nowe wpisy, ile z ~2,6 tys. osób czeka na weryfikację),
3. podziękowania dla aktywnych wolontariuszy (imiennie, za zgodą),
4. **jedno CTA na wydanie**, eskalujące w kolejnych wydaniach:
   głosuj na strony → wypełnij ankietę wolontariusza → dołącz do grupy datascience →
   wesprzyj na Patronite.

Segmentacja (później, na podstawie `uid` + custom claims): inne CTA dla anonimowych
subskrybentów, inne dla zarejestrowanych, inne dla osób z rolą `datascience`.

Pomiar: parametry UTM w linkach (Plausible) + statystyki otwarć/kliknięć Mailguna
(tracking kliknięć wymaga wzmianki w polityce prywatności).

## 5. Szacunek pracy

- MVP (formularz, double opt-in, webhook, skrypt wysyłki, polityka prywatności): ~2–3 dni.
- Przełącznik w profilu + checkbox przy rejestracji: ~0,5 dnia.
- Segmentacja i automatyzacja wysyłki: osobny etap, po pierwszych 2–3 wydaniach.

Kolejność wdrożenia: (1) subdomena + DNS + region EU w Mailgunie, (2) endpointy i
formularz, (3) polityka prywatności, (4) pierwsza wysyłka skryptem do świeżo
zebranych subskrybentów.
