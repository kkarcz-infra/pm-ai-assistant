// Jedno miejsce, które czyta i waliduje konfigurację ze środowiska.
//
// Aplikacja obsługuje dwa tryby połączenia z bazą:
//   - DB_SOCKET  → Cloud Run (wbudowany Cloud SQL Auth Proxy montuje socket),
//   - DB_HOST + DB_PORT → lokalny MySQL lub kontener z Docker Compose.
//
// Dzięki temu ten sam obraz kontenera działa w obu środowiskach bez zmian w kodzie.
// Walidacja jest tutaj, a nie w db.js, żeby błąd konfiguracji pojawił się od razu
// przy starcie procesu, z czytelnym komunikatem po polsku.

const DEFAULT_PORT = 8080;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Brak wymaganej zmiennej środowiskowej: ${name}`);
  }
  return value.trim();
}

function readPort(env) {
  const raw = env.PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT musi być liczbą całkowitą z zakresu 1-65535, otrzymano: ${raw}`);
  }
  return port;
}

function readDb(env) {
  const db = {
    user: required(env, "DB_USER"),
    password: required(env, "DB_PASSWORD"),
    database: required(env, "DB_NAME"),
  };

  // Tryb Cloud Run ma pierwszeństwo: obecność DB_SOCKET oznacza, że nie używamy TCP.
  const socketPath = env.DB_SOCKET?.trim();
  if (socketPath) {
    return { ...db, mode: "socket", socketPath };
  }

  const host = (env.DB_HOST ?? "127.0.0.1").trim();
  const rawPort = env.DB_PORT ?? "3306";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DB_PORT musi być liczbą całkowitą z zakresu 1-65535, otrzymano: ${rawPort}`);
  }

  return { ...db, mode: "tcp", host, port };
}

export function loadConfig(env = process.env) {
  return {
    port: readPort(env),
    nodeEnv: env.NODE_ENV ?? "development",
    appRegion: env.APP_REGION ?? "local",
    db: readDb(env),
  };
}
