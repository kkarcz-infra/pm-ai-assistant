# 02 — Aplikacja lokalnie (Etap 1)

## Cel etapu

Zbudować działającą aplikację i uruchomić ją lokalnie z MySQL w Dockerze **bez** żadnych zasobów w chmurze. Po tym etapie masz w pełni działający licznik wizyt na `http://localhost:8080`, a dane przeżywają restart procesu Node.

Koszt tego etapu: **0 USD**.

## Co powstaje

```text
app/
├── package.json          # Node 22 LTS, Express, mysql2, "type": "module"
├── package-lock.json     # wynik npm install — commitowany dla powtarzalności
├── .env.example          # szablon konfiguracji (bez sekretów)
├── src/
│   ├── config.js         # walidacja env, dwa tryby połączenia z bazą
│   ├── db.js             # pula mysql2, connectionLimit = 3
│   ├── app.js            # fabryka createApp(db) — trasy i statyki
│   └── server.js         # start, 0.0.0.0, graceful shutdown
├── public/
│   ├── index.html        # strona licznika
│   ├── main.js           # fetch do /api/*, obsługa błędów
│   └── styles.css        # wygląd, bez zależności
└── test/
    └── app.test.js       # node:test + fałszywa baza
db/migrations/
├── 001_init.sql          # visits, settings
└── 002_seed.sql          # początkowy site_title
compose.yaml              # lokalny MySQL 8.0
```

## Endpointy

| Metoda | Ścieżka | Co robi | Baza |
|---|---|---|---|
| `GET` | `/api/health` | `SELECT 1`; 200 lub 503 | tak |
| `GET` | `/api/visits` | łączna liczba wizyt + 5 ostatnich instancji | tak |
| `POST` | `/api/visits` | zapisuje wizytę i zwraca nowy stan | tak |
| `GET` | `/api/config` | tytuł strony z tabeli `settings` | tak |
| `GET` | `/api/info` | metadane instancji (bez bazy) | nie |
| `GET` | `/` | statyczny frontend z `app/public` | nie |

## Decyzje projektowe i dlaczego

### Fabryka `createApp(db)` zamiast globalnego poola

`app.js` nie importuje `db.js`. Dostaje interfejs bazy jako argument. Dzięki temu:

- testy podstawiają fałszywą bazę i nie potrzebują MySQL ani Dockera,
- `server.js` jest jedynym miejscem, które wie, jak zbudować prawdziwą pulę,
- trasy nie znają sekretów ani trybu połączenia.

To wzorzec **dependency injection**: zamiast ukrytej zależności globalnej mamy jawny parametr. W testach wystarczy obiekt z metodami `ping()` i `query()`, a nie prawdziwa baza.

### `config.js` obsługuje dwa tryby połączenia

Ten sam obraz kontenera musi działać lokalnie i w Cloud Run, mimo że sposób połączenia z bazą jest inny:

| Środowisko | Zmienne | Połączenie |
|---|---|---|
| lokalnie / Docker Compose | `DB_HOST`, `DB_PORT` | TCP na `127.0.0.1:3306` lub `db:3306` |
| Cloud Run | `DB_SOCKET` | Unix socket `/cloudsql/<connection_name>` |

Obecność `DB_SOCKET` wyłącza tryb TCP. Gdybyśmy mieli tylko jeden tryb, aplikacja działałaby w jednym środowisku i wysypywała się w drugim. Walidacja wymaganych zmiennych jest w `loadConfig`, więc zły start kończy się czytelnym błędem, a nie tajemniczym `undefined` przy pierwszym zapytaniu.

### `connectionLimit: 3`

`db-f1-micro` ma ograniczone limity połączeń. Przy maksymalnie 6 instancjach Cloud Run i 3 połączeniach na instancję dostajemy sufit 18 połączeń. To celowo nisko. Nie zwiększaj tej wartości bez sprawdzenia limitów bazy — przy większym ruchu lepiej zmienić tier bazy.

### `0.0.0.0` zamiast `127.0.0.1`

W kontenerze `127.0.0.1` oznacza „tylko wnętrze tego kontenera”. Docker i Cloud Run kierują ruch przez wirtualną sieć, więc proces musi nasłuchiwać na wszystkich interfejsach (`0.0.0.0`). Na laptopie działa to samo, tylko uwaga: port staje się widoczny w sieci lokalnej.

### Graceful shutdown

Cloud Run przy wdrożeniu nowej rewizji wysyła `SIGTERM` i daje krótki czas na dokończenie żądań. `server.js`:

1. przestaje przyjmować nowe połączenia (`server.close`),
2. zamyka pulę MySQL (`pool.end`),
3. kończy proces kodem 0.

Po 10 sekundach jest bezpiecznik, który wymusza wyjście. Bez tego proces mógłby wisieć do twardego ubicie przez platformę.

### Stateless i stan w bazie

Instancja Cloud Run nie jest trwała: może zostać uruchomiona ponownie, zastąpiona albo usunięta. Licznik nie może żyć w pamięci procesu, bo po restarcie wróciłby do zera. Dlatego każda wizyta to `INSERT` do MySQL, a frontend za każdym razem czyta aktualny stan z bazy.

### Frontend serwowany przez ten sam Express

`app.use(express.static(...))` serwuje `app/public`. Zalety:

- jeden port i jeden proces lokalnie,
- brak CORS,
- brak drugiego serwera i drugiego wdrożenia,
- ścieżki `/api/*` i `/` są w tej samej domenie, więc ciasteczka i nagłówki działają bez konfiguracji.

### Migracje jako pliki SQL

Schemat nie jest tworzony przez `CREATE TABLE` w kodzie Node. Leży w `db/migrations/`:

- MySQL w Compose wykonuje je przy pierwszym utworzeniu wolumenu,
- Ansible w Etapie 6 wykona dokładnie te same pliki na Cloud SQL,
- jeden zestaw plików = jedno źródło prawdy o schemacie.

Pliki są idempotentne (`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`), bo Ansible będzie je uruchamiał wielokrotnie.

## Uruchomienie

Wykonuj z katalogu `Infrastructure/liquid-streamer/Cloud-Run`.

### 1. Baza w Dockerze

```bash
docker compose up -d db
docker compose ps
```

Oczekiwane: kontener `cloudrun-lab-db` ma status `running`, a po chwili `healthy`. Pierwsze uruchomienie pobiera obraz MySQL i wykonuje migracje — może zająć 30–60 sekund. Jeśli `docker compose ps` pokazuje `starting`, odczekaj i sprawdź ponownie.

### 2. Aplikacja

```bash
cd app
npm install
cp .env.example .env
npm test
npm run dev
```

Oczekiwane: `npm test` kończy się `pass 7`, a `npm run dev` wypisuje:

```text
[server] nasłuchuję na 0.0.0.0:8080 (NODE_ENV=development, DB=tcp)
```

`npm run dev` używa `node --env-file=.env --watch src/server.js`: ładuje `.env` i restartuje proces po zmianie plików.

### 3. Sprawdzenie w drugim terminalu

```bash
curl -s localhost:8080/api/health | jq
curl -s -X POST localhost:8080/api/visits | jq
curl -s localhost:8080/api/visits | jq
curl -s localhost:8080/api/config | jq
```

Oczekiwane kształty odpowiedzi.

`/api/health`:

```json
{
  "status": "ok",
  "db": "ok",
  "instance": "<nazwa-hosta>",
  "revision": "local",
  "region": "local",
  "service": "cloudrun-lab-local",
  "uptimeSeconds": 12
}
```

`/api/visits` po pierwszym `POST`:

```json
{
  "total": 1,
  "recent": [{ "instance": "<nazwa-hosta>", "visitedAt": "..." }],
  "recorded": true,
  "instance": "<nazwa-hosta>",
  "revision": "local"
}
```

`/api/config`:

```json
{ "siteTitle": "Cloud Run Lab", "instance": "<nazwa-hosta>", "revision": "local" }
```

### 4. Przeglądarka

Otwórz `http://localhost:8080`. Powinieneś zobaczyć:

- tytuł „Cloud Run Lab” pobrany z bazy,
- licznik wizyt,
- identyfikator instancji, rewizję i region,
- listę ostatnich instancji,
- przycisk „Odwiedź ponownie”, który zwiększa licznik.

### 5. Dowód trwałości danych

Zatrzymaj `npm run dev` (`Ctrl+C`), uruchom ponownie `npm run dev`, odśwież stronę. Licznik **nie** wraca do zera, bo dane są w MySQL. To jest bezpośredni dowód, że aplikacja jest stateless, a stan trzyma baza.

## Typowe problemy

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| `port is already allocated` | na 3306 działa inny MySQL | zmień mapowanie w `compose.yaml` na `"3307:3306"` i ustaw `DB_PORT=3307` w `app/.env` |
| `connect ECONNREFUSED 127.0.0.1:3306` | baza jeszcze nie wstała | `docker compose logs db`, poczekaj na `ready for connections` |
| `Brak wymaganej zmiennej środowiskowej: DB_USER` | brak `.env` lub uruchomienie bez `--env-file` | `cp .env.example .env`, używaj `npm run dev` |
| zmiany w migracjach nie działają | init scripts wykonują się tylko przy pierwszym wolumenie | `docker compose down -v` (usuwa dane!), potem `up -d db` |
| `ER_NO_SUCH_TABLE` w `/api/config` | baza wstała, ale migracje się nie wykonały | `docker compose down -v` i ponownie `up -d db`; sprawdź logi |

## Definition of Done

- `npm test` — wszystkie testy zielone.
- `docker compose ps` — baza `healthy`.
- `http://localhost:8080` — strona się ładuje, tytuł pochodzi z bazy.
- `POST /api/visits` zwiększa licznik, a `GET /api/visits` pokazuje nowy stan.
- Restart aplikacji nie zeruje licznika.
- W repo nie ma `.env` ani innych sekretów (`git status` nie pokazuje `.env`).

## Pytania kontrolne

1. Dlaczego frontend jest serwowany przez ten sam Express, a nie przez osobny serwer statyczny?
2. Co znaczy, że aplikacja jest **stateless** i dlaczego licznik musi być w bazie?
3. Dlaczego proces nasłuchuje na `0.0.0.0`, a nie na `127.0.0.1`?
4. Po co jest graceful shutdown i co robi `server.close()` przed `pool.end()`?
5. Dlaczego testy używają fałszywej bazy zamiast prawdziwego MySQL?

## Następny etap

Po potwierdzeniu Definition of Done przejdziemy do **Etapu 2 — Docker lokalnie**: `Dockerfile` multi-stage, użytkownik non-root, `.dockerignore` i uruchomienie całego stacku (aplikacja + baza) jednym `docker compose up --build`.
