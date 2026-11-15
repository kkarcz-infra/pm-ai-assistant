// Fabryka aplikacji Express.
//
// `createApp(db)` przyjmuje interfejs bazy jako argument (dependency injection).
// Dzięki temu:
//   - testy podstawiają fałszywą bazę i nie potrzebują Dockera ani MySQL,
//   - server.js decyduje, jaką bazę zbudować (socket vs TCP),
//   - app.js nie zna szczegółów połączenia ani sekretów.
//
// Metadane instancji (HOSTNAME, K_REVISION, K_SERVICE) pochodzą ze środowiska
// Cloud Run. Lokalnie mają wartości "local", więc interfejs działa bez zmian.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const SQL = {
  insertVisit: "INSERT INTO visits (instance_id) VALUES (?)",
  countVisits: "SELECT COUNT(*) AS total FROM visits",
  recentInstances: `SELECT instance_id, MAX(visited_at) AS visited_at
                    FROM visits
                    GROUP BY instance_id
                    ORDER BY visited_at DESC
                    LIMIT 5`,
  siteTitle: "SELECT site_title FROM settings WHERE id = 1",
};

export function readRuntimeMeta(env = process.env) {
  return {
    instance: env.HOSTNAME ?? "local",
    revision: env.K_REVISION ?? "local",
    region: env.APP_REGION ?? "local",
    service: env.K_SERVICE ?? "cloudrun-lab-local",
    startedAt: Date.now(),
  };
}

// Express 4 nie przechwytuje odrzuconych obietnic z async handlerów.
// Ten wrapper kieruje błędy do wspólnego middleware'u, żeby każda trasa
// nie musiała mieć własnego try/catch.
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function mapRecent(rows) {
  return rows.map((row) => ({
    instance: row.instance_id,
    visitedAt: row.visited_at,
  }));
}

async function readVisits(db) {
  const [countRows] = await db.query(SQL.countVisits);
  const [recentRows] = await db.query(SQL.recentInstances);

  return {
    total: Number(countRows[0]?.total ?? 0),
    recent: mapRecent(recentRows),
  };
}

export function createApp(db, meta = readRuntimeMeta()) {
  const runtime = { startedAt: Date.now(), ...meta };
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  // Healthcheck sprawdza bazę, bo to ona jest najczęstszą przyczyną awarii.
  // Dzięki temu Cloud Run nie uzna nowej rewizji za zdrową, zanim baza odpowie.
  app.get(
    "/api/health",
    asyncRoute(async (req, res) => {
      try {
        await db.ping();
        res.json({
          status: "ok",
          db: "ok",
          instance: runtime.instance,
          revision: runtime.revision,
          region: runtime.region,
          service: runtime.service,
          uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1000),
        });
      } catch (err) {
        res.status(503).json({
          status: "degraded",
          db: "error",
          code: err.code ?? "DB_UNREACHABLE",
          instance: runtime.instance,
          revision: runtime.revision,
          region: runtime.region,
        });
      }
    }),
  );

  // GET tylko czyta licznik — używamy go przy wejściu na stronę.
  app.get(
    "/api/visits",
    asyncRoute(async (req, res) => {
      const { total, recent } = await readVisits(db);
      res.json({
        total,
        recent,
        instance: runtime.instance,
        revision: runtime.revision,
      });
    }),
  );

  // POST zapisuje wizytę i od razu zwraca nowy stan, żeby frontend nie musiał
  // wykonywać dwóch żądań.
  app.post(
    "/api/visits",
    asyncRoute(async (req, res) => {
      await db.query(SQL.insertVisit, [runtime.instance]);
      const { total, recent } = await readVisits(db);
      res.json({
        total,
        recent,
        recorded: true,
        instance: runtime.instance,
        revision: runtime.revision,
      });
    }),
  );

  // Tytuł strony pochodzi z bazy, więc zmiana w tabeli settings zmienia UI
  // bez przebudowy obrazu. To celowa demonstracja trwałego stanu.
  app.get(
    "/api/config",
    asyncRoute(async (req, res) => {
      const [rows] = await db.query(SQL.siteTitle);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "SETTINGS_NOT_FOUND" });
        return;
      }
      res.json({
        siteTitle: row.site_title,
        instance: runtime.instance,
        revision: runtime.revision,
      });
    }),
  );

  // Metadane bez bazy — przydatne do dowodu, że ruch trafia na różne instancje.
  app.get("/api/info", (req, res) => {
    res.json({
      instance: runtime.instance,
      revision: runtime.revision,
      region: runtime.region,
      service: runtime.service,
      node: process.version,
      uptimeSeconds: Math.round((Date.now() - runtime.startedAt) / 1000),
    });
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  // Frontend jest zwykłymi plikami statycznymi. Serwuje go ten sam Express,
  // więc lokalnie mamy jeden port i jeden proces do uruchomienia.
  app.use(express.static(publicDir));

  // Wspólny handler błędów. Nie ujawniamy treści błędu SQL, ale kod (np.
  // ER_NO_SUCH_TABLE) pomaga zdiagnozować brak migracji.
  app.use((err, req, res, next) => {
    console.error("[app] błąd żądania:", err.message);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({
      error: "INTERNAL_ERROR",
      code: err.code ?? "UNKNOWN",
    });
  });

  return app;
}
