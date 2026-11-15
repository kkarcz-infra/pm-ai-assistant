// Frontend w czystym JavaScripcie: bez frameworka i bez kroku budowania.
//
// Każde żądanie idzie do tego samego Expressa, który serwuje tę stronę.
// Dzięki temu nie ma CORS i nie trzeba utrzymywać drugiego serwera.

const els = {
  title: document.querySelector("#title"),
  total: document.querySelector("#total"),
  instance: document.querySelector("#instance"),
  revision: document.querySelector("#revision"),
  region: document.querySelector("#region"),
  recent: document.querySelector("#recent"),
  visit: document.querySelector("#visit"),
  status: document.querySelector("#status"),
};

const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function setStatus(message, kind = "info") {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    ...options,
  });

  if (!response.ok) {
    let code = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      code = body.code ?? body.error ?? code;
    } catch {
      // Odpowiedź nie była JSON-em — zostaje sam kod HTTP.
    }
    throw new Error(code);
  }

  return response.json();
}

function renderVisits(data) {
  els.total.textContent = String(data.total);
  els.instance.textContent = data.instance;
  els.revision.textContent = data.revision;

  if (!data.recent.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Brak wizyt — kliknij przycisk powyżej.";
    els.recent.replaceChildren(empty);
    return;
  }

  const items = data.recent.map((item) => {
    const li = document.createElement("li");

    const instance = document.createElement("code");
    instance.textContent = item.instance;

    const time = document.createElement("span");
    time.textContent = formatDate(item.visitedAt);

    li.append(instance, time);
    return li;
  });

  els.recent.replaceChildren(...items);
}

async function loadInfo() {
  try {
    const info = await fetchJson("/api/info");
    els.instance.textContent = info.instance;
    els.revision.textContent = info.revision;
    els.region.textContent = info.region;
  } catch (err) {
    setStatus(`Nie udało się odczytać metadanych instancji: ${err.message}`, "error");
  }
}

async function loadTitle() {
  try {
    const config = await fetchJson("/api/config");
    els.title.textContent = config.siteTitle;
    document.title = `${config.siteTitle} · Cloud Run Lab`;
  } catch (err) {
    // Przed wykonaniem migracji tabela settings może nie istnieć.
    // Strona nadal ma działać, tylko bez tytułu z bazy.
    els.title.textContent = "Cloud Run Lab";
    setStatus(
      `Tytuł z bazy jest niedostępny (${err.message}). ` +
        "Jeśli to świeże wdrożenie, wykonaj migracje w Etapie 6.",
      "warn",
    );
  }
}

async function loadVisits() {
  try {
    renderVisits(await fetchJson("/api/visits"));
  } catch (err) {
    setStatus(`Nie udało się odczytać licznika: ${err.message}`, "error");
  }
}

els.visit.addEventListener("click", async () => {
  els.visit.disabled = true;
  try {
    const data = await fetchJson("/api/visits", { method: "POST" });
    renderVisits(data);
    setStatus("Wizyta zapisana w bazie.", "ok");
  } catch (err) {
    setStatus(`Nie udało się zapisać wizyty: ${err.message}`, "error");
  } finally {
    els.visit.disabled = false;
  }
});

await loadInfo();
await loadTitle();
await loadVisits();
