-- Additive only: three optional columns on Product so a shop product can be matched with a market price
-- file by brand and pack size. NULL = not entered; no existing row or value is changed.
ALTER TABLE "Product" ADD COLUMN "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN "packSizeValue" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "packSizeUnit" TEXT;
