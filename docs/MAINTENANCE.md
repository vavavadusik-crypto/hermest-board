# Maintenance

## 1. Overview  
Hermest Board is an AGPL‑3.0‑or‑later web app that relies on:

* Node >= 20.11 < 23  
* `ffmpeg`/`ffprobe` (‑/usr/bin)  
* Chromium/Chrome (`HERMEST_CHROME_PATH`)  
* Piper TTS (`~/.local/opt/piper/piper` with voices in `~/.local/share/piper/voices`)  

All board data lives in the browser `localStorage`; SQLite state is under `.data/hermest-board`. Render artefacts are written to `/tmp` (ephemeral).

---

## 2. Updating npm dependencies  

| Step | Command | Note |
|------|---------|------|
| CI audit | `npm audit` (run in CI) | Fails the pipeline on vulnerable packages. |
| Local update | `npm ci` → `npm run build` | Re‑install exact lockfile versions, then rebuild assets. |
| Docker image | `docker compose up --build` | Rebuilds the self‑host image after a lockfile change. |

*Never* commit generated files or secrets; they are recreated at build time.

---

## 3. Running the quality gate  

```bash
npm run check   # full gate: lint, type‑check, tests, etc.
```

The gate must pass before merging any PR. It also runs in CI automatically.

---

## 4. Keeping documentation in sync  

1. **Source of truth** – All command‑line examples are taken directly from the repository (e.g., `npm run dev`, `docker compose up`).  
2. After any change to scripts, Dockerfiles, or environment variables, update the corresponding section in `README.md` and any other user‑facing docs.  
3. Run the quality gate (`npm run check`) to catch stale references.

---

## 5. Updating the Docker self‑host setup  

* The Dockerfile used is `Dockerfile.selfhost`.  
* After editing it, rebuild with:  

```bash
docker compose up --build
```

Verify that the service starts at `http://localhost:8080`.

---

## 6. Piper voice management  

* Free voices: `ru_RU`, `en_US`, `es_ES`, `de_DE`, `fr_FR`.  
* To add or update voices, run the provided script (`scripts/install-piper-ci.sh`).  
* If a language lacks a voice, the UI shows status **voice_missing**.

---

## 7. Rollback procedure  

```bash
git checkout <previous tag/commit>
npm ci
npm run build   # (or docker compose up --build for self‑host)
```

Make sure the previous commit’s lockfile matches the codebase.

---

## 8. Publishing note  

* The board creates a *publish‑pack* (JSON export) and updates platform status.  
* Direct auto‑publish via OAuth token exchange is not implemented (returns 501).  

No API keys are ever bundled or written to logs.

---

## 9. Thermal / heavy‑render consideration  

The render pipeline (media worker) is CPU‑intensive and is executed in the cloud CI environment.  
* Do **not** run large batch renders on a developer laptop; use the CI runner or a dedicated server.  
* Monitor `/tmp` usage; the directory is cleared after each render.

---

## 10. License  

Hermest Board is distributed under **AGPL‑3.0‑or‑later**. All contributions must be compatible with this license.

---  

*End of maintenance guide.*
