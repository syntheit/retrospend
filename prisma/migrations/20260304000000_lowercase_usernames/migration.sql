-- Resolve case-insensitive username collisions before lowercasing.
-- Appends a numeric suffix to duplicates (keeps the oldest account unsuffixed).
DO $$
DECLARE
  rec RECORD;
  suffix INT;
  candidate TEXT;
BEGIN
  FOR rec IN
    SELECT id, username, LOWER(username) AS lower_name,
           ROW_NUMBER() OVER (PARTITION BY LOWER(username) ORDER BY "createdAt" ASC) AS rn
    FROM "user"
    WHERE LOWER(username) != username
       OR LOWER(username) IN (
         SELECT LOWER(username) FROM "user" GROUP BY LOWER(username) HAVING COUNT(*) > 1
       )
  LOOP
    IF rec.rn = 1 THEN
      -- First (oldest) user gets the clean lowercase name
      UPDATE "user" SET username = rec.lower_name WHERE id = rec.id;
    ELSE
      -- Subsequent duplicates get a numeric suffix
      suffix := rec.rn - 1;
      candidate := rec.lower_name || suffix::TEXT;
      -- Keep incrementing suffix if the candidate already exists
      WHILE EXISTS (SELECT 1 FROM "user" WHERE username = candidate) LOOP
        suffix := suffix + 1;
        candidate := rec.lower_name || suffix::TEXT;
      END LOOP;
      UPDATE "user" SET username = candidate WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;

-- Normalize any remaining mixed-case usernames (no collision risk after above)
UPDATE "user" SET username = LOWER(username) WHERE username != LOWER(username);

-- Prevent future mixed-case usernames at the database level
ALTER TABLE "user" ADD CONSTRAINT user_username_lowercase CHECK (username = LOWER(username));
