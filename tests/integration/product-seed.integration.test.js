import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import Product from "../../src/modules/products/product.model.js";

import { seedCategories } from "../../src/seeds/category.seed.js";
import { seedBrands } from "../../src/seeds/brand.seed.js";
import { seedSizeGuides } from "../../src/seeds/size-guide.seed.js";
import { seedCollections } from "../../src/seeds/collection.seed.js";
import { seedProducts } from "../../src/seeds/product.seed.js";

import { PRODUCT_STATUSES } from "../../src/shared/constants/product.constants.js";

const PRODUCT_SLUG = "aayu-aura-festive-silk-saree";

const seedDependencies = async () => {
  const categoriesBySlug = await seedCategories();
  const brandsBySlug = await seedBrands();
  const sizeGuidesBySlug = await seedSizeGuides(categoriesBySlug);
  const collectionsBySlug = await seedCollections();

  return {
    categoriesBySlug,
    brandsBySlug,
    sizeGuidesBySlug,
    collectionsBySlug,
  };
};

const readProducts = () => {
  return Product.find({}).sort({ slug: 1 }).lean();
};

describe("Product seed preservation", () => {
  it("creates the six missing Products with resolved references", async () => {
    const dependencies = await seedDependencies();

    const products = await seedProducts(dependencies);

    expect(products.size).toBe(6);
    expect(await Product.countDocuments()).toBe(6);

    const product = products.get(PRODUCT_SLUG);

    expect(String(product.category)).toBe(
      String(dependencies.categoriesBySlug.get("women-sarees")._id),
    );

    expect(String(product.brand)).toBe(
      String(dependencies.brandsBySlug.get("aayu-and-aura")._id),
    );

    expect(String(product.sizeGuide)).toBe(
      String(
        dependencies.sizeGuidesBySlug.get("generic-clothing-size-guide")._id,
      ),
    );

    expect(product.collections.map(String)).toEqual([
      String(dependencies.collectionsBySlug.get("new-arrivals")._id),
      String(dependencies.collectionsBySlug.get("festive-collection")._id),
    ]);

    for (const seededProduct of products.values()) {
      expect(seededProduct.status).toBe(PRODUCT_STATUSES.ACTIVE);
      expect(seededProduct.variants.length).toBeGreaterThan(0);

      for (const variant of seededProduct.variants) {
        expect(variant.inventory.reservedStock).toBe(0);
      }
    }
  });

  it("leaves every Product unchanged on a second run", async () => {
    const dependencies = await seedDependencies();

    await seedProducts(dependencies);

    const before = await readProducts();

    const repeated = await seedProducts(dependencies);

    expect(repeated.size).toBe(6);
    expect(await readProducts()).toEqual(before);
    expect(await Product.countDocuments()).toBe(6);
  });

  it("preserves catalog edits, inventory, images, and variant identity", async () => {
    const dependencies = await seedDependencies();

    await seedProducts(dependencies);

    const product = await Product.findOne({
      slug: PRODUCT_SLUG,
    });

    expect(product).not.toBeNull();

    product.name = "Merchant Edited Festive Saree";
    product.status = PRODUCT_STATUSES.INACTIVE;
    product.updatedBy = new mongoose.Types.ObjectId();

    const variant = product.variants[0];

    variant.inventory.stock = 7;
    variant.inventory.reservedStock = 2;
    variant.inventory.lowStockThreshold = 3;

    variant.pricing.sellingPrice = 2299;
    variant.pricing.discountPrice = 1799;

    product.images = [
      {
        url: "https://example.com/merchant-upload.webp",
        publicId: "products/merchant-upload",
        altText: "Merchant supplied image",
        sortOrder: 1,
        isPrimary: true,
      },
    ];

    // Runs document and nested subdocument validation.
    await product.save();

    const before = await readProducts();

    await seedProducts(dependencies);

    expect(await readProducts()).toEqual(before);
  });

  it("does not restore a soft-deleted Product", async () => {
    const dependencies = await seedDependencies();

    await seedProducts(dependencies);

    await Product.updateOne(
      { slug: PRODUCT_SLUG },
      {
        $set: {
          status: PRODUCT_STATUSES.ARCHIVED,
          deletedAt: new Date(),
          deletedBy: new mongoose.Types.ObjectId(),
        },
      },
      { runValidators: true },
    );

    const before = await Product.findOne({
      slug: PRODUCT_SLUG,
    }).lean();

    const repeated = await seedProducts(dependencies);

    expect(String(repeated.get(PRODUCT_SLUG)._id)).toBe(String(before._id));

    expect(await Product.findOne({ slug: PRODUCT_SLUG }).lean()).toEqual(
      before,
    );

    expect(await Product.countDocuments()).toBe(6);
  });

  it("does not silently rebuild empty variants or images", async () => {
    const dependencies = await seedDependencies();

    await seedProducts(dependencies);

    /*
     * Deliberately simulate damaged legacy data.
     * Native collection access bypasses model validation
     * only to construct this test fixture.
     */
    await Product.collection.updateOne(
      { slug: PRODUCT_SLUG },
      {
        $set: {
          status: PRODUCT_STATUSES.DRAFT,
          variants: [],
          images: [],
        },
      },
    );

    const before = await Product.findOne({
      slug: PRODUCT_SLUG,
    }).lean();

    await seedProducts(dependencies);

    expect(await Product.findOne({ slug: PRODUCT_SLUG }).lean()).toEqual(
      before,
    );
  });

  it("reuses the same Products when two seed runs overlap", async () => {
    const dependencies = await seedDependencies();

    const [firstRun, secondRun] = await Promise.all([
      seedProducts(dependencies),
      seedProducts(dependencies),
    ]);

    expect(firstRun.size).toBe(6);
    expect(secondRun.size).toBe(6);
    expect(await Product.countDocuments()).toBe(6);

    for (const [slug, product] of firstRun) {
      expect(String(secondRun.get(slug)._id)).toBe(String(product._id));

      expect(
        secondRun.get(slug).variants.map((variant) => String(variant._id)),
      ).toEqual(product.variants.map((variant) => String(variant._id)));
    }
  });
});

describe("Product cross-field validation after loading", () => {
  it.each([
    {
      name: "reserved stock increases above total stock",
      path: "variants.0.inventory.reservedStock",
      mutate(variant) {
        variant.inventory.reservedStock = 21;
      },
    },
    {
      name: "total stock decreases below reserved stock",
      path: "variants.0.inventory.reservedStock",
      mutate(variant) {
        variant.inventory.stock = 1;
      },
    },
    {
      name: "discount price increases above selling price",
      path: "variants.0.pricing.discountPrice",
      mutate(variant) {
        variant.pricing.discountPrice = 2500;
      },
    },
    {
      name: "selling price decreases below discount price",
      path: "variants.0.pricing.discountPrice",
      mutate(variant) {
        variant.pricing.sellingPrice = 1998;
      },
    },
  ])("rejects a save when $name", async ({ path, mutate }) => {
    const dependencies = await seedDependencies();

    await seedProducts(dependencies);

    const initialProduct = await Product.findOne({
      slug: PRODUCT_SLUG,
    });

    // Establish valid persisted inventory: stock 20, reserved 2.
    initialProduct.variants[0].inventory.reservedStock = 2;
    await initialProduct.save();

    const before = await Product.findOne({
      slug: PRODUCT_SLUG,
    }).lean();

    const product = await Product.findOne({
      slug: PRODUCT_SLUG,
    });

    mutate(product.variants[0]);

    await expect(product.save()).rejects.toMatchObject({
      name: "ValidationError",
      errors: {
        [path]: expect.objectContaining({
          name: "ValidatorError",
        }),
      },
    });

    expect(await Product.findOne({ slug: PRODUCT_SLUG }).lean()).toEqual(
      before,
    );
  });
});
