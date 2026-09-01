# CORENET X knowledge corpus

The floating Ask Corey assistant uses a deployment-wide, versioned corpus built from the two snapshots in `docs/official-cx/`. Source files remain local. The extraction tool sends no data to OpenAI; the ingestion command sends normalized text chunks to the OpenAI Embeddings API and stores the resulting vectors in PostgreSQL with pgvector.

## Local setup

1. Configure `DATABASE_URL` and `OPENAI_API_KEY` from `.env.example`.
2. Start the Docker services. The supplied Compose stacks use the pgvector PostgreSQL 17 image.
3. Apply migrations with `pnpm db:deploy`.
4. Extract and verify the sources:

   ```bash
   pnpm knowledge:extract
   pnpm knowledge:verify
   ```

5. Embed and activate the corpus:

   ```bash
   pnpm knowledge:ingest
   ```

Use `pnpm knowledge:ingest -- --stage-only` to validate the database import without an OpenAI key. It deliberately leaves the revision inactive and unembedded.

Ingestion is resumable and idempotent. An unchanged active corpus makes no new embedding calls. A changed source or extractor version creates a new staged revision, which becomes active only after every chunk has a valid 1,536-dimensional embedding.

## Evidence policy

The corpus keeps requirements, IFC property guidance, industry mappings, accepted values, examples, and sample values as separate source roles. Every retrieval chunk is linked to one or more immutable evidence spans:

- PDF evidence records its page and bounding box. Selecting a citation opens the bundled PDF renderer on that page and highlights the source region.
- Workbook evidence records its sheet and row range, with the source cells presented as labelled fields in the evidence workspace.

Answers must cite retrieved source locators and must not promote an example or sample value into a mandatory constraint. External links found in the COP are counted but are not crawled. Chat history is kept only in the browser session; OpenAI response storage is disabled for assistant requests.
