// Testy fabryki Express z fałszywą bazą.
//
// Nie uruchamiamy MySQL ani Dockera: podmieniamy interfejs bazy, więc testy są
// szybkie i deterministyczne. Prawdziwe połączenie sprawdzimy ręcznie w Etapie 1
// oraz w chmurze w Etapie 5.

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";

const META = {
  instance: "test-instance",
  revision: "test-revision-1",
  region: "test-region",
  service: "test-service",
};

function createFakeDb({
  pingFails = false,
  total = 7,
  siteTitle = "Cloud Run Lab",
  configFails = false,
} = {}) {
  const calls = [];

  return {
    calls,

    async ping() {
      if (pingFails) {
        const err = new Error("Brak połączenia z bazą");
        err.code = "ECONNREFUSED";
        throw err;
      }
      return true;
    },

    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("FROM settings")) {
        if (configFails) {
          const err = new Error("Table 'appdb.settings' doesn't exist");
          err.code = "ER_NO_SUCH_TABLE";
          throw err;
        }
        return [[{ site_title: siteTitle }], []];
      }

      if (sql.startsWith("INSERT INTO visits")) {
        return [{ affectedRows: 1 }, []];
      }

      if (sql.includes("COUNT(*)")) {
        return [[{ total }], []];
      }

      if (sql.includes("GROUP BY")) {
        return [
          [
            { instance_id: "instance-a", visited_at: "2026-01-02T03:04:05.000Z" },
            { instance_id: "instance-b", visited_at: "2026-01-01T03:04:05.000Z" },
          ],
          [],
        ];
      }

      throw new Error(`Nieoczekiwane zapytanie w teście: ${sql}`);
    },
  };
}

async function withServer(db, fn) {
  const app = createApp(db, META);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/health zwraca 200 i metadane instancji, gdy baza odpowiada", async () => {
  const db = createFakeDb();

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.db, "ok");
    assert.equal(body.instance, META.instance);
    assert.equal(body.revision, META.revision);
    assert.equal(body.region, META.region);
  });
});

test("GET /api/health zwraca 503, gdy baza jest nieosiągalna", async () => {
  const db = createFakeDb({ pingFails: true });

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, "degraded");
    assert.equal(body.db, "error");
    assert.equal(body.code, "ECONNREFUSED");
  });
});

test("GET /api/visits zwraca total i ostatnie instancje bez zapisu", async () => {
  const db = createFakeDb({ total: 12 });

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/visits`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 12);
    assert.equal(body.recent.length, 2);
    assert.deepEqual(body.recent[0], {
      instance: "instance-a",
      visitedAt: "2026-01-02T03:04:05.000Z",
    });
    assert.equal(
      db.calls.some((call) => call.sql.startsWith("INSERT INTO visits")),
      false,
      "GET nie może zapisywać wizyty",
    );
  });
});

test("POST /api/visits zapisuje wizytę z identyfikatorem instancji", async () => {
  const db = createFakeDb({ total: 13 });

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/visits`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.recorded, true);
    assert.equal(body.total, 13);

    const insert = db.calls.find((call) => call.sql.startsWith("INSERT INTO visits"));
    assert.ok(insert, "oczekiwano zapytania INSERT");
    assert.deepEqual(insert.params, [META.instance]);
  });
});

test("GET /api/config zwraca tytuł strony z bazy", async () => {
  const db = createFakeDb({ siteTitle: "Mój tytuł" });

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.siteTitle, "Mój tytuł");
    assert.equal(body.instance, META.instance);
  });
});

test("GET /api/config zwraca 500 z kodem błędu, gdy brakuje tabeli", async () => {
  const db = createFakeDb({ configFails: true });

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, "INTERNAL_ERROR");
    assert.equal(body.code, "ER_NO_SUCH_TABLE");
  });
});

test("GET /api/info nie dotyka bazy", async () => {
  const db = createFakeDb();

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/info`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.instance, META.instance);
    assert.equal(body.revision, META.revision);
    assert.equal(db.calls.length, 0);
  });
});
