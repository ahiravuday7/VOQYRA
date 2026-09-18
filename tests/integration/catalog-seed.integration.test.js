import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import Category from "../../src/modules/categories/category.model.js";
import Brand from "../../src/modules/brands/brand.model.js";
import SizeGuide from "../../src/modules/size-guides/size-guide.model.js";
import Collection from "../../src/modules/collections/collection.model.js";

import { seedCategories } from "../../src/seeds/category.seed.js";
import { seedBrands } from "../../src/seeds/brand.seed.js";
import { seedSizeGuides } from "../../src/seeds/size-guide.seed.js";
import { seedCollections } from "../../src/seeds/collection.seed.js";

const targets = [
  {
    name: "Category",
    Model: Category,
    slug: "men-shirts",
    edit(doc) {
      // Simulate moving this category to the root.
      doc.parent = null;
      doc.ancestors = [];
    },
  },
  {
    name: "Brand",
    Model: Brand,
    slug: "aayu-and-aura",
    edit(doc) {
      doc.logo = {
        url: "https://example.com/custom-logo.webp",
        publicId: "brands/custom-logo",
        altText: "Custom logo",
      };
    },
  },
  {
    name: "SizeGuide",
    Model: SizeGuide,
    slug: "mens-shirt-size-guide",
    edit(doc) {
      doc.rows[0].measurements[0].value = "100-105";
      doc.fitNote = "Merchant fit instructions";
    },
  },
  {
    name: "Collection",
    Model: Collection,
    slug: "new-arrivals",
    edit(doc) {
      doc.banner = {
        url: "https://example.com/custom-banner.webp",
        publicId: "collections/custom-banner",
        altText: "Custom banner",
      };
    },
  },
];

const seedCatalog = async () => {
  const categories = await seedCategories();
  const brands = await seedBrands();
  const sizeGuides = await seedSizeGuides(categories);
  const collections = await seedCollections();

  return {
    categories,
    brands,
    sizeGuides,
    collections,
  };
};

const readCatalog = async () => {
  const entries = await Promise.all(
    targets.map(async ({ name, Model }) => [
      name,
      await Model.find({}).sort({ slug: 1 }).lean(),
    ]),
  );

  return Object.fromEntries(entries);
};

describe("Catalog seed preservation", () => {
  it("creates missing records with their category relationships", async () => {
    const maps = await seedCatalog();

    expect(Object.values(maps).map((map) => map.size)).toEqual([6, 3, 3, 4]);

    const stored = await readCatalog();

    expect(Object.values(stored).map((docs) => docs.length)).toEqual([
      6, 3, 3, 4,
    ]);

    const men = maps.categories.get("men");
    const shirts = maps.categories.get("men-shirts");

    expect(String(shirts.parent)).toBe(String(men._id));
    expect(shirts.ancestors.map(String)).toEqual([String(men._id)]);
    expect(shirts.level).toBe(1);

    expect(String(maps.sizeGuides.get("mens-shirt-size-guide").category)).toBe(
      String(shirts._id),
    );

    expect(
      maps.sizeGuides.get("generic-clothing-size-guide").category,
    ).toBeNull();
  });

  it("leaves all documents and timestamps unchanged on rerun", async () => {
    await seedCatalog();

    const before = await readCatalog();

    await seedCatalog();

    expect(await readCatalog()).toEqual(before);
  });

  it.each(targets)(
    "preserves edits and inactive status for $name",
    async ({ Model, slug, edit }) => {
      await seedCatalog();

      const doc = await Model.findOne({ slug });

      doc.name = "Merchant Edited Catalog Record";
      doc.description = "Merchant maintained description";
      doc.status = "inactive";
      doc.sortOrder = 77;
      doc.updatedBy = new mongoose.Types.ObjectId();

      edit(doc);

      await doc.save();

      const before = await readCatalog();

      await seedCatalog();

      expect(await readCatalog()).toEqual(before);
    },
  );

  it("does not restore soft-deleted seed records", async () => {
    await seedCatalog();

    for (const { Model, slug } of targets) {
      const doc = await Model.findOne({ slug });

      doc.status = "inactive";
      doc.deletedAt = new Date();
      doc.deletedBy = new mongoose.Types.ObjectId();

      await doc.save();
    }

    const before = await readCatalog();

    await seedCatalog();

    expect(await readCatalog()).toEqual(before);
  });

  it("preserves records outside the seed catalog", async () => {
    const unrelated = await Brand.create({
      name: "Merchant Brand",
      slug: "merchant-brand",
      status: "inactive",
    });

    const original = await Brand.findById(unrelated._id).lean();

    await seedCatalog();

    expect(await Brand.findById(unrelated._id).lean()).toEqual(original);

    const before = await readCatalog();

    await seedCatalog();

    expect(await readCatalog()).toEqual(before);
    expect(await Brand.countDocuments()).toBe(4);
  });

  it("reuses the same records during overlapping runs", async () => {
    const [first, second] = await Promise.all([seedCatalog(), seedCatalog()]);

    for (const key of Object.keys(first)) {
      expect(second[key].size).toBe(first[key].size);

      for (const [slug, doc] of first[key]) {
        expect(String(second[key].get(slug)._id)).toBe(String(doc._id));
      }
    }

    const stored = await readCatalog();

    expect(Object.values(stored).map((docs) => docs.length)).toEqual([
      6, 3, 3, 4,
    ]);
  });
});
