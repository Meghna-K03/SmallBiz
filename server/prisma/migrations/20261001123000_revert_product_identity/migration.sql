-- Rolls back 20261001120000_add_product_identity. The three columns were empty on every row, so no data is lost.
ALTER TABLE "Product" DROP COLUMN "brand";
ALTER TABLE "Product" DROP COLUMN "packSizeValue";
ALTER TABLE "Product" DROP COLUMN "packSizeUnit";
