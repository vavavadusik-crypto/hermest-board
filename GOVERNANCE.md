# Governance

This document describes how Hermest Board is governed and how decisions are made.

---

## Project Ownership

**Owner:** Vadim (vavavadusik@gmail.com)

The owner has final decision authority on:

- **License** (see [LICENSE_DECISION.md](LICENSE_DECISION.md) for current status — awaiting owner choice)
- **Project direction and roadmap**
- **Breaking changes and major architectural decisions**
- **Repository access, branch protection, and release process**
- **Trademark and branding** (the "Hermest Board" name)
- **Commercial strategy** (SaaS pricing, hosting, partnerships)

---

## Contribution Model

Hermest Board is an **open-source, community-driven project** with a **benevolent owner** model:

- **Anyone can contribute** (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Maintainers review and merge PRs** (see below for current maintainers).
- **The owner has final say** on contentious decisions, but aims for community consensus.

---

## Maintainers

**Current maintainers** (people who can merge PRs and make day-to-day decisions):

- **Vadim (vavavadusik@gmail.com)** — Owner and lead maintainer

As the project grows, additional maintainers may be added based on sustained, high-quality contributions.

**Maintainer responsibilities:**

- Review and merge pull requests (or request changes).
- Triage issues (label, prioritize, close duplicates or out-of-scope).
- Enforce the Code of Conduct.
- Release new versions and maintain the changelog.
- Respond to security reports (see [SECURITY.md](SECURITY.md)).

**Maintainer powers:**

- Write access to the repository.
- Can merge PRs (but should follow the review process, not merge their own non-trivial changes).
- Can create releases and tags.

---

## Decision-Making Process

### Day-to-Day Decisions

For **minor changes** (bug fixes, docs improvements, refactoring, small features):

1. **Contributor** opens a PR (see [CONTRIBUTING.md](CONTRIBUTING.md)).
2. **Maintainer** reviews the PR (checks code quality, tests, architecture fit).
3. **Merge** if approved (CI must pass).

**Consensus is preferred**, but maintainers have authority to merge if the change is clearly beneficial and doesn't break anything.

### Major Decisions

For **major changes** (breaking changes, new dependencies, architectural shifts, roadmap priorities):

1. **Proposal** is opened as an issue or RFC (Request for Comments) document in `docs/rfcs/`.
2. **Community discussion** (maintainers, contributors, users can weigh in).
3. **Owner makes final call** after reviewing feedback (typically within **14 days** of proposal, or faster for time-sensitive decisions).

**Examples of major decisions:**

- Changing the license.
- Adding a heavyweight dependency (e.g., a new database, framework migration).
- Breaking API changes (affecting existing users).
- Removing a major feature.

### Roadmap Priorities

The [Roadmap](ROADMAP.md) is maintained by the owner and reflects project goals. Community input is welcome:

- **Vote on feature requests** (👍 reactions on issues).
- **Contribute implementations** (PRs for roadmap items are prioritized).
- **Sponsor development** (contact owner for commercial priorities).

---

## Code Review

All code changes require **review before merge**:

- **Minor changes** (typos, one-line fixes) → one maintainer review.
- **Medium changes** (features, refactors) → one maintainer review + CI pass.
- **Major changes** (architecture, breaking) → owner review + CI pass.

**Maintainers should not merge their own non-trivial PRs** — get a second review from another maintainer or the owner.

---

## Releases

Releases are managed by maintainers (currently the owner):

1. **Merge all PRs** for the release into `main`.
2. **Run full CI** (`npm run check` + manual smoke tests if needed).
3. **Update CHANGELOG.md** (see [Keep a Changelog](https://keepachangelog.com/) format).
4. **Tag the release** (`git tag v0.x.0`) and push.
5. **Publish release notes** on GitHub Releases (link to CHANGELOG, highlight breaking changes).

**Versioning:** Hermest Board follows [Semantic Versioning (SemVer)](https://semver.org/):

- **Major** (v1.0.0 → v2.0.0): Breaking changes (incompatible API, removed features).
- **Minor** (v0.3.0 → v0.4.0): New features, backwards-compatible.
- **Patch** (v0.3.0 → v0.3.1): Bug fixes, no new features.

**Pre-1.0 caveat:** Before v1.0.0, minor versions may include breaking changes (common practice in early-stage projects). Breaking changes will be documented in CHANGELOG.

---

## Conflict Resolution

If a **disagreement arises** (between contributors, or contributor vs. maintainer):

1. **Discuss in the issue/PR** — most conflicts are resolved through respectful dialogue.
2. **Escalate to owner** if no consensus after reasonable discussion (tag @vavavadusik-crypto in the issue).
3. **Owner makes final call** (usually within **7 days**).

**Code of Conduct violations** are handled separately — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) enforcement process.

---

## Trademark and Branding

The **"Hermest Board"** name and logo (if any) are owned by the project owner. Contributors may:

- **Use the name** in documentation, blog posts, talks (with proper attribution).
- **NOT trademark the name** themselves or use it to imply endorsement of derivative works without permission.

**Forks and derivatives:**

- You may fork the code (subject to the project license, once chosen).
- **Do not use the "Hermest Board" name** for your fork's branding (rename to avoid confusion).
- Permitted: "MyFork (based on Hermest Board)" or "Fork of Hermest Board".

---

## Changing This Document

Changes to `GOVERNANCE.md` require **owner approval**. Proposals should be discussed in an issue first.

---

## Future Governance Evolution

As the project matures, the governance model may evolve:

- **Maintainer team expansion** (adding co-maintainers with merge rights).
- **Contributor ladder** (recognized contributors, emeritus maintainers).
- **Steering committee** (for large decisions, if the community grows significantly).
- **Foundation or fiscal host** (if the project needs legal/financial structure).

Any governance changes will be announced in a GitHub issue and require owner approval.

---

## Contact

- **Owner:** Vadim (vavavadusik@gmail.com)
- **Public discussion:** [GitHub Issues](https://github.com/vavavadusik-crypto/-8-/issues) and [Discussions](https://github.com/vavavadusik-crypto/-8-/discussions)

Thank you for being part of the Hermest Board community! 🎬
