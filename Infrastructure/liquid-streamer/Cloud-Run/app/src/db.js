// Pula połączeń MySQL.
//
// Cała wiedza o tym, czy łączymy się przez socket, czy przez TCP, jest w config.js.
// Tutaj tylko przekazujemy wybrany wariant do mysql2. Reszta aplikacji używa
// prostego interfejsu ping/query/execute/close, dzięki czemu testy mogą podstawić
// własną, fałszywą bazę bez uruchamiania MySQL.
//
// connectionLimit = 3 to świadomy sufit: maksymalnie 6 instancji Cloud Run × 3
// połączenia = 18 połączeń, co mieści się w limitach db-f1-micro.

import mysql from "mysql2/promise";

export function createDb(config) {
  const { db } = config;

  const pool = mysql.createPool({
    user: db.user,
    password: db.password,
    database: db.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
    timezone: "Z",
    ...(db.socketPath ? { socketPath: db.socketPath } : { host: db.host, port: db.port }),
  });

  return {
    async ping() {
      const [rows] = await pool.query("SELECT 1 AS ok");
      return rows[0]?.ok === 1;
    },

    query(sql, params = []) {
      return pool.query(sql, params);
    },

    execute(sql, params = []) {
      return pool.execute(sql, params);
    },

    close() {
      return pool.end();
    },
  };
}
