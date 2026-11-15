# 01 — Przygotowanie i bezpieczeństwo (Etap 0)

## Cel etapu

Przygotować środowisko i zabezpieczyć projekt **zanim** cokolwiek utworzymy w chmurze. Po tym etapie:

- masz zainstalowane brakujące narzędzia,
- `gcloud` i Terraform używają właściwych poświadczeń,
- billing jest aktywny, a alert budżetowy ustawiony,
- wiesz, gdzie będzie leżał stan Terraform i masz do niego dostęp,
- repo ignoruje sekrety i artefakty lokalne.

**W tym etapie nie powstaje kod aplikacji ani żadna infrastruktura.** Nie uruchamiamy `terraform apply`, nie tworzymy bazy, nie włączamy płatnych usług.

## Co powstaje

| Plik | Rola |
|---|---|
| `README.md` | mapa kursu, architektura, koszt, zasady pracy |
| `docs/00-przeglad.md` | pojęcia i podział odpowiedzialności między komponentami |
| `docs/01-przygotowanie.md` | ten dokument |
| `.gitignore` | lista rzeczy, które nigdy nie trafią do repo |

---

## Krok 1 — Narzędzia

### 1a. Co już masz

Na tej maszynie sprawdzone są: `gcloud`, `terraform`, `node`, `npm`, `docker`. Brakuje natomiast `ansible`, `cloud-sql-proxy`, `mysql` i `jq`. Instalujemy je teraz, bo Etap 6 (Ansible + import SQL) bez nich się wysypie.

### 1b. Instalacja przez Homebrew

```bash
brew install cloud-sql-proxy mysql-client jq
```

`mysql-client` jest w Homebrew **keg-only**, czyli nie trafia do `PATH` automatycznie. Dodajemy jego katalog `bin` ręcznie:

```bash
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
```

Żeby przetrwało nowe terminale, dopisz to do `~/.zshrc`:

```bash
echo 'export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"' >> ~/.zshrc
```

> Dlaczego nie instalujemy pełnego serwera MySQL? Lokalnie bazę uruchomimy w Dockerze (Etap 1). Potrzebujemy tylko klienta `mysql` do importu plików SQL przez Ansible.

### 1c. Środowisko Pythona dla Ansible

Ansible i sterownik `PyMySQL` instalujemy w osobnym wirtualnym środowisku, żeby nie mieszać ich z systemowym Pythonem:

```bash
cd Infrastructure/liquid-streamer/Cloud-Run
python3 -m venv .venv-ansible
source .venv-ansible/bin/activate
pip install --upgrade pip
pip install ansible-core pymysql
```

Katalog `.venv-ansible/` jest już ignorowany przez git. Środowisko aktywujesz w terminalu, w którym uruchamiasz Ansible (Etap 6); po zamknięciu terminala trzeba zrobić `source .venv-ansible/bin/activate` ponownie.

Kolekcję `community.mysql` zainstalujemy w Etapie 6 z pliku `ansible/requirements.yml`, żeby wersja była zapisana w repo.

### 1d. Weryfikacja

```bash
cloud-sql-proxy --version
mysql --version
jq --version
node --version
npm --version
terraform -version
docker --version
gcloud --version
ansible --version
```

Oczekiwane: każda komenda wypisuje wersję i kończy się kodem 0. Jeśli `mysql: command not found`, nie wykonałeś `export PATH=...` w tym terminalu.

---

## Krok 2 — Logowanie i poświadczenia

### 2a. Trzy różne rzeczy, które łatwo pomylić

| Komenda | Do czego służy | Kto tego używa |
|---|---|---|
| `gcloud auth login` | sesja człowieka dla CLI `gcloud` | Ty, ręcznie w terminalu |
| `gcloud config set project ...` | domyślny projekt dla komend `gcloud` | CLI |
| `gcloud auth application-default login` | **ADC** — poświadczenia dla bibliotek i narzędzi | Terraform, Google Cloud SDK w kodzie, `gcloud storage` w niektórych kontekstach |

Terraform nie czyta sesji z `gcloud auth login`. Domyślnie używa **Application Default Credentials**. Dlatego potrzebne są oba logowania: pierwsze do wygodnego `gcloud`, drugie do Terraform.

### 2b. Logowanie

```bash
gcloud auth login
gcloud config set project liquid-streamer-284510
gcloud auth application-default login
```

Trzecia komenda otworzy przeglądarkę i zapisze ADC lokalnie. Nie commituj tych plików — leżą poza repo, w katalogu konfiguracyjnym użytkownika.

### 2c. Weryfikacja

```bash
gcloud config get-value project
gcloud auth list
gcloud auth application-default print-access-token | wc -c
```

Oczekiwane:

- projekt to `liquid-streamer-284510`,
- Twoje konto ma `ACTIVE`,
- długość tokenu jest większa od zera (nie wypisujemy samego tokenu na ekran).

---

## Krok 3 — Billing i uprawnienia

### 3a. Sprawdź billing

```bash
gcloud billing projects describe liquid-streamer-284510
```

Szukaj `billingEnabled: true`. Jeśli jest `false`, w konsoli Cloud: **Billing → Link a billing account** i przypisz konto płatnicze do projektu. Bez tego Etap 3 zatrzyma się na tworzeniu Cloud SQL.

### 3b. Sprawdź uprawnienia

```bash
gcloud projects get-iam-policy liquid-streamer-284510 \
  --flatten="bindings[].members" \
  --filter="bindings.members:$(gcloud config get-value account)" \
  --format="table(bindings.role)"
```

Potrzebujesz roli, która pozwala tworzyć zasoby **i** nadawać IAM (np. `roles/owner` albo `roles/editor` + `roles/resourcemanager.projectIamAdmin`). Jeśli masz tylko podgląd, zatrzymaj się i zgłoś to — Etap 3 i 5 nie przejdą.

### 3c. Sprawdź, co jest już włączone

```bash
gcloud services list --enabled --project liquid-streamer-284510 | sort
```

Nie musisz nic włączać ręcznie. W Etapie 3 Terraform włączy potrzebne API (`run`, `sqladmin`, `secretmanager`, `artifactregistry`, `cloudbuild`, `compute`, `iam`, `serviceusage`, `storage`, `logging`) z `disable_on_destroy = false`. To ostatnie jest ważne: przy `terraform destroy` nie wyłączymy API wspólnego projektu, z którego korzysta istniejąca VM.

> **Uwaga na polityki organizacji.** Jeśli Twoja organizacja blokuje publiczny dostęp (`allUsers`) albo publiczne IP Cloud SQL, dowiemy się o tym dopiero w Etapie 5. Zgłoś to teraz, jeśli wiesz, że takie ograniczenie obowiązuje — dostosujemy plan (LB/IAP albo inne podejście) przed etapem płatnym.

---

## Krok 4 — Alert budżetowy

Ręcznie w konsoli Cloud:

1. **Billing → Budgets & alerts → Create budget**.
2. Zakres: projekt `liquid-streamer-284510` (albo całe konto, jeśli wolisz).
3. Kwota: **30 USD** (lub równowartość w walucie konta).
4. Progi alertów: **50%, 90%, 100%** faktycznego wydatku.
5. Adres e-mail: Twój.
6. Zapisz.

> Dlaczego teraz? Alert nie blokuje wydatków — tylko powiadamia. Ustawiony **przed** pierwszym `apply` daje Ci czas na reakcję, zanim koszt Cloud SQL i trzech instancji Cloud Run urosną przez pomyłkę. Po Etapie 3 koszt nalicza się nawet wtedy, gdy nikt nie korzysta ze strony.

---

## Krok 5 — Bucket na stan Terraform

Stan Terraform zawiera m.in. hasło bazy i inne wartości wrażliwe. Trzymamy go w prywatnym buckecie GCS, nie w repo.

### 5a. Sprawdź istniejący bucket

```bash
gcloud storage buckets describe gs://infrastructure-ai-pm --project=liquid-streamer-284510
gcloud storage ls gs://infrastructure-ai-pm/terraform/
```

Oczekiwane: opis bucketa i lista prefiksów (m.in. `terraform/state` od istniejącej infrastruktury). Nasz nowy root użyje prefiksu `terraform/cloud-run-lab`, więc nie nadpiszemy stanu VM.

### 5b. Opcjonalny test zapisu

```bash
echo "probe" | gcloud storage cp - gs://infrastructure-ai-pm/terraform/cloud-run-lab/.probe
gcloud storage rm gs://infrastructure-ai-pm/terraform/cloud-run-lab/.probe
```

Jeśli obie komendy przechodzą, masz prawo zapisu i Etap 3 może użyć tego bucketa bez zmian.

### 5c. Fallback: dedykowany bucket

Jeśli nie masz dostępu do `infrastructure-ai-pm` (np. należy do innego projektu lub innego zespołu), utwórz osobny, wersjonowany bucket:

```bash
gcloud storage buckets create gs://liquid-streamer-284510-tfstate \
  --project=liquid-streamer-284510 \
  --location=europe-central2 \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update gs://liquid-streamer-284510-tfstate --versioning
```

Wtedy w Etapie 3 podmienimy `backend "gcs"` na ten bucket. **Nie rób tego samodzielnie w plikach** — zgłoś agentowi, który przygotuje zmianę i sprawdzi, czy prefiks jest unikalny.

> Wersjonowanie chroni przed przypadkowym nadpisaniem stanu. `uniform-bucket-level-access` upraszcza IAM, a `public-access-prevention` blokuje publiczne udostępnienie.

---

## Krok 6 — `.gitignore`

Plik `.gitignore` w tym katalogu wyłącza z repo:

| Wzorzec | Co ignoruje | Dlaczego |
|---|---|---|
| `node_modules/` | zależności npm | odtwarzalne z `package-lock.json`, duże |
| `.env`, `.env.*` (poza `.env.example`) | lokalne sekrety | hasła i klucze nie mogą trafić do repo |
| `*.log` | logi | szum i potencjalne dane wrażliwe |
| `.venv-ansible/` | środowisko Pythona | odtwarzalne, duże |
| `ansible/*.retry`, `ansible/**/*.retry` | pliki retry Ansible | artefakty lokalne |
| `**/.terraform/` | providery i cache | pobierane przez `terraform init` |
| `*.tfstate`, `*.tfstate.*` | stan Terraform | zawiera sekrety |
| `*.tfvars` (poza `*.tfvars.example`) | wartości zmiennych | mogą zawierać dane wrażliwe |
| `tfplan` | zapisany plan | może zawierać wartości wrażliwe |
| `.DS_Store` | metadane macOS | nie należy do projektu |

`terraform.tfvars.example` i `.env.example` **są commitowane** — to szablony bez sekretów, pokazują, jakie zmienne trzeba uzupełnić.

---

## Definition of Done

Etap 0 jest zamknięty, gdy wszystkie poniższe punkty dają oczekiwany wynik:

```bash
cd Infrastructure/liquid-streamer/Cloud-Run

# 1. Narzędzia
command -v cloud-sql-proxy && command -v mysql && command -v jq && command -v ansible

# 2. Poświadczenia
gcloud config get-value project
gcloud auth application-default print-access-token | wc -c

# 3. Billing
gcloud billing projects describe liquid-streamer-284510 --format='value(billingEnabled)'

# 4. Bucket stanu
gcloud storage buckets describe gs://infrastructure-ai-pm --format='value(name)'

# 5. Pliki kursu
ls README.md .gitignore docs/00-przeglad.md docs/01-przygotowanie.md
```

Oczekiwane: wszystkie komendy kończą się sukcesem, billing to `True`, bucket istnieje (albo masz gotowy fallback), a pliki kursu są na miejscu.

**Nie ma jeszcze:** kodu aplikacji, `compose.yaml`, plików Terraform, Ansible. To celowe — kolejne etapy budują je po kolei.

## Pytania kontrolne

Odpowiedz własnymi słowami (krótko wystarczy):

1. Czym różni się `gcloud auth login` od `gcloud auth application-default login` i którego z nich używa Terraform?
2. Po co trzymamy stan Terraform w GCS, skoro plik `terraform.tfstate` może leżeć lokalnie?
3. Dlaczego alert budżetowy ustawiamy **przed** pierwszym `terraform apply`, a nie po nim?
4. Czym jest region i dlaczego Cloud Run, Cloud SQL oraz Artifact Registry umieszczamy w tym samym regionie?
5. Dlaczego `.env` jest ignorowane, a `.env.example` trafia do repo?

## Następny etap

Po Twoich odpowiedziach i potwierdzeniu, że Definition of Done przechodzi, przejdziemy do **Etapu 1 — aplikacja lokalnie**: Node.js, MySQL w Docker Compose, frontend, testy i pierwszy działający licznik na `http://localhost:8080`.
