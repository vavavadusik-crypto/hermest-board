# Known Limitations

Hermest Board is a free, open-source release candidate. The following are current, honest limitations:

- **Auto-publish OAuth not implemented:** The board prepares a publish pack and action queue, but actual OAuth token exchange and social platform publishing are not implemented.
- **Durable storage / multi-tenant is partial:** The Postgres foundation and account-auth routes exist but are disabled by default, as the full SaaS core is a separate phase.
- **Billing / quotas not started:** Architecture for billing, metering, and quotas is planned but entirely unimplemented.
- **Semantic shorts are planned:** Current vertical rendering is aspect-ratio-only; meaning-based semantic scene remixing is not yet available.
- **Multilingual editions require follow-ups:** The deterministic translation works, but lacks RTL/CJK fonts, bulk all-languages generation, and manual translation editing.
- **Renders in `/tmp` are ephemeral:** Every completed render goes to a private directory under physical `/tmp`, meaning files are temporary and subject to system cleanup.
- **Free local render quality depends on hardware:** Rendering locally (including via the self-host image) relies strictly on your machine's underlying hardware capabilities.
