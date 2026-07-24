```markdown
# Update & Rollback

## Update Hermest Board

### Bare-metal
1. Pull latest changes:
   ```bash
   git pull
   ```
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Rebuild:
   ```bash
   npm run build
   ```
4. Restart the server (e.g., `PORT=8080 npx vite preview --host 0.0.0.0`).

### Docker
1. Rebuild and restart:
   ```bash
   docker compose up --build
   ```

---

## Rollback Hermest Board

### Bare-metal
1. Check out a previous tag/commit:
   ```bash
   git checkout <tag/commit>
   ```
2. Reinstall dependencies:
   ```bash
   npm ci
   ```
3. Rebuild:
   ```bash
   npm run build
   ```
4. Restart the server.

### Docker
1. Rebuild with the previous tag/commit:
   ```bash
   git checkout <tag/commit>
   docker compose up --build
   ```

---

## Data Compatibility (verify)
- **Workspace (SQLite)**: Backward-compatible across minor updates. Major version bumps may require manual migration (verify).
- **LocalStorage (browser)**: Projects are JSON-based and remain compatible unless schema changes (verify).
- **Renders (/tmp)**: Ephemeral; no persistence guarantees.
- **Export/Import**: Always export projects before updating/rolling back as a precaution.

---

## Full Quality Check (Optional)
After update/rollback, run:
```bash
npm run check
```
```
