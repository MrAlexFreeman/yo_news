-- Rework the rubricator for the 2026 editorial grid.
--
-- Data-only: the `Category` table is unchanged. What changes is which rows exist, which
-- rubric the retired ones' articles point at, and the slug of «Происшествия».
--
-- Order matters, and it is the order below:
--   1. the target rubrics are created first, so «Общество» exists before it is used as
--      the destination;
--   2. the retired rubrics' articles are reassigned to it;
--   3. only then are the retired rubrics dropped, so the `onDelete: SetNull` foreign key
--      never fires and no story is left with a NULL rubric — a story without a rubric is
--      dropped from every "by rubric" listing on the site;
--   4. «Происшествия» takes the slug the grid asks for, keeping its articles.

-- 1. The target rubrics. `INSERT OR IGNORE` because a running install already has
--    «Общество», «Экономика» and «Происшествия»: their name and slug are unique, and a
--    second row would abort the migration.
INSERT OR IGNORE INTO "Category" ("id", "name", "slug") VALUES
  ('cat_investigations', 'Расследования', 'investigations'),
  ('cat_lifestyle', 'Здоровье и стиль', 'lifestyle'),
  ('cat_home-garden', 'Дом и сад', 'home-garden'),
  ('cat_cinema', 'Кино и сцена', 'cinema'),
  ('cat_incidents', 'Происшествия', 'incidents'),
  ('cat_society', 'Общество', 'society'),
  ('cat_economy', 'Экономика', 'economy');

-- 2. Retired rubrics hand their articles to «Общество».
UPDATE "Article"
SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'society')
WHERE "categoryId" IN (
  SELECT "id" FROM "Category"
  WHERE "slug" IN ('politics', 'tech', 'science', 'sport', 'culture')
);

-- 3. Drop the retired rubrics.
DELETE FROM "Category"
WHERE "slug" IN ('politics', 'tech', 'science', 'sport', 'culture');

-- 4. Происшествия keeps its articles but takes the slug the grid asks for. On an install
--    that had no «Происшествия» before, step 1 already created it and this is a no-op;
--    the guard keeps a hypothetical install that had both from failing on the unique slug.
UPDATE "Category" SET "slug" = 'incidents'
WHERE "slug" = 'incident'
  AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'incidents');
