-- Release 0.5: the new UI, the API and the envelope budget are always on, so
-- the rollout flags (M13 ui_flags, M6 envelope_books) have nothing left to
-- gate. Nothing in the app reads these columns any more.
-- app_settings has no RLS and the grants stay as they are; dropping a column
-- needs no policy or GRANT change.

ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "uiV2Mode";
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "apiV1Mode";
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "envelopeBudgetMode";

DROP TYPE IF EXISTS "FeatureFlagMode";
