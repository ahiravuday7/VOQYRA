import SizeGuide from "../modules/size-guides/size-guide.model.js";

import {
  SIZE_GUIDE_STATUSES,
  SIZE_GUIDE_UNITS,
} from "../shared/constants/size-guide.constants.js";

/*
|--------------------------------------------------------------------------
| Size Guide Seed Data
|--------------------------------------------------------------------------
|
| categorySlug is seed-only metadata.
|
| null:
| → generic SizeGuide
|
| string:
| → resolve the real Category ObjectId from categoriesBySlug
|
*/

const SIZE_GUIDE_SEED_DATA = Object.freeze([
  {
    name: "Generic Clothing Size Guide",

    slug: "generic-clothing-size-guide",

    description:
      "General clothing size guide that can be used across multiple categories.",

    categorySlug: null,

    unit: SIZE_GUIDE_UNITS.CENTIMETER,

    columns: [
      {
        key: "chest",
        label: "Chest",
        sortOrder: 10,
      },
      {
        key: "waist",
        label: "Waist",
        sortOrder: 20,
      },
      {
        key: "hip",
        label: "Hip",
        sortOrder: 30,
      },
    ],

    rows: [
      {
        size: "S",

        measurements: [
          {
            key: "chest",
            value: "86-91",
          },
          {
            key: "waist",
            value: "71-76",
          },
          {
            key: "hip",
            value: "89-94",
          },
        ],

        sortOrder: 10,
      },

      {
        size: "M",

        measurements: [
          {
            key: "chest",
            value: "92-97",
          },
          {
            key: "waist",
            value: "77-82",
          },
          {
            key: "hip",
            value: "95-100",
          },
        ],

        sortOrder: 20,
      },

      {
        size: "L",

        measurements: [
          {
            key: "chest",
            value: "98-103",
          },
          {
            key: "waist",
            value: "83-88",
          },
          {
            key: "hip",
            value: "101-106",
          },
        ],

        sortOrder: 30,
      },
    ],

    howToMeasure:
      "Measure around the fullest part of the chest, natural waist and fullest part of the hips.",

    fitNote: "Use this as a general reference. Product-specific fit may vary.",

    sortOrder: 10,
  },

  {
    name: "Men's Shirt Size Guide",

    slug: "mens-shirt-size-guide",

    description: "Size guide for men's shirts.",

    categorySlug: "men-shirts",

    unit: SIZE_GUIDE_UNITS.CENTIMETER,

    columns: [
      {
        key: "chest",
        label: "Chest",
        sortOrder: 10,
      },
      {
        key: "shoulder",
        label: "Shoulder",
        sortOrder: 20,
      },
      {
        key: "length",
        label: "Length",
        sortOrder: 30,
      },
    ],

    rows: [
      {
        size: "S",

        measurements: [
          {
            key: "chest",
            value: "91-96",
          },
          {
            key: "shoulder",
            value: "42",
          },
          {
            key: "length",
            value: "68",
          },
        ],

        sortOrder: 10,
      },

      {
        size: "M",

        measurements: [
          {
            key: "chest",
            value: "97-102",
          },
          {
            key: "shoulder",
            value: "44",
          },
          {
            key: "length",
            value: "70",
          },
        ],

        sortOrder: 20,
      },

      {
        size: "L",

        measurements: [
          {
            key: "chest",
            value: "103-108",
          },
          {
            key: "shoulder",
            value: "46",
          },
          {
            key: "length",
            value: "72",
          },
        ],

        sortOrder: 30,
      },
    ],

    howToMeasure:
      "Measure the chest around the fullest part, shoulder from seam to seam and shirt length from shoulder to hem.",

    fitNote: "Choose the larger size when between two measurements.",

    sortOrder: 20,
  },

  {
    name: "Women's Kurti Size Guide",

    slug: "womens-kurti-size-guide",

    description: "Size guide for women's kurtis.",

    categorySlug: "women-kurtis",

    unit: SIZE_GUIDE_UNITS.CENTIMETER,

    columns: [
      {
        key: "bust",
        label: "Bust",
        sortOrder: 10,
      },
      {
        key: "waist",
        label: "Waist",
        sortOrder: 20,
      },
      {
        key: "hip",
        label: "Hip",
        sortOrder: 30,
      },
    ],

    rows: [
      {
        size: "S",

        measurements: [
          {
            key: "bust",
            value: "86-91",
          },
          {
            key: "waist",
            value: "71-76",
          },
          {
            key: "hip",
            value: "91-96",
          },
        ],

        sortOrder: 10,
      },

      {
        size: "M",

        measurements: [
          {
            key: "bust",
            value: "92-97",
          },
          {
            key: "waist",
            value: "77-82",
          },
          {
            key: "hip",
            value: "97-102",
          },
        ],

        sortOrder: 20,
      },

      {
        size: "L",

        measurements: [
          {
            key: "bust",
            value: "98-103",
          },
          {
            key: "waist",
            value: "83-88",
          },
          {
            key: "hip",
            value: "103-108",
          },
        ],

        sortOrder: 30,
      },
    ],

    howToMeasure:
      "Measure around the fullest part of the bust, natural waist and fullest part of the hips.",

    fitNote:
      "Measurements are body measurements and should be used as a sizing reference.",

    sortOrder: 30,
  },
]);

/*
|--------------------------------------------------------------------------
| Seed Size Guides
|--------------------------------------------------------------------------
*/

export const seedSizeGuides = async (categoriesBySlug) => {
  if (!(categoriesBySlug instanceof Map)) {
    throw new Error("seedSizeGuides requires categoriesBySlug Map.");
  }

  const sizeGuidesBySlug = new Map();

  for (const seedData of SIZE_GUIDE_SEED_DATA) {
    const {
      categorySlug,

      ...sizeGuideData
    } = seedData;

    /*
     * Generic guides use category:null.
     *
     * Category-specific guides resolve the actual
     * Category document seeded earlier.
     */
    const category = categorySlug ? categoriesBySlug.get(categorySlug) : null;

    if (categorySlug && !category) {
      throw new Error(
        `SizeGuide seed category "${categorySlug}" was not found for "${sizeGuideData.slug}".`,
      );
    }

    /*
     * Find by globally unique slug.
     *
     * We use document.save() so the SizeGuide model's
     * pre("validate") cross-field checks also execute.
     */
    let sizeGuide = await SizeGuide.findOne({
      slug: sizeGuideData.slug,
    });

    if (!sizeGuide) {
      sizeGuide = new SizeGuide({
        slug: sizeGuideData.slug,
      });
    }

    sizeGuide.set({
      ...sizeGuideData,

      category: category?._id ?? null,

      status: SIZE_GUIDE_STATUSES.ACTIVE,

      /*
       * Restore a seeded guide if it was
       * soft-deleted in development.
       */
      deletedAt: null,

      deletedBy: null,

      updatedBy: null,
    });

    /*
     * Keep seed-created audit ownership empty.
     */
    if (sizeGuide.isNew) {
      sizeGuide.createdBy = null;
    }

    await sizeGuide.save();

    sizeGuidesBySlug.set(
      sizeGuide.slug,

      sizeGuide,
    );
  }

  /*
   * Product seed can later use:
   *
   * sizeGuidesBySlug
   *   .get("womens-kurti-size-guide")
   *   ._id
   */
  return sizeGuidesBySlug;
};
