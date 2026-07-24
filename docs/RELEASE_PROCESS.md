# Release Process  

> **Scope** – Maintainers of **Hermest Board** only. All steps use the verified commands and requirements listed below. Anything not covered by the verified facts is marked **(verify)**.

---  

## 1. Pre‑release quality gate  

| Step | Command | Reason |
|------|---------|--------|
| Run the full project checks | `npm run check` | Ensures lint, type‑check, tests and the CI quality gate pass. |
| Verify Docker image builds (if self‑hosted) | `docker compose up --build` (or `docker compose up --build && docker compose down`) | Confirms the Dockerfile.selfhost produces a runnable image. |

> **Fail** if any command exits with a non‑zero status.

---  

## 2. Version bump  

1. **Pick the bump level** (`patch`, `minor`, or `major`).  
2. Run the npm version command, which also creates a commit and a tag:  

   ```bash
   npm version <level>   # e.g. npm version patch
   ```  

   *The new tag will be `v<new‑version>` and the `package.json` version is updated.*

---  

## 3. Update the changelog  

* Manually edit `CHANGELOG.md` (or the file used for the project) to add a section for the new version.  
* Summarise notable changes, new free voices, any premium integration updates, etc.  
* Commit the updated `CHANGELOG.md` if it was not included in the `npm version` commit:

   ```bash
   git add CHANGELOG.md
   git commit -m "chore: update changelog for v<new-version>"
   ```

---  

## 4. Create release artefacts  

| Artefact | Command (verify) | Description |
|----------|----------------|-------------|
| Source tarball | `git archive --format=tar.gz --prefix=hermest-board-<version>/ -o hermest-board-<version>.tar.gz HEAD` | Compressed source snapshot. |
| SHA‑256 checksum | `sha256sum hermest-board-<version>.tar.gz > hermest-board-<version>.tar.gz.sha256` | Integrity verification file. |
| SBOM (Software Bill of Materials) | `npx @cyclonedx/cyclonedx-npm --output-file hermest-board-<version>.sbom.json` | CycloneDX SBOM of the dependency tree. Generated during PHASE 11 release prep (not yet an npm script). |

Place all artefacts in a temporary `release/` directory for publishing.

---  

## 5. Tag verification & push  

1. Ensure the tag points to the correct commit:  

   ```bash
   git show v<new-version>
   ```  

2. Push the commit **and** the tag to the remote **only after owner approval**:  

   ```bash
   git push origin main
   git push origin v<new-version>
   ```  

3. Upload the artefacts (tarball, checksum, SBOM) to the preferred distribution location (GitHub Releases, internal artifact store, etc.) **(verify)**.

---  

## 6. Post‑release clean‑up  

* Re‑run the quality gate on the released code to confirm the published artefacts match the built image:  

  ```bash
  npm ci && npm run check
  docker compose up --build   # optional sanity check
  ```  

* Document any release‑specific notes in the repository wiki or an internal tracker.

---  

## 7. Rollback (if needed)  

```bash
git checkout <previous-tag-or-commit>
npm ci
npm run build          # rebuild Docker image if required
```  

Tag the rollback commit with a “rollback” suffix if you need to publish a corrected release.

---  

## 8. Licensing  

All releases are distributed under **AGPL‑3.0‑or‑later**. Ensure the license file (`LICENSE`) is included in every artefact.

---  

### Quick checklist  

- [ ] `npm run check` passes  
- [ ] Docker image builds (self‑host)  
- [ ] Version bumped & tag created (`npm version`)  
- [ ] `CHANGELOG.md` updated and committed  
- [ ] Source tarball, SHA‑256, SBOM generated  
- [ ] Owner approval obtained  
- [ ] Commit + tag pushed  
- [ ] Artefacts uploaded to release location  

---  

*End of process.*
