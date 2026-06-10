-- app_user: user runtime của API — KHÔNG superuser, KHÔNG owner bảng,
-- để RLS có hiệu lực thật (superuser/BYPASSRLS bỏ qua mọi policy).
-- Migrations chạy bằng user postgres (owner) qua DATABASE_URL_MIGRATIONS.
CREATE ROLE app_user LOGIN PASSWORD 'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE pms TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Mặc định cho bảng tạo sau này bởi postgres (migrations):
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;
