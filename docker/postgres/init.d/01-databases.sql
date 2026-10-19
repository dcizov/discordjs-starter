-- Runs on first init only. Safe to re-run by hand:
--   docker compose exec -T postgres psql -U postgres -f /docker-entrypoint-initdb.d/01-databases.sql
SELECT 'CREATE DATABASE bot_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bot_test')\gexec
