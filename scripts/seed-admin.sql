ALTER TABLE users ADD COLUMN google_id text;
ALTER TABLE users ADD COLUMN auth_provider text DEFAULT 'local';

INSERT INTO users (nama, username, email, password, nomorHp, alamat, role, auth_provider, created_at, updated_at)
VALUES (
  'Dev Admin',
  'devadmin',
  'devadmin@harumcare.local',
  '$2b$10$hKAWFvPof7CcOyq/2YAcvuhFzz.OsqOhKLmVKy2GOvpCg73mzEwrK',
  '081234567890',
  'Dev Environment',
  'admin',
  'local',
  strftime('%s','now'),
  strftime('%s','now')
);
