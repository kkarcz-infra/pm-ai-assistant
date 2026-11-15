# 00 — Przegląd kursu

Ten dokument jest mapą pojęciową całego projektu. Nie musisz go znać na pamięć. Wróć do niego, kiedy w późniejszym etapie poczujesz, że zgubiłeś kontekst: po co jest dany komponent i dlaczego robimy coś w taki, a nie inny sposób.

## Co budujemy

Publiczną stronę-licznik wizyt:

- strona pokazuje tytuł pobrany z bazy (`settings.site_title`),
- przycisk „Odwiedź ponownie” wysyła `POST /api/visits`,
- każda wizyta trafia do tabeli `visits` razem z identyfikatorem instancji, która ją obsłużyła,
- strona pokazuje łączną liczbę wizyt oraz kilka ostatnich identyfikatorów instancji — to dowód, że ruch rozkłada się na wiele instancji Cloud Run,
- `/api/health` sprawdza połączenie z bazą (`SELECT 1`), więc może służyć jako startup probe,
- `/api/config` czyta tytuł z bazy, a `/api/info` zwraca metadane instancji bez dotykania bazy.

To celowo mała aplikacja. Cała złożoność kursu leży w infrastrukturze, nie w kodzie biznesowym.

## Architektura i przepływ żądania

```text
1. Przeglądarka → HTTPS → Cloud Run (publiczny adres run.app)
2. Cloud Run wybiera jedną z 3–6 instancji i przekazuje żądanie
3. Express obsługuje żądanie:
   - statyczne pliki z app/public/ serwuje sam,
   - /api/* woła MySQL,
4. Połączenie z MySQL idzie przez Unix socket /cloudsql/<connection_name>,
   który montuje wbudowany Cloud SQL Auth Proxy,
5. Hasło do bazy przychodzi ze zmiennej środowiskowej wskazującej na Secret Manager.
```

Dwie rzeczy są tu ważne dydaktycznie:

- **Nie ma VPC connectora.** Cloud Run łączy się z Cloud SQL przez wbudowany proxy i socket. To najprostsza i zalecana droga, dopóki baza ma publiczne IP bez authorized networks.
- **Nie ma sticky sessions.** Każde żądanie może trafić na inną instancję. Dlatego licznik musi żyć w bazie, a nie w pamięci procesu.

## Komponenty

| Komponent | Rola | Dlaczego właśnie to |
|---|---|---|
| **Cloud Run** | uruchamia kontener aplikacji, skaluje 3–6 instancji, daje publiczny HTTPS | serverless: nie zarządzasz serwerem, płacisz za używane zasoby, skaluje się automatycznie |
| **Cloud SQL (MySQL 8.0)** | trwały stan aplikacji: wizyty i ustawienia | zarządzana baza: backupy, aktualizacje i dostęp sieciowy po stronie Google |
| **Artifact Registry** | przechowuje obrazy Dockera | prywatny rejestr w tym samym regionie co Cloud Run, więc pobieranie obrazu jest szybkie |
| **Cloud Build** | buduje obraz ze źródeł i wypycha go do rejestru | powtarzalny build w chmurze, niezależny od architektury Twojego laptopa |
| **Secret Manager** | przechowuje hasło bazy | sekret nie trafia do repo ani do treści zmiennej środowiskowej w konfiguracji |
| **Terraform** | tworzy i aktualizuje infrastrukturę; stan w GCS | deklaratywny, wersjonowany opis infrastruktury; stan pozwala wykrywać dryf |
| **Ansible** | tworzy tabele i seed w bazie, opcjonalnie orkiestruje deploy | idempotentne zadania administracyjne tam, gdzie Terraform nie jest właściwym narzędziem |
| **GCS bucket** | trzyma zdalny stan Terraform | stan nie ginie z laptopem, a zespół widzi tę samą wersję infrastruktury |

## Najważniejsze rozróżnienie: Cloud Run to nie VM

Maszyna wirtualna to długo żyjący serwer, na który można wejść przez SSH, zainstalować pakiet i zmienić plik. Cloud Run to **serverless i immutable**: uruchamia obraz kontenera, a każda zmiana konfiguracji tworzy **nową rewizję**. Nie ma SSH do instancji, nie ma „poprawiania na żywo”.

Konsekwencje, które będą wracać w kursie:

- konfiguracja aplikacji przychodzi przez zmienne środowiskowe i sekrety, nie przez edycję plików na dysku,
- stan musi być na zewnątrz instancji — w Cloud SQL, nie w pamięci procesu,
- wdrożenie nowej wersji to nowa rewizja obrazu, a rollback to przełączenie ruchu na starszą rewizję,
- **Ansible nie konfiguruje kontenerów Cloud Run**. Ansible zarządza bazą przez proxy i (opcjonalnie) wywołuje build oraz `terraform apply`.

To ostatnie zdanie jest sednem podziału odpowiedzialności w tym projekcie.

## Podział: Terraform vs Ansible

| Pytanie | Terraform | Ansible |
|---|---|---|
| Tworzy bazę, sieć, sekret, usługę Cloud Run? | tak | nie |
| Tworzy tabele i seed w bazie? | nie | tak |
| Jest źródłem prawdy o infrastrukturze? | tak | nie |
| Wykonuje migracje SQL? | nie | tak |
| Może uruchomić deploy (opcjonalnie)? | tak (`apply`) | tak (orkiestracja) |
| Działa na zasadzie „jaki ma być stan końcowy”? | tak | tak, ale dla zadań, nie zasobów chmurowych |

Terraform świetnie opisuje **zasoby** („ma istnieć instancja Cloud SQL o takich parametrach”). Słabo nadaje się do **zadań administracyjnych** („wykonaj ten plik SQL, jeśli jeszcze nie był wykonany”). Do tego drugiego używamy Ansible i tabeli `schema_migrations`.

## Pojęcia, które warto znać przed startem

- **Projekt GCP** — kontener na zasoby, uprawnienia i billing. Tutaj: `liquid-streamer-284510`.
- **Region** — fizyczna lokalizacja zasobów. Tutaj: `europe-central2` (Warszawa). Cloud Run, Cloud SQL, Artifact Registry i Cloud Build trzymamy w jednym regionie, żeby nie płacić za ruch między regionami i nie dodawać opóźnień.
- **Billing** — powiązanie projektu z kontem płatniczym. Bez aktywnego billingu większość zasobów się nie utworzy.
- **IAM** — kto może co robić. Uprawnienia nadajemy **service accountom**, a nie ludziom, gdy mówimy o zasobach działających w chmurze.
- **Service account (SA)** — „konto techniczne” dla usługi. Cloud Run dostaje własne SA, żeby mieć tylko te uprawnienia, których potrzebuje.
- **ADC (Application Default Credentials)** — poświadczenia, których domyślnie używają biblioteki Google i Terraform. Różnią się od sesji `gcloud auth login`; szczegóły w Etapie 0.
- **Terraform state** — plik opisujący, co Terraform już utworzył. Trzyma też wartości wrażliwe, dlatego ląduje w prywatnym buckecie GCS, a nie w repo.
- **Serverless** — nie zarządzasz serwerem; platforma uruchamia instancje na żądanie i sama je skaluje.
- **Rewizja (revision)** — niezmienny snapshot konfiguracji usługi Cloud Run. Nowy obraz lub nowa zmienna środowiskowa = nowa rewizja.
- **Instancja** — pojedynczy działający kontener obsługujący żądania. `min_instance_count = 3` oznacza, że przez cały czas działają co najmniej trzy.
- **Cold start** — opóźnienie pierwszego żądania, gdy platforma musi uruchomić nową instancję. Minimum instancji je ogranicza, ale kosztuje.
- **Concurrency** — ile równoczesnych żądań obsługuje jedna instancja. Tutaj 80.
- **Socket Unix** — plikowe gniazdo komunikacji między procesami. Cloud SQL Auth Proxy wystawia bazę pod `/cloudsql/<connection_name>`; aplikacja łączy się przez tę ścieżkę zamiast przez host i port.
- **Idempotencja** — wielokrotne uruchomienie tego samego zadania daje ten sam efekt. Drugi run Ansible powinien pokazać `changed=0`.

## Koszt — rząd wielkości

| Pozycja | Szacunek miesięczny | Uwagi |
|---|---|---|
| Cloud SQL `db-f1-micro` + 10 GB SSD + backupy | ~10–12 USD | największa stała pozycja; brak SLA, ale wystarcza do labu |
| Cloud Run, min. 3 instancje, 1 CPU / 512 MiB, CPU tylko na żądanie | ~8–12 USD | płacisz głównie za pamięć utrzymywanych instancji i CPU w czasie żądań |
| Artifact Registry | < 1 USD | kilka małych obrazów |
| Cloud Build | 0 USD w praktyce | dzienny limit darmowych minut wystarcza |
| Secret Manager | ~0 USD | jeden sekret, kilka wersji |
| **Razem bez LB** | **~20–30 USD** | zgodnie z przyjętym budżetem |
| Globalny LB + domena (Etap 9) | +18–25 USD + domena | nieuruchamiane bez zakupu domeny |

Koszt nie jest stały w czasie: Cloud Run rozlicza faktyczne zużycie, a Cloud SQL działa także wtedy, gdy nikt nie korzysta ze strony. Dlatego po zakończeniu nauki uruchamiamy `terraform destroy`.

## Czego ten kurs nie obejmuje

- produkcyjnego HA Cloud SQL, replik i point-in-time recovery,
- własnej domeny bez jej zakupu,
- CI/CD z approvals i Workload Identity Federation (tylko materiał opcjonalny),
- Kubernetes/GKE, Cloud Armor, prywatnego IP i IAM DB auth (opcjonalny hardening),
- refaktoru Terraform do modułów (opcjonalne ćwiczenie),
- prawdziwej autoryzacji użytkowników — teraz mamy publiczny licznik.

## Jak czytać materiały

Każdy etap ma ten sam rytm:

1. **Cel** — co chcemy osiągnąć i jaki plik powstaje.
2. **Wytłumaczenie** — dlaczego robimy to w ten sposób.
3. **Komendy** — bloki do wklejenia; mutacje uruchamiasz Ty.
4. **Definition of Done** — obiektywne kryterium, że etap się udał.
5. **Pytania kontrolne** — sprawdzają zrozumienie, nie pamięć.

Nie przechodzimy dalej, dopóki Definition of Done nie jest spełnione. Jeśli coś nie działa, debugujemy na tym etapie — to nie jest strata czasu, tylko część nauki.

## Następny krok

Przejdź do [`01-przygotowanie.md`](01-przygotowanie.md) i wykonaj Etap 0.
