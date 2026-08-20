import Brand from "../../src/modules/brands/brand.model.js";

import Product from "../../src/modules/products/product.model.js";

/*
|--------------------------------------------------------------------------
| Brand Fixture Sequence
|--------------------------------------------------------------------------
*/

let brandSequence = 0;

/*
|--------------------------------------------------------------------------
| Create Active Brand Fixture
|--------------------------------------------------------------------------
|
| Downstream Order/Payment tests are not testing the Brand API itself.
|
| Therefore creating the Brand directly through Mongoose keeps these
| already-large integration tests faster.
|--------------------------------------------------------------------------
*/

export const createActiveBrandFixture = async (overrides = {}) => {
  brandSequence += 1;

  const {
    name: suppliedName,

    slug: suppliedSlug,

    ...remainingOverrides
  } = overrides;

  const name = suppliedName ?? `Order Test Brand ${brandSequence}`;

  const slug = suppliedSlug ?? `order-test-brand-${brandSequence}`;

  return Brand.create({
    name,

    slug,

    status: "active",

    isFeatured: false,

    sortOrder: brandSequence,

    ...remainingOverrides,
  });
};

/*
|--------------------------------------------------------------------------
| Resolve Product Brand Request Value
|--------------------------------------------------------------------------
|
| TEMPORARY MIGRATION BRIDGE
|
| Current Product model:
|
| brand: String
|
| Future Product model:
|
| brand: ObjectId → Brand
|
| This helper allows downstream fixtures to survive both stages.
|--------------------------------------------------------------------------
*/

export const resolveProductBrandRequestValue = (brand) => {
  if (!brand) {
    throw new Error("Product fixture requires a Brand");
  }

  const brandPath = Product.schema.path("brand");

  /*
    |--------------------------------------------------------------------------
    | Future ObjectId Product Schema
    |--------------------------------------------------------------------------
    */

  if (brandPath?.instance === "ObjectId") {
    const brandId = brand._id ?? brand.id ?? brand;

    const normalizedBrandId = String(brandId);

    if (!/^[a-fA-F0-9]{24}$/.test(normalizedBrandId)) {
      throw new Error(
        "Product fixture Brand must contain a valid Brand ObjectId",
      );
    }

    return normalizedBrandId;
  }

  /*
    |--------------------------------------------------------------------------
    | Current String Product Schema
    |--------------------------------------------------------------------------
    */

  if (typeof brand === "string") {
    return brand;
  }

  if (typeof brand.name === "string" && brand.name.trim()) {
    return brand.name.trim();
  }

  throw new Error("Product fixture Brand must contain a Brand name");
};
