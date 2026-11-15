# Cloud Run Lab — Warszawa

Kompletny, prowadzony krok po kroku projekt uczący: **Node.js + MySQL w Cloud SQL + Cloud Run + Terraform + Ansible**, w całości w regionie `europe-central2` (Warszawa).

Aplikacja to publiczny licznik wizyt z tytułem strony trzymanym w bazie. Prosta domena problemu, ale po drodze dotykamy wszystkich elementów, które w prawdziwym projekcie decydują o tym, czy coś działa: kontener, rejestr obrazów, serverless, zarządzana baza, sekrety, stan infrastruktury, migracje i wdrożenia.

> Ten katalog jest **osobnym projektem** wewnątrz repo. Nie zmieniamy istniejącej infrastruktury w `Infrastructure/*.tf` ani `Infrastructure/liquid-streamer/VM/`. Mamy własny stan Terraform i własny prefiks w buckecie.

## Czego się nauczysz

- jak zbudować aplikację Node.js, która działa lokalnie, w Dockerze i w Cloud Run **bez zmian w kodzie**,
- czym różni się maszyna wirtualna od Cloud Run i dlaczego do Cloud Run nie ma SSH,
- jak połączyć Cloud Run z Cloud SQL przez wbudowany proxy (Unix socket),
- czym jest infrastruktura jako kod i dlaczego stan Terraform jest cenny,
- jak trzymać hasło w Secret Managerze zamiast w zmiennej środowiskowej,
- jak Ansible zarządza schematem bazy w sposób idempotentny,
- jak czytać logi, skalować, wdrażać nową wersję i wracać do poprzedniej.

## Architektura

```text
Przeglądarka
   │ HTTPS
   ├── teraz: https://cloudrun-lab-<hash>-ew.a.run.app
   └── później: https://twoja-domena.pl → globalny Application Load Balancer
                                    │
                                    ▼
               Cloud Run: cloudrun-lab (europe-central2)
               min 3 / max 6 instancji, 1 CPU, 512 MiB
               ┌──────────────────────────────────────┐
               │ Express                              │
               │  /            → app/public (HTML/JS) │
               │  /api/health  → SELECT 1             │
               │  /api/visits  → INSERT/SELECT MySQL  │
               │  /api/config  → tabela settings      │
               └───────────────┬──────────────────────┘
                               │ Unix socket
                               ▼
               /cloudsql/liquid-streamer-284510:
                         europe-central2:cloudrun-lab-mysql
                               │
                               ▼
               Cloud SQL MySQL 8.0 (europe-central2)

Secret Manager ──hasło DB──► Cloud Run (env, secretKeyRef)
Artifact Registry ◄── Cloud Build (europe-central2)
Terraform (GCS state) tworzy całość
Ansible (lokalnie + proxy 3307) tworzy tabele i seed
```

Szczegółowe wyjaśnienie każdego elementu znajdziesz w [`docs/00-przeglad.md`](docs/00-przeglad.md).

## Mapa kursu

| Etap | Temat | Typ | Koszt |
|---|---|---|---|
| [0](docs/01-przygotowanie.md) | Przygotowanie, narzędzia, billing, budżet, state | obowiązkowy | 0 USD |
| 1 | Aplikacja lokalnie: Node.js + MySQL w Compose | obowiązkowy | 0 USD |
| 2 | Docker lokalnie: multi-stage, non-root, warstwy | obowiązkowy | 0 USD |
| 3 | Terraform: fundament (bez Cloud Run) | obowiązkowy | od ~10 USD/mies. |
| 4 | Obraz w Artifact Registry przez Cloud Build | obowiązkowy | grosze |
| 5 | Cloud Run publicznie, min. 3 instancje | obowiązkowy | ~10 USD/mies. |
| 6 | Baza w chmurze + Ansible: schema, seed, idempotencja | obowiązkowy | w ramach 3 |
| 7 | Eksploatacja: logi, skalowanie, rollback | obowiązkowy | w ramach 3–5 |
| 8 | Ansible jako orkiestrator deployu | opcjonalny | w ramach 4–5 |
| 9 | Własna domena + globalny LB | opcjonalny, **zablokowany brakiem domeny** | +18–25 USD/mies. |
| 10 | CI/CD i hardening | opcjonalny | zależnie od zakresu |

Pliki `docs/02-*` … `docs/10-*` powstają dopiero w swoich etapach. Ten README jest mapą, nie podręcznikiem.

## Budżet

Docelowy koszt bez Load Balancera: **około 20–30 USD/mies.**, z czego największą stałą pozycję stanowi Cloud SQL. Koszt zaczyna naliczać się od Etapu 3.

Dwa bezpieczniki, o których będziemy przypominać w każdym etapie z kosztem:

- `min_instance_count = 0` w Cloud Run — wyłącza stałe utrzymywanie instancji (zostaje tylko koszt bazy),
- `terraform destroy` — usuwa cały projekt laboratoryjny; nie dotyka istniejącej VM ani VPC.

Alert budżetowy (30 USD) ustawiamy **przed** pierwszym `apply`.

## Zasady pracy

1. **Jeden etap = jedna sesja.** Agent nie generuje plików następnego etapu, zanim nie dostanie wyniku i „ok”.
2. **Ty uruchamiasz mutacje** (`terraform apply`, `gcloud builds submit`, `ansible-playbook`, `docker compose`), wklejasz wynik, agent tłumaczy i pomaga przy błędach.
3. **Agent uruchamia tylko bezpieczne walidacje**: `npm test`, `terraform fmt -check`, `terraform validate`, składnię Ansible.
4. **Po każdym etapie przerwa** z czterema sekcjami: *Co zrobiliśmy*, *Dlaczego tak*, *Sprawdź sam*, *Pytania kontrolne*. Następny etap dopiero po Twoich odpowiedziach.
5. **Żadnych sekretów w repo.** `.env`, `terraform.tfvars`, `*.tfstate`, hasła i klucze są ignorowane.
6. **Bez commitów**, chyba że wyraźnie poprosisz.

## Wymagania wstępne

- konto Google Cloud z projektem `liquid-streamer-284510` i aktywnym billingiem,
- uprawnienia do tworzenia zasobów i nadawania IAM w projekcie,
- macOS z Homebrew (instrukcja zakłada Apple Silicon; na Linuksie różni się tylko instalacja narzędzi),
- Node.js 22 LTS, Docker, Terraform, `gcloud` — resztę doinstalujemy w Etapie 0.

## Struktura katalogów

```text
Cloud-Run/
├── README.md
├── .gitignore
├── docs/                 # materiały kursu, jeden plik na etap
├── app/                  # Node.js + frontend + testy + Dockerfile + cloudbuild.yaml
├── db/migrations/        # SQL: schemat i seed
├── compose.yaml          # lokalny MySQL i aplikacja
├── scripts/              # proxy, smoke test, test obciążenia
├── terraform/            # główny root + opcjonalny root LB
└── ansible/              # inventory, playbooki, rola app_db
```

## Start

Otwórz [`docs/01-przygotowanie.md`](docs/01-przygotowanie.md) i wykonaj Etap 0. **Nie uruchamiaj `terraform apply`** przed ustawieniem alertu budżetowego i potwierdzeniem dostępu do bucketa stanu.
