// Punkt wejścia procesu.
//
// Robi trzy rzeczy:
//   1. wczytuje i waliduje konfigurację (config.js),
//   2. buduje pulę połączeń (db.js),
//   3. uruchamia serwer HTTP i obsługuje graceful shutdown.
//
// Nasłuchujemy na 0.0.0.0, a nie na 127.0.0.1, ponieważ w kontenerze (Docker
// i Cloud Run) ruch przychodzi z zewnątrz przez wirtualną sieć. 127.0.0.1
// byłby widoczny tylko wewnątrz kontenera.
//
// Graceful shutdown jest ważny w Cloud Run: podczas wdrożenia nowej rewizji
// platforma wysyła SIGTERM i daje kilka sekund na dokończenie żądań.

import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createApp, readRuntimeMeta } from "./app.js";

const config = loadConfig();
const db = createDb(config);
const app = createApp(db, readRuntimeMeta());

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(
    `[server] nasłuchuję na 0.0.0.0:${config.port} ` +
      `(NODE_ENV=${config.nodeEnv}, DB=${config.db.mode})`,
  );
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: zamykanie serwera i puli połączeń...`);

  // Zabezpieczenie: jeśli otwarte połączenia nie zamkną się w 10 s,
  // kończymy proces twardo. Bez tego Cloud Run musiałby zabić kontener.
  const forceExit = setTimeout(() => {
    console.error("[server] przekroczono czas graceful shutdown, wymuszam wyjście");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await db.close();
      console.log("[server] zamknięto czysto");
    } catch (err) {
      console.error("[server] błąd podczas zamykania puli:", err.message);
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
