-- Seed początkowego tytułu strony.
--
-- ON DUPLICATE KEY UPDATE sprawia, że ponowne uruchomienie nie kończy się
-- błędem i nie tworzy drugiego wiersza. To ten sam mechanizm idempotencji,
-- którego użyjemy później w Ansible.

INSERT INTO settings (id, site_title)
VALUES (1, 'Cloud Run Lab')
ON DUPLICATE KEY UPDATE site_title = 'Cloud Run Lab';
