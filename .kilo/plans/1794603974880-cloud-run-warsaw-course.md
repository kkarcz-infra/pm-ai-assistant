# Plan: kurs „Cloud Run w Warszawie” — Node.js + MySQL + Terraform + Ansible

## Cel

Zbudować razem z użytkownikiem **kompletny, publiczny projekt uczący**:
- aplikacja Node.js/Express z frontendem w czystym JavaScriptcie,
- MySQL w Cloud SQL,
- 3–6 instancji Cloud Run w regionie `europe-central2` (Warszawa),
- infrastruktura w Terraform,
- Ansible do zarządzania schematem/bazy i pomocniczego deploymentu,
- publiczny adres HTTPS, docelowo własna domena przez globalny Load Balancer.

Użytkownik **nie pisze kodu**. Agent generuje wszystkie pliki, komentarze i komendy. Użytkownik uruchamia komendy mutujące (terraform apply, Cloud Build, ansible-playbook, deploy), wkleja wyniki, a agent tłumaczy i pomaga przy błędach. Po każdym etapie obowiązkowa przerwa z wyjaśnieniem i pytaniami kontrolnymi.

## Decyzje (ustalone z użytkownikiem)

| Obszar | Decyzja |
|---|---|
| Projekt GCP | istniejący `liquid-streamer-284510`; nie ruszamy istniejącej VM/VPC w `us-central1` |
| Region | `europe-central2` (Warszawa) dla Cloud Run, Cloud SQL, Artifact Registry i Cloud Build |
| Backend | Node.js 22 LTS + Express, `mysql2/promise`, `"type": "module"` |
| Frontend | czysty HTML/CSS/JS w `app/public/`, serwowany przez ten sam Express |
| Cloud Run | jedna usługa `cloudrun-lab`, `min_instance_count = 3`, `max_instance_count = 6`, 1 CPU / 512 MiB, CPU throttling, concurrency 80 |
| Baza | Cloud SQL MySQL 8.0, `db-f1-micro`, strefa pojedyncza, public IP bez authorized networks, `ssl_mode = ENCRYPTED_ONLY`, backupy włączone |
| Połączenie DB | wbudowany Cloud SQL Auth Proxy w Cloud Run, Unix socket `/cloudsql/<connection_name>`; **bez** VPC connectora |
| Hasło DB | `random_password` w Terraform → Secret Manager → env Cloud Run; Ansible czyta je przez `gcloud secrets versions access` |
| Obraz | Artifact Registry `cloudrun-lab` (Docker), budowany przez Cloud Build w `europe-central2` |
| Publiczny dostęp | `roles/run.invoker` dla `allUsers` na Cloud Run; później opcjonalnie LB + domena |
| Domena | użytkownik **nie ma jeszcze domeny**; etap LB przygotowujemy, ale nie uruchamiamy do zakupu domeny |
| Terraform state | GCS `infrastructure-ai-pm`, prefiks `terraform/cloud-run-lab`; fallback: dedykowany bucket |
| Ansible | lokalnie (`localhost`), Cloud SQL Auth Proxy na porcie `3307`, `community.mysql`, `PyMySQL`, `mysql-client` |
| Struktura kursu | jedno spójne repo + `docs/XX-*.md`; brak kopiowania całego projektu per etap |
| Wykonanie | hybrydowo: użytkownik uruchamia mutacje, agent wykonuje bezpieczne walidacje i analizuje wyniki |
| Budżet | akceptacja ok. 20–30 USD/mies. bez LB; alert budżetowy 30 USD |

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

**Ważne założenie dydaktyczne:** Cloud Run jest serverless i immutable — nie ma SSH do instancji. Ansible nie konfiguruje kontenerów Cloud Run. Ansible zarządza schematem/seedem bazy przez proxy oraz (opcjonalnie) orkiestruje deployment. To trzeba wyraźnie wyjaśnić w `docs/00-przeglad.md`.

## Struktura katalogów (docelowa)

```text
Infrastructure/liquid-streamer/Cloud-Run/
├── README.md
├── .gitignore
├── docs/
│   ├── 00-przeglad.md
│   ├── 01-przygotowanie.md
│   ├── 02-aplikacja-lokalnie.md
│   ├── 03-docker.md
│   ├── 04-terraform-fundament.md
│   ├── 05-cloud-run.md
│   ├── 06-baza-i-ansible.md
│   ├── 07-eksploatacja.md
│   ├── 08-ansible-deploy.md          # opcjonalny
│   ├── 09-domena-lb.md               # opcjonalny, blokowany brakiem domeny
│   └── 10-ci-cd-hardening.md         # opcjonalny
├── app/
│   ├── package.json / package-lock.json
│   ├── .env.example
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── cloudbuild.yaml
│   ├── src/
│   │   ├── config.js
│   │   ├── db.js
│   │   ├── app.js          # fabryka Express (dependency injection, testowalna)
│   │   └── server.js       # start, graceful shutdown
│   ├── public/
│   │   ├── index.html
│   │   ├── main.js
│   │   └── styles.css
│   └── test/
│       └── app.test.js
├── db/
│   └── migrations/
│       ├── 001_init.sql
│       └── 002_seed.sql
├── compose.yaml
├── scripts/
│   ├── db-proxy.sh
│   ├── smoke.sh
│   └── load-test.sh
├── terraform/
│   ├── versions.tf
│   ├── main.tf
│   ├── variables.tf
│   ├── apis.tf
│   ├── artifact_registry.tf
│   ├── service_accounts.tf
│   ├── secret_manager.tf
│   ├── cloud_sql.tf
│   ├── cloud_run.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   └── optional-domain-lb/    # osobny root, nieuruchamiany bez domeny
├── ansible/
│   ├── ansible.cfg
│   ├── requirements.yml
│   ├── inventory.ini
│   ├── group_vars/all.yml
│   ├── playbooks/
│   │   ├── db-apply.yml
│   │   ├── db-verify.yml
│   │   └── deploy.yml         # opcjonalny
│   └── roles/app_db/
│       ├── defaults/main.yml
│       └── tasks/main.yml
```

## Zasady generowania i prowadzenia kursu

1. **Język:** dokumentacja i komentarze w kodzie po polsku; nazwy zasobów/zmiennych po angielsku.
2. **Komentarze:** każdy plik zaczyna się krótkim „po co to jest”; przy każdym nietrywialnym bloku komentarz wyjaśniający *dlaczego*, nie tylko *co*.
3. **Bez sekretów w repo:** `.env`, `terraform.tfvars`, `*.tfstate`, hasła, klucze — ignorowane.
4. **Małe porcje:** jeden etap = jedna sesja; agent nie przechodzi dalej bez wyniku/„ok” od użytkownika.
5. **Po każdym etapie przerwa:**
   - „Co zrobiliśmy” (3–6 punktów),
   - „Dlaczego tak” (kluczowe pojęcia),
   - „Sprawdź sam” (komendy i oczekiwany wynik),
   - „Pytania kontrolne” (3–5 pytań, użytkownik odpowiada),
   - „Następny etap” dopiero po odpowiedziach.
6. **Zakaz modyfikacji istniejącej infrastruktury:** agent pracuje wyłącznie w `Infrastructure/liquid-streamer/Cloud-Run/`; nie zmienia `Infrastructure/*.tf`, `Infrastructure/liquid-streamer/VM/`.
7. **Walidacje agenta:** `npm test`, `terraform fmt -check`, `terraform init -backend=false` + `terraform validate`, składnia Ansible; mutacje wykonuje użytkownik.
8. **Bez commitów** — chyba że użytkownik wyraźnie poprosi.
9. **Każdy etap ma Definition of Done** i checkpoint; jeśli check nie przechodzi, agent debuguje przed przejściem dalej.
10. **Dokumentacja nie dubluje kodu:** pokazuje fragmenty i wyjaśnia, a pełny kod żyje w plikach.

---

## Etap 0 — Przygotowanie i bezpieczeństwo

**Pliki:** `README.md`, `docs/00-przeglad.md`, `docs/01-przygotowanie.md`, `.gitignore`.

**Treść:**
- mapa kursu, architektura, koszt, zasady przerw,
- pojęcia: projekt, region, billing, IAM, ADC, Terraform state, Cloud Run vs VM, serverless, Cloud SQL,
- instalacja brakujących narzędzi:
  - `brew install cloud-sql-proxy mysql-client jq`,
  - `export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"` (mysql-client jest keg-only; dodaj do `~/.zshrc`),
  - `python3 -m venv .venv-ansible && source .venv-ansible/bin/activate && pip install ansible-core pymysql`,
- logowanie:
  - `gcloud auth login`,
  - `gcloud config set project liquid-streamer-284510`,
  - `gcloud auth application-default login`,
- weryfikacja billingu i uprawnień (read-only):
  - `gcloud billing projects describe liquid-streamer-284510`,
  - `gcloud services list --enabled --project liquid-streamer-284510`,
- budżet: ręczny alert w Billing → Budgets & alerts, np. 30 USD, progi 50/90/100%,
- state bucket: sprawdzić `gs://infrastructure-ai-pm`; jeśli brak dostępu, utworzyć dedykowany bucket z wersjonowaniem i podmienić backend,
- `.gitignore`: `node_modules/`, `.env`, `*.log`, `.venv-ansible/`, `ansible/*.retry`, `terraform/.terraform/`, `*.tfstate*`, `*.tfvars`, `tfplan`, `.DS_Store`.

**Definition of Done:** użytkownik zalogowany, billing aktywny, alert budżetowy ustawiony, bucket state dostępny, narzędzia zainstalowane. **Bez kodu aplikacji.**

**Checkpoint:** dlaczego ADC różni się od `gcloud auth login`; po co remote state; dlaczego alert budżetowy przed `apply`; czym jest region.

---

## Etap 1 — Aplikacja lokalnie (Node.js + MySQL + frontend)

**Pliki:** `app/package.json`, `app/src/config.js`, `app/src/db.js`, `app/src/app.js`, `app/src/server.js`, `app/public/*`, `app/test/app.test.js`, `app/.env.example`, `db/migrations/001_init.sql`, `db/migrations/002_seed.sql`, `compose.yaml`, `docs/02-aplikacja-lokalnie.md`.

**Aplikacja:**
- `config.js`: waliduje `PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; obsługuje dwa tryby:
  - local: `DB_HOST` + `DB_PORT`,
  - Cloud Run: `DB_SOCKET` (ścieżka `/cloudsql/...`).
- `db.js`: `mysql2/promise` pool, `connectionLimit: 3` (max 6 instancji × 3 = 18 połączeń, bezpiecznie dla `db-f1-micro`), `ping()`, `query()`, `close()`.
- `app.js`: fabryka `createApp(db)` — łatwa do testów z fake DB.
- Endpointy:
  - `GET /api/health` — `SELECT 1`; 200/503; zwraca `instance` (`HOSTNAME`), `revision`, `region`, `db`.
  - `POST /api/visits` — insert do `visits` z `instance_id`; zwraca total i ostatnie 5 instancji.
  - `GET /api/visits` — tylko odczyt total + ostatnie 5.
  - `GET /api/config` — `settings.site_title`.
  - `GET /api/info` — metadane instancji (bez DB).
- `server.js`: `0.0.0.0`, graceful shutdown na SIGTERM/SIGINT, zamykanie poola.
- Frontend: vanilla JS, `fetch`, wyświetla tytuł, licznik, ID instancji, rewizję, ostatnie instancje, przycisk „Odwiedź ponownie”, stan błędu.
- `db/migrations/001_init.sql`: `visits`, `settings`; `utf8mb4`; indeks po `visited_at`.
- `db/migrations/002_seed.sql`: `INSERT ... ON DUPLICATE KEY UPDATE` dla `site_title = 'Cloud Run Lab'`.
- `compose.yaml`: MySQL 8.0, healthcheck, volume, init mount obu migracji, port 3306.
- Testy: `node:test` + fake DB; health 200/503, visits 200, config 200; bez zależności od prawdziwej bazy.

**Komendy użytkownika:**
```bash
cd Infrastructure/liquid-streamer/Cloud-Run
docker compose up -d db
cd app
npm install
cp .env.example .env
npm test
npm run dev
curl -s localhost:8080/api/health | jq
curl -s -X POST localhost:8080/api/visits | jq
```
Otworzyć `http://localhost:8080`.

**Definition of Done:** testy przechodzą; strona działa; licznik rośnie; restart aplikacji nie zeruje licznika (dane w MySQL); brak sekretów w repo.

**Checkpoint:** dlaczego frontend jest serwowany przez Node; co to stateless; dlaczego `0.0.0.0`; po co `graceful shutdown`; dlaczego testujemy przez fake DB.

---

## Etap 2 — Docker lokalnie

**Pliki:** `app/Dockerfile`, `app/.dockerignore`, rozszerzenie `compose.yaml` o usługę `app`, `docs/03-docker.md`.

**Dockerfile:** multi-stage `node:22-alpine`, `npm ci --omit=dev`, `USER node`, `EXPOSE 8080`, `CMD ["node", "src/server.js"]`. Komentarze o warstwach, cache i non-root.

**Komendy:**
```bash
cd Infrastructure/liquid-streamer/Cloud-Run
docker compose up --build
curl -s localhost:8080/api/health | jq
docker compose run --rm app id   # uid=1000(node)
```
Apple Silicon: `docker build --platform linux/amd64 ...`; wyjaśnić, dlaczego Cloud Run używa `linux/amd64` i dlaczego w etapie 4 i tak budujemy w Cloud Build.

**Definition of Done:** cały stack działa w kontenerach; aplikacja łączy się z `db` po nazwie usługi; kontener działa jako `node`.

**Checkpoint:** po co multi-stage; dlaczego `.env` nie może wejść do obrazu; czym różni się obraz od kontenera; po co `.dockerignore`.

---

## Etap 3 — Terraform: fundament (bez Cloud Run)

**Pliki:** `terraform/versions.tf`, `main.tf`, `variables.tf`, `apis.tf`, `artifact_registry.tf`, `service_accounts.tf`, `secret_manager.tf`, `cloud_sql.tf`, `outputs.tf`, `terraform.tfvars.example`, `docs/04-terraform-fundament.md`.

**Kluczowe zasoby:**
- backend GCS: `bucket = "infrastructure-ai-pm"`, `prefix = "terraform/cloud-run-lab"`,
- provider `hashicorp/google ~> 6.8` oraz `hashicorp/random` (dla `random_password`), `project_id = "liquid-streamer-284510"`, `region = "europe-central2"`,
- `data "google_project"` do numeru projektu (potrzebny dla Cloud Build SA),
- `google_project_service` dla: run, sqladmin, secretmanager, artifactregistry, cloudbuild, compute, iam, serviceusage, storage, logging; `disable_on_destroy = false`,
- Artifact Registry Docker repo `cloudrun-lab` w `europe-central2`,
- service account `cloudrun-lab-run` + `roles/cloudsql.client`,
- Cloud Build default SA (`<project_number>@cloudbuild.gserviceaccount.com`) + `roles/artifactregistry.writer`,
- `random_password` (24 znaki, bezpieczny zestaw) → Secret Manager `cloudrun-lab-db-password` + wersja + `secretAccessor` tylko dla SA Cloud Run,
- Cloud SQL:
  - `cloudrun-lab-mysql`, `MYSQL_8_0`, `europe-central2`, `db-f1-micro`, `ENTERPRISE`, 10 GB SSD,
  - `deletion_protection = false` (lab),
  - backup daily `03:00`,
  - `ipv4_enabled = true`, **bez authorized networks**, `ssl_mode = "ENCRYPTED_ONLY"`,
- baza `appdb` (`utf8mb4`), user `app` (`host = "%"`, hasło z `random_password`). Na MySQL 8.0 Cloud SQL automatycznie nadaje `cloudsqlsuperuser`; w komentarzu zaznaczyć, że to wygodne w labie, a w produkcji trzeba zawęzić uprawnienia,
- outputy: `cloud_sql_connection_name`, `artifact_registry_repo`, `image_uri`, `db_name`, `db_user`, `db_password_secret`, `run_service_account`.
- `image_tag` variable default `v1`, `min_instances=3`, `max_instances=6`, `db_tier="db-f1-micro"`.

**Komendy użytkownika:**
```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply
terraform output
gcloud sql instances describe cloudrun-lab-mysql --format='value(connectionName)'
gcloud artifacts repositories list --location=europe-central2
gcloud secrets versions access latest --secret=cloudrun-lab-db-password | wc -c   # tylko długość, bez wypisywania sekretu
```
Ostrzec: Cloud SQL tworzy się 5–10 min; koszt zaczyna naliczać się od tego etapu. Nie tworzymy jeszcze Cloud Run.

**Definition of Done:** `apply` kończy się sukcesem; outputy poprawne; sekret istnieje; test odczytu sekretu nie wypisuje go na ekran; brak Cloud Run.

**Checkpoint:** co trzyma Terraform state i dlaczego nie w repo; po co osobne SA; dlaczego hasło w Secret Manager, a nie w env; dlaczego brak authorized networks jest OK przy proxy; dlaczego Cloud SQL w tym samym regionie.

---

## Etap 4 — Obraz w Artifact Registry (Cloud Build)

**Pliki:** `app/cloudbuild.yaml`, `docs/05-cloud-run.md` (część o buildzie).

**Cloud Build:** `europe-central2`, `gcr.io/cloud-builders/docker`, tag `_TAG`, obraz `europe-central2-docker.pkg.dev/$PROJECT_ID/cloudrun-lab/app:${_TAG}`, `options.logging = CLOUD_LOGGING_ONLY`.

**Komendy:**
```bash
cd Infrastructure/liquid-streamer/Cloud-Run/app
gcloud builds submit --config=cloudbuild.yaml --substitutions=_TAG=v1 --region=europe-central2 .
gcloud artifacts docker images list \
  europe-central2-docker.pkg.dev/liquid-streamer-284510/cloudrun-lab/app
```
Wyjaśnić: Cloud Build zamiast lokalnego Docker (powtarzalność, architektura, brak problemów Apple Silicon), uprawnienia Cloud Build SA, propagacja IAM (możliwy retry po 1–2 min).

**Definition of Done:** obraz `v1` widoczny w Artifact Registry; logi Cloud Build bez błędów.

**Checkpoint:** dlaczego tagi immutable; co to registry; dlaczego Cloud Build potrzebuje `artifactregistry.writer`.

---

## Etap 5 — Cloud Run publicznie (3+ instancje)

**Pliki:** `terraform/cloud_run.tf`, aktualizacja `outputs.tf`, `docs/05-cloud-run.md`.

**Zasoby:**
- `google_cloud_run_v2_service` `cloudrun-lab`, `location = europe-central2`, `ingress = INGRESS_TRAFFIC_ALL`, `deletion_protection = false`,
- `template.service_account = cloudrun-lab-run`,
- `template.scaling { min_instance_count = 3; max_instance_count = 6 }`,
- `max_instance_request_concurrency = 80`, `timeout = "30s"`,
- kontener: obraz z `image_tag`, port 8080,
- env: `NODE_ENV=production`, `DB_SOCKET=/cloudsql/<connection_name>`, `DB_NAME`, `DB_USER`, `APP_REGION`;
- `DB_PASSWORD` przez `value_source.secret_key_ref` → Secret Manager,
- `resources { limits = { cpu = "1"; memory = "512Mi" }; cpu_idle = true }`,
- startup probe HTTP `/api/health` (sprawdza DB), liveness probe TCP 8080 (sprawdza proces),
- volume `cloudsql` + `cloud_sql_instance` + `volume_mounts` `/cloudsql`,
- `google_cloud_run_v2_service_iam_member` `roles/run.invoker` dla `allUsers`,
- output `cloud_run_url`.

**Komendy:**
```bash
cd terraform
terraform plan
terraform apply
terraform output -raw cloud_run_url
URL=$(terraform output -raw cloud_run_url)
curl -i "$URL/api/health"
curl -i "$URL/api/config"     # oczekiwane 500 do czasu etapu 6
```
Otworzyć URL w przeglądarce i na telefonie w trybie incognito. Sprawdzić IAM:
```bash
gcloud run services get-iam-policy cloudrun-lab --region=europe-central2
gcloud run services describe cloudrun-lab --region=europe-central2 --format='value(status.url)'
```
Wyjaśnić: service vs revision; min 3 oznacza stale utrzymywane instancje; brak sticky sessions; publiczny `run.app`.

**Definition of Done:** usługa publiczna; `/api/health` 200; strona się ładuje; `/api/config` zwraca błąd o brakującej tabeli (to poprawi etap 6); 3 instancje jako minimum.

**Checkpoint:** czym jest revision; dlaczego min 3 kosztuje; dlaczego liveness nie może zależeć od DB tak samo jak startup; dlaczego socket zamiast TCP; co robi `allUsers`.

---

## Etap 6 — Baza w chmurze + Ansible (schema, seed, idempotencja)

**Pliki:** `ansible/ansible.cfg`, `requirements.yml`, `inventory.ini`, `group_vars/all.yml`, `playbooks/db-apply.yml`, `playbooks/db-verify.yml`, `roles/app_db/*`, `scripts/db-proxy.sh`, `docs/06-baza-i-ansible.md`.

**Założenia:**
- Ansible działa lokalnie (`localhost`, `ansible_connection=local`),
- łączy się przez Cloud SQL Auth Proxy na `127.0.0.1:3307`,
- hasło DB pobierane z Secret Managera:
  `lookup('pipe', 'gcloud secrets versions access latest --secret=cloudrun-lab-db-password --project liquid-streamer-284510') | trim`,
- `no_log: true` na zadaniach z hasłem,
- `community.mysql` + `PyMySQL` + `mysql-client` (do `state=import`).

**Migracje:**
- `db/migrations/001_init.sql` — tabele `visits`, `settings`,
- `db/migrations/002_seed.sql` — seed `site_title`,
- Ansible tworzy `schema_migrations` (`version`, `applied_at`),
- odczytuje zastosowane wersje,
- aplikuje tylko brakujące pliki przez `community.mysql.mysql_db state=import`,
- zapisuje wersje po sukcesie.
- Drugie uruchomienie: `pending_versions` puste → `changed=0`. To jest pokazowa idempotencja.

**Uruchomienie:**
```bash
cd Infrastructure/liquid-streamer/Cloud-Run
chmod +x scripts/*.sh
source .venv-ansible/bin/activate
ansible-galaxy collection install -r ansible/requirements.yml
./scripts/db-proxy.sh          # terminal 1, port 3307
ansible-playbook ansible/playbooks/db-apply.yml   # terminal 2
ansible-playbook ansible/playbooks/db-verify.yml
ansible-playbook ansible/playbooks/db-apply.yml   # drugi raz: changed=0
```
Weryfikacja w chmurze:
```bash
URL=$(terraform -chdir=terraform output -raw cloud_run_url)
curl -s -X POST "$URL/api/visits" | jq
curl -s "$URL/api/config" | jq
```
W przeglądarce: tytuł z bazy, licznik rośnie, ostatnie instancje pochodzą z różnych `HOSTNAME`.

**Definition of Done:** tabele istnieją; seed działa; aplikacja czyta i zapisuje do Cloud SQL; drugi run Ansible jest bez zmian; `db-verify` przechodzi asercje.

**Checkpoint:** dlaczego Terraform nie tworzy tabel; dlaczego Ansible nie konfiguruje Cloud Run; co to idempotencja; po co tabela migracji; dlaczego proxy, a nie publiczny MySQL; dlaczego hasło z Secret Managera, a nie z pliku.

---

## Etap 7 — Eksploatacja, skalowanie, rollback

**Pliki:** `scripts/smoke.sh`, `scripts/load-test.sh`, `docs/07-eksploatacja.md`.

**Treść i komendy:**
- logi:
  `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="cloudrun-lab"' --limit=20`,
- lista rewizji i rollback:
  `gcloud run revisions list --service=cloudrun-lab --region=europe-central2`,
  `gcloud run services update-traffic cloudrun-lab --to-revisions=<REV>=100 --region=europe-central2`,
- test obciążenia:
  `npx autocannon -m POST -c 50 -d 30 "$URL/api/visits"`,
- dowód wielu instancji:
  `for i in $(seq 1 30); do curl -s "$URL/api/info" | jq -r .instance; done | sort | uniq -c`,
- metryki Cloud Run w konsoli; min/max instances; cold start; koszt min 3,
- `smoke.sh`: health, config, visits, asercje HTTP 200,
- `load-test.sh`: opakowanie autocannon z komentarzami.

**Definition of Done:** widać wiele ID instancji; rollback działa; logi pokazują requesty; użytkownik rozumie, dlaczego licznik nie ginie przy skalowaniu.

**Checkpoint:** dlaczego brak sticky sessions; co się stanie przy `min_instances=0`; jak działa autoscaling; jak wrócić do poprzedniej rewizji; co kosztuje utrzymywanie 3 instancji.

---

## Etap 8 (opcjonalny) — Ansible jako orkiestrator deployu

**Pliki:** `ansible/playbooks/deploy.yml`, `docs/08-ansible-deploy.md`.

**Playbook:**
1. `vars_prompt` o tag obrazu (np. `v2`),
2. `gcloud builds submit` w `app/`,
3. `terraform -chdir=terraform apply -auto-approve -var="image_tag=<tag>"`,
4. odczyt `cloud_run_url`,
5. smoke test `uri` z retry.

Wyraźnie ostrzec: w produkcji deployment robi CI/CD z approvals, a nie Ansible z `-auto-approve`; ten etap jest tylko ćwiczeniem orkiestracji. Pokazać, że nowy tag tworzy nową rewizję i jak wrócić.

**Definition of Done:** `v2` wdrożone jednym playbookiem; smoke test przechodzi; rollback do `v1` działa.

**Checkpoint:** kiedy Ansible, a kiedy CI/CD; dlaczego Terraform pozostaje źródłem prawdy; co się dzieje z obrazem przy rollbacku.

---

## Etap 9 (opcjonalny, zablokowany brakiem domeny) — własna domena + globalny LB

**Pliki:** `docs/09-domena-lb.md`, `terraform/optional-domain-lb/{main.tf,variables.tf,outputs.tf,terraform.tfvars.example}`.

**Nie uruchamiać `apply` bez domeny.** Przygotować kod i instrukcję:
- `google_compute_global_address`,
- `google_compute_region_network_endpoint_group` typu `SERVERLESS` → usługa Cloud Run w `europe-central2`,
- `google_compute_backend_service` + `google_compute_url_map`,
- `google_compute_managed_ssl_certificate` dla `var.domain_name`,
- `google_compute_target_https_proxy` + `google_compute_global_forwarding_rule` (443),
- przekierowanie HTTP→HTTPS (80),
- wariant DNS: Cloud DNS zone + rekordy A/AAAA **albo** ręczne rekordy u rejestratora (użytkownik nie ma domeny — wybrać później),
- po weryfikacji HTTPS: ustawić Cloud Run `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"`, żeby zablokować bezpośredni `run.app`; pozostawić `allUsers` invoker dla LB,
- koszt LB ok. 18–25 USD/mies. + domena; globalny LB jest zasobem globalnym, ale backend i DB pozostają w Warszawie.

**Definition of Done:** `terraform plan` w osobnym rootcie przechodzi; dokumentacja gotowa; **brak `apply`** do zakupu domeny.

**Checkpoint:** po co LB przy własnej domenie; co to serverless NEG; dlaczego certyfikat czeka na DNS; dlaczego nie wyłączamy `allUsers`.

---

## Etap 10 (opcjonalny) — CI/CD i hardening

**Plik:** `docs/10-ci-cd-hardening.md` (+ ewentualny przykładowy workflow, nieaktywny).

**Treść:**
- GitHub Actions z Workload Identity Federation (bez kluczy SA): build → push → `terraform apply` → smoke,
- Cloud Build trigger jako alternatywa,
- hardening: skanowanie obrazów, Cloud Armor, prywatny Cloud SQL + Direct VPC egress, IAM DB auth, rotacja sekretów, uptime check, alerty, `deletion_protection=true`, refaktor Terraform do modułów,
- granica: to materiał do dalszej nauki, nie blokuje głównego kursu.

---

## Walidacja końcowa

1. `npm test` — zielone.
2. `terraform fmt -check -recursive`; `terraform init` + `terraform validate`; `terraform plan` po `apply` → `No changes`.
3. Lokalnie: `docker compose up --build`; strona i licznik działają.
4. W chmurze: publiczny URL, `/api/health` 200, `/api/visits` rośnie, `/api/config` zwraca tytuł z DB.
5. Co najmniej 3 instancje: min 3 w Terraform + test obciążenia pokazuje różne `instance`.
6. Ansible: drugi run `changed=0`; `db-verify` przechodzi.
7. Rollback: poprzednia rewizja przywrócona.
8. Użytkownik umie własnymi słowami wyjaśnić rolę Terraform, Ansible, Cloud Run, Cloud SQL, Secret Manager, Artifact Registry i Cloud Build.
9. Cleanup: `terraform destroy`, usunięcie obrazów/backupów/LB; zatrzymanie Cloud SQL, gdy kurs nie jest używany.

## Ryzyka i uwagi

- **Uprawnienia/IAM:** użytkownik musi mieć prawa do projektu, billingu i `setIamPolicy`. Jeśli org policy blokuje `allUsers` lub public IP, trzeba wyjątku albo LB/IAP — zgłosić przed etapem 5.
- **Koszt:** 3 instancje + Cloud SQL + backupy to ok. 20–30 USD/mies.; LB i domena dodatkowo. Po etapie 3 koszt już trwa. Przypominać o `min_instances=0` i `terraform destroy`.
- **`db-f1-micro`** nie ma SLA i nie jest produkcyjny; do labu wystarcza. Ma też ograniczoną liczbę połączeń — dlatego pool ma `connectionLimit: 3`; przy większym ruchu upgrade do `db-g1-small` jednym variable.
- **Sekret w state:** hasło DB i `random_password` są w state; bucket state musi być dostępny tylko dla uprawnionych. W produkcji użyć write-only/ephemeral lub rotacji.
- **Cloud SQL Auth Proxy:** `ssl_mode=ENCRYPTED_ONLY` powinno działać z proxy; jeśli pojawi się błąd połączenia, fallback na domyślny tryb SSL i opis w docs.
- **Cloud Build IAM:** propagacja `artifactregistry.writer` może zająć 1–2 min; retry builda.
- **Apple Silicon:** lokalny build może wymagać `--platform linux/amd64`; Cloud Build rozwiązuje problem docelowo.
- **Porty lokalne:** MySQL w Compose na 3306, proxy na 3307; jeśli 3306 zajęty, zmienić mapowanie i `.env`.
- **Ansible:** `mysql_db state=import` wymaga `mysql-client`; `PyMySQL` w venv; bez tego playbook się wysypie.
- **Brak domeny:** etap 9 pozostaje przygotowany, ale nieuruchomiony; nie blokuje głównego kursu.
- **Nie ruszać istniejącej VM/VPC** w `us-central1`; nowy root Terraform ma osobny state i prefiks.

## Poza zakresem głównego kursu

- Produkcyjne HA Cloud SQL, read replica, PITR.
- Własna domena bez zakupu domeny.
- CI/CD z approvals i WIF (tylko materiał opcjonalny).
- Kubernetes/GKE, Cloud Armor, private IP, IAM DB auth (opcjonalny hardening).
- Refaktor Terraform do modułów (opcjonalne ćwiczenie).
- Aplikacja z prawdziwą autoryzacją użytkowników; teraz publiczny licznik wizyt.

## Otwarte zależności zewnętrzne

- **Domena i DNS:** potrzebne dopiero do etapu 9. Do tego czasu publiczny adres to `run.app`.
- **Billing/uprawnienia GCP:** weryfikowane w etapie 0; jeśli coś jest zablokowane, agent dostosowuje plan przed etapem 3.
