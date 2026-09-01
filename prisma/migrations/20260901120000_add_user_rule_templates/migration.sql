-- User-saved rule templates: the template catalog becomes writable. Users can
-- save the whole clause set or a single clause, and delete any template.
--
-- `templateKind` separates whole-config templates (loading replaces the clause
-- set) from single-clause templates (inserting appends one clause).
--
-- `deletedAt` is a soft delete rather than a row removal because the built-in
-- seeder upserts the starter templates on every read; a hard-deleted built-in
-- would reappear on the next request.

-- 1. Template kind. Every existing row is a whole-config template.
ALTER TABLE "rule_template_records" ADD COLUMN "templateKind" TEXT NOT NULL DEFAULT 'config';

-- 2. Soft delete. Existing rows stay live (NULL).
ALTER TABLE "rule_template_records" ADD COLUMN "deletedAt" TIMESTAMP(3);
