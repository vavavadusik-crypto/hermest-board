# License Decision — Hermest Board

**Status:** ✅ DECIDED — AGPL-3.0-or-later (owner: Vadim, 2026-07-24)  
**Date:** 2026-07-24 (Gate M6)

> **Outcome:** The owner chose **AGPL-3.0-or-later**. The canonical license text is committed as `LICENSE`, `package.json` declares `"license": "AGPL-3.0-or-later"`, and the README documents the practical implications. The analysis below is retained as the rationale for the decision.

---

## Context

Hermest Board is being prepared for public open-source release. All bundled dependencies and assets are verified permissive (MIT, ISC, BSD-3-Clause, CC0), and no third-party proprietary media/models are committed to the repository (runtime-fetched assets with user-provided keys are outside redistribution scope). The project is legally ready for any OSI-approved license.

**No LICENSE file will be committed without owner decision.** This document presents the two recommended options.

---

## Recommended Option: AGPL-3.0-or-later (Network Copyleft)

**Full name:** GNU Affero General Public License v3.0 or later  
**SPDX:** `AGPL-3.0-or-later`  
**OSI-approved:** Yes  
**Text:** https://www.gnu.org/licenses/agpl-3.0.txt

### What It Means

- **Freedom to use:** Anyone can run Hermest Board for any purpose, including commercial use.
- **Freedom to modify and share:** Source code must remain open, including modifications.
- **Network copyleft (the key difference from MIT/Apache):** If someone **deploys** a modified version as a public service (e.g., hosted SaaS), they **must** make the modified source code available to users of that service — even if they never distribute the binary.
- **No proprietary reselling:** A competitor cannot take Hermest Board, add closed-source features, and sell it as a proprietary SaaS **without** open-sourcing their changes.
- **Patent grant:** Contributors grant a license to any patents they hold that cover the code.
- **Compatibility:** AGPL is GPL-compatible. It is **not** compatible with permissive-only stacks that forbid copyleft licenses (rare in the open-source AI/video space).

### Why AGPL Fits the "Free, Open, No Proprietary Reselling" Wedge

Hermest Board's **product wedge** is:

1. **Research-grounded content** with citations (vs. competitors' black-box prompts)
2. **BYOK economics** — user brings their own API keys, not paying per "minute" markup
3. **Transparent pipeline** with human approval and provenance/rights tracking
4. **Locally runnable** — privacy + truly free tier (vs. competitors' watermarked trials)

**AGPL protects this wedge:**

- Competitors (Fliki, Pictory, InVideo, etc.) who want to **fork and deploy** Hermest Board as a hosted service **must** open-source their improvements.
- The "free + BYOK + local + transparent" value proposition **cannot be locked behind closed doors** — any hosted fork must remain open.
- **Done-for-you services** (the first revenue stream) and **hosted SaaS with billing** (the second) are **permitted** under AGPL — the license does **not** forbid commercial use. It only requires **sharing improvements** when deployed as a network service.

### Trade-Offs

**Pros:**
- Prevents proprietary forks from closing off the value proposition (network copyleft enforces "improvements stay open")
- Strong alignment with "free, open, no proprietary walled garden" positioning
- Allows commercial hosting (done-for-you, SaaS billing) as long as source remains open
- Growing adoption in AI/OSS space (e.g., Plausible Analytics, Grafana AGPL components, many self-hosted tools)

**Cons:**
- Some enterprises avoid AGPL in their stacks (perceived as "viral" or "risky" for internal deployments) — though this is **rare** for external SaaS tools like Hermest Board
- Hosting providers that build proprietary layers on top **must** open-source those layers (this is **intentional** and the reason to choose AGPL)
- Not compatible with permissive-only license policies (MIT/Apache-only shops) — though contributors can dual-license or negotiate

**Recommended for:** Projects that want to **remain open** even when deployed as a service, preventing competitors from closing the source while building a business on top.

---

## Alternative Option: Apache-2.0 (Permissive)

**Full name:** Apache License 2.0  
**SPDX:** `Apache-2.0`  
**OSI-approved:** Yes  
**Text:** https://www.apache.org/licenses/LICENSE-2.0.txt

### What It Means

- **Freedom to use, modify, and redistribute:** Anyone can fork, modify, and redistribute under any license (including proprietary).
- **Patent grant:** Contributors grant a license to any patents they hold that cover the code.
- **No copyleft:** Modifications **do not** have to be open-sourced. A competitor can take Hermest Board, add closed-source features, and sell it as a proprietary SaaS **without** contributing back.
- **Trademark protection:** The Apache-2.0 license explicitly **does not** grant trademark rights — "Hermest Board" branding can remain protected.
- **Very permissive:** Widely adopted, corporate-friendly, no compatibility issues.

### Why Apache-2.0 Would Fit

- **Maximum adoption:** No legal friction for enterprises, agencies, or contributors.
- **Allows proprietary forks:** Someone could take the codebase, close it, and compete **without** contributing back — but the **original Hermest Board** remains the canonical open-source version.
- **Good for libraries and platforms** that want to be embedded in proprietary systems (Hermest Board is an **application**, not a library, so this is less relevant).

### Trade-Offs

**Pros:**
- Zero legal friction for adoption (corporate-friendly, no "viral" concerns)
- Encourages wide contributions (permissive = fewer barriers)
- Still includes patent grant (better than MIT in patent-heavy domains)

**Cons:**
- **No protection against proprietary forks:** A competitor can take Hermest Board, close the source, add proprietary features, and sell it as a SaaS **without** contributing back. The "free, open, transparent" wedge can be **walled off** by a well-funded fork.
- Requires **other mechanisms** (trademark, branding, velocity, network effects) to prevent commoditization.
- Less alignment with "keep the value proposition open" philosophy.

**Recommended for:** Projects that prioritize **adoption velocity** over preventing proprietary forks, or libraries/platforms meant to be embedded in proprietary systems.

---

## Comparison: AGPL vs. Apache for Hermest Board

| Dimension | AGPL-3.0-or-later | Apache-2.0 |
|-----------|-------------------|------------|
| **Competitors can fork and close the source?** | **No** (must open-source hosted service modifications) | **Yes** (can fork and sell proprietary) |
| **Protects "free, open, transparent" wedge?** | **Yes** (network copyleft keeps it open) | **No** (permissive allows proprietary forks) |
| **Allows commercial hosting (SaaS, done-for-you)?** | **Yes** (as long as source stays open) | **Yes** (and can be closed) |
| **Enterprise adoption friction?** | **Some** (AGPL-averse enterprises exist, but rare for external SaaS tools) | **None** (very corporate-friendly) |
| **Contributor friction?** | **Some** (copyleft may deter permissive-only contributors) | **Low** (widely accepted) |
| **Patent grant?** | **Yes** | **Yes** |
| **Trademark protection?** | **No** (separate policy needed) | **No** (separate policy needed) |
| **Best for...** | Keeping the product **open** even when deployed as a service | Maximizing **adoption** at the cost of allowing proprietary forks |

---

## Recommendation

**AGPL-3.0-or-later** is the **better fit** for Hermest Board's positioning:

1. The product wedge is **"free, open, BYOK, transparent, locally runnable"** — all of which are **antithetical to closed proprietary SaaS**.
2. AGPL **enforces this wedge**: any competitor who forks and deploys Hermest Board as a hosted service **must** keep their improvements open.
3. Commercial use (done-for-you services, paid SaaS tiers, usage packs) is **fully permitted** under AGPL — the license does **not** forbid making money.
4. The "network copyleft" clause is **exactly** what prevents a well-funded competitor from taking the codebase, closing it, and out-marketing the original.

**Apache-2.0** would allow faster adoption but **does not protect** the core value proposition from being walled off by a proprietary fork. If the goal is to **remain open and prevent proprietary enclosure**, AGPL is the right choice.

---

## Consequences of Each Choice

### If AGPL-3.0-or-later Is Chosen

- **Hosted competitors must open-source their improvements** (the intended effect).
- Some enterprises may avoid deploying Hermest Board internally (though this is **rare** for external SaaS tools).
- Contributors who prefer permissive licenses may choose not to contribute (though AGPL projects like Plausible, Grafana, and many self-hosted tools have thriving communities).
- The "free, open, no proprietary reselling" positioning is **legally enforced**, not just marketing.

### If Apache-2.0 Is Chosen

- **Any competitor can fork, close, and resell** without contributing back.
- Requires **other mechanisms** (branding, velocity, network effects) to prevent commoditization.
- Wider adoption pool (no legal friction), but the **core wedge is not protected by license**.

---

## Next Steps (Owner Decision Required)

1. **Owner (Vadim) chooses:** AGPL-3.0-or-later **or** Apache-2.0.
2. **I will then:**
   - Copy the chosen license text to `LICENSE` file.
   - Add `"license": "<SPDX-ID>"` to `package.json`.
   - Update community files to reference the license.
   - Commit all changes.

**No LICENSE file will be committed without this decision.**

---

## References

- AGPL-3.0 full text: https://www.gnu.org/licenses/agpl-3.0.txt
- Apache-2.0 full text: https://www.apache.org/licenses/LICENSE-2.0.txt
- AGPL FAQ (GNU): https://www.gnu.org/licenses/agpl-3.0-faq.html
- OSI License List: https://opensource.org/licenses
- SPDX License Identifiers: https://spdx.org/licenses/

---

**Prepared by:** Claude Fable 5 (Gate M6 DOCS/LEGAL lane)  
**Awaiting:** Owner license choice (AGPL-3.0-or-later recommended)
