#!/usr/bin/env bash
# Собирает воспроизводимый релизный пакет из git-ревизии: исходники, SBOM,
# provenance и контрольные суммы. Ничего не публикует — только пишет в release/.
#
#   scripts/pack-release.sh <git-ref>
#
# Пакуется именно ревизия из git (git archive), а не рабочее дерево, поэтому
# в архив не попадают локальные артефакты, node_modules и незакоммиченные правки.
set -euo pipefail

REF="${1:?usage: scripts/pack-release.sh <git-ref>}"
REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git rev-parse --verify "${REF}^{commit}" >/dev/null

VERSION="$(node -p 'require("./package.json").version')"
RELEASE_ID="${REF#v}"
NAME="hermest-board-${RELEASE_ID}"
OUT_DIR="release/${NAME}"
COMMIT="$(git rev-parse "${REF}^{commit}")"
COMMIT_SHORT="$(git rev-parse --short "${REF}^{commit}")"
# Дата коммита, а не «сейчас»: пересборка того же тега даёт тот же provenance.
BUILT_ON="$(git show -s --format=%cs "${REF}^{commit}")"
ORIGIN_URL="$(git remote get-url origin)"
REPOSITORY="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^git@([^:]+):#\1/#; s#^https?://##; s#\.git$##')"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "packing ${NAME} from ${COMMIT_SHORT}"
git archive --format=tar.gz --prefix="${NAME}/" -o "${OUT_DIR}/${NAME}-src.tar.gz" "$REF"
git archive --format=zip    --prefix="${NAME}/" -o "${OUT_DIR}/${NAME}-src.zip"    "$REF"

echo "generating CycloneDX SBOM"
npx --yes @cyclonedx/cyclonedx-npm@6.0.0 \
  --output-format json \
  --output-file "${OUT_DIR}/${NAME}.sbom.json" \
  --omit dev >/dev/null

cat > "${OUT_DIR}/provenance.json" <<JSON
{
  "product": "Hermest Board",
  "version": "${VERSION}",
  "release": "${REF}",
  "gitCommit": "${COMMIT}",
  "gitCommitShort": "${COMMIT_SHORT}",
  "repository": "${REPOSITORY}",
  "builtOn": "${BUILT_ON}",
  "nodeVersion": "$(node --version)",
  "license": "AGPL-3.0-or-later",
  "sbom": "${NAME}.sbom.json",
  "sbomFormat": "CycloneDX",
  "sourceArchives": ["${NAME}-src.tar.gz", "${NAME}-src.zip"],
  "reproduce": "git clone https://${REPOSITORY} && git checkout ${REF} && scripts/pack-release.sh ${REF}"
}
JSON

# Копируем сопроводительные документы из ревизии, а не из рабочего дерева.
for doc in KNOWN_LIMITATIONS.md "docs/releases/${REF}.md"; do
  target="${OUT_DIR}/$(basename "$doc")"
  if git show "${REF}:${doc}" > "$target" 2>/dev/null; then
    echo "  + ${doc}"
  else
    rm -f "$target"
  fi
done

( cd "$OUT_DIR" && sha256sum -- * > SHA256SUMS.txt.tmp && mv SHA256SUMS.txt.tmp SHA256SUMS.txt )

echo
echo "release bundle → ${OUT_DIR}"
ls -lh "$OUT_DIR"
