# MassifyX Intelligence Service (MIS)

Decoupled microservice powering the MassifyX site's `/live` supply chain
disruption monitor. See the sibling `MassifyX_Global` repo's
`docs/internal/DESIGN.md` for the full technical design and
`docs/internal/BUILD_INSTRUCTIONS.md` for the staged build plan this repo
follows.

MIS ingests GDELT events, filters and enriches them with an AI pipeline
(relevance, classification, clustering, severity, summarisation), and exposes
a read-only, rate-limited JSON API. It never talks back to the site — the
site fetches from MIS server-side and degrades gracefully if MIS is down.

## Status

Stage 1: CI skeleton, no business logic yet.

## Setup

```
npm install
cp .env.example .env
npm test
```

## Datastore

Managed Postgres (e.g. Supabase or Neon). No local disk persistence — hosts
here may have an ephemeral filesystem.
