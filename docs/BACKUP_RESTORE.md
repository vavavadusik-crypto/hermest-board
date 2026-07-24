# Backup & Restore

Hermest Board stores data in two places: project data in your browser, and workspace data in a local SQLite database. Renders are intentionally ephemeral and are not backed up.

## Project backup / restore (board data)
- In the board, export the project as JSON and save the file.
- To restore, import the JSON file back into the board.

## Workspace backup / restore (SQLite)
The workspace store lives at `.data/hermest-board`.
- Back up: copy the directory while the app is not running.
  ```bash
  cp -r .data/hermest-board hermest-board-backup-$(date +%F)
  ```
- Restore: stop the app, replace the directory, then rebuild and restart.
  ```bash
  mv .data/hermest-board .data/hermest-board.old
  cp -r hermest-board-backup-YYYY-MM-DD .data/hermest-board
  npm ci && npm run build
  ```
  For Docker: `docker compose up --build`.

## Renders
Renders are written to `/tmp` and are ephemeral. Re-render after restore if needed.

## Quick checklist
- [ ] Export each project as JSON from the board.
- [ ] Copy `.data/hermest-board` regularly.
- [ ] Do not rely on `/tmp` renders for long-term storage.
