# Arknights Lore Database Snapshot

This folder contains the rebuilt lore database snapshot used by the Q&A agent.

## Current Primary Database

- PostgreSQL database: `arknights_lore_new`
- Snapshot file: `arknights_lore_new.current.dump`
- Format: `pg_dump -Fc`
- Q&A MCP server: `D:\web\backend\mcp-servers\lore-db-mcp\server.js`

The Q&A agent is configured to use `arknights_lore_new` as the primary lore database. Legacy schemas are not exposed to the agent tool list.

## Restore

Run from PowerShell:

```powershell
cd D:\web\database
.\restore-arknights-lore-new.ps1
```

By default the script connects to `127.0.0.1:5432` as `postgres` and restores into `arknights_lore_new`.

Environment overrides:

```powershell
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "5432"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "postgres"
$env:PGDATABASE = "arknights_lore_new"
.\restore-arknights-lore-new.ps1
```

The restore script drops and recreates the target database, so only run it when you intentionally want to replace the local copy with this snapshot.
