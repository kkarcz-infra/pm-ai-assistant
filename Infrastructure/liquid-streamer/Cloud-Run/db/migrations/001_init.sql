-- Schemat aplikacji Cloud Run Lab.
--
-- Wykonywany automatycznie przez oficjalny obraz MySQL przy PIERWSZYM
-- utworzeniu wolumenu (docker-entrypoint-initdb.d). Później te same pliki
-- stosuje Ansible w Etapie 6, dlatego są idempotentne.
--
-- Tabela visits trzyma pojedyncze wizyty. instance_id pozwala pokazać,
-- że ruch rozkłada się na wiele instancji Cloud Run.
CREATE TABLE IF NOT EXISTS visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instance_id VARCHAR(64) NOT NULL,
  visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visits_visited_at (visited_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Ustawienia aplikacji. Tabela jest singletonem: zawsze jeden wiersz o id = 1.
-- Dzięki temu tytuł strony można zmienić w bazie bez przebudowy obrazu.
CREATE TABLE IF NOT EXISTS settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  site_title VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
