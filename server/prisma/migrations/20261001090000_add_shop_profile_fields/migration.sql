-- Additive only: four optional columns on Account for the editable shop profile.
-- NULL means "not edited yet" and the app falls back to the defaults. No data is changed.
ALTER TABLE "Account" ADD COLUMN "shopName" TEXT;
ALTER TABLE "Account" ADD COLUMN "shopDescription" TEXT;
ALTER TABLE "Account" ADD COLUMN "shopPhone" TEXT;
ALTER TABLE "Account" ADD COLUMN "shopLocation" TEXT;
