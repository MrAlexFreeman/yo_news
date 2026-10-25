-- AlterTable
--
-- Написано вручную, как и соседние одиночные добавления (telegramPostId, maxPostId, vkPostId,
-- isUrgent): генератор `prisma migrate dev` на добавлении колонки в конец модели время от
-- времени предлагает перестроение таблицы (CREATE new_Article → DROP TABLE → RENAME), а это на
-- боевой базе пересоздание статей со всеми связями. Колонка необязательная, без значения по
-- умолчанию, поэтому SQLite добавляет её на месте, не трогая данные.
ALTER TABLE "Article" ADD COLUMN "vkVideoId" TEXT;
