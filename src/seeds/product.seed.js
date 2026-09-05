import Product from "../modules/products/product.model.js";

import { PRODUCT_STATUSES } from "../shared/constants/product.constants.js";

/*
|--------------------------------------------------------------------------
| Seed Helpers
|--------------------------------------------------------------------------
*/

const getRequiredSeedDocument = (map, slug, dependencyName, productSlug) => {
  const document = map.get(slug);

  if (!document) {
    throw new Error(
      `Product seed "${productSlug}" requires ${dependencyName} "${slug}", but it was not seeded.`,
    );
  }

  return document;
};

const createVariant = ({
  sku,
  size,
  colorName,
  colorCode,
  buyingPrice,
  sellingPrice,
  discountPrice = null,
  stock = 20,
  weightInGrams = 300,
}) => {
  return {
    sku,

    size,

    color: {
      name: colorName,
      code: colorCode,
    },

    pricing: {
      buyingPrice,
      sellingPrice,
      discountPrice,
      currency: "INR",
    },

    inventory: {
      stock,
      reservedStock: 0,
      lowStockThreshold: 5,
    },

    shipping: {
      weightInGrams,

      dimensions: {
        lengthCm: 30,
        widthCm: 25,
        heightCm: 5,
      },
    },

    isActive: true,
  };
};

/*
|--------------------------------------------------------------------------
| Product Seed Data
|--------------------------------------------------------------------------
|
| categorySlug
| brandSlug
| sizeGuideSlug
| collectionSlugs
|
| are seed-only relationship values.
|
| They are converted into real MongoDB ObjectIds before Product.save().
|
*/

const PRODUCT_SEED_DATA = Object.freeze([
  {
    name: "Aayu & Aura Festive Silk Saree",

    slug: "aayu-aura-festive-silk-saree",

    shortDescription:
      "Elegant festive saree designed for celebrations and special occasions.",

    description:
      "A graceful festive saree from Aayu & Aura featuring an elegant traditional look suitable for weddings, festivals and special occasions.",

    categorySlug: "women-sarees",

    brandSlug: "aayu-and-aura",

    sizeGuideSlug: "generic-clothing-size-guide",

    collectionSlugs: ["new-arrivals", "festive-collection"],

    attributes: [
      {
        name: "Pattern",
        value: "Festive",
      },
      {
        name: "Occasion",
        value: "Traditional",
      },
    ],

    materials: ["Silk Blend"],

    careInstructions: ["Dry clean recommended", "Store in a dry place"],

    countryOfOrigin: "India",

    tags: ["saree", "festive", "women", "traditional"],

    images: [
      {
        url: "https://example.com/seed/aayu-aura-festive-silk-saree.jpg",

        altText: "Aayu & Aura Festive Silk Saree",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "AAA-SAREE-FESTIVE-MAROON",

        size: "Free Size",

        colorName: "Maroon",

        colorCode: "#800000",

        buyingPrice: 1200,

        sellingPrice: 2499,

        discountPrice: 1999,

        stock: 20,

        weightInGrams: 650,
      }),
    ],

    seo: {
      metaTitle: "Aayu & Aura Festive Silk Saree",

      metaDescription:
        "Elegant festive silk saree from Aayu & Aura for weddings and celebrations.",

      keywords: ["saree", "festive saree", "silk saree"],
    },

    isFeatured: true,

    isNewArrival: true,

    isBestSeller: false,
  },

  {
    name: "Aayu & Aura Everyday Cotton Kurti",

    slug: "aayu-aura-everyday-cotton-kurti",

    shortDescription: "Comfortable cotton kurti designed for everyday wear.",

    description:
      "A lightweight everyday cotton kurti from Aayu & Aura designed for comfort, simplicity and versatile daily styling.",

    categorySlug: "women-kurtis",

    brandSlug: "aayu-and-aura",

    sizeGuideSlug: "womens-kurti-size-guide",

    collectionSlugs: ["new-arrivals", "best-sellers"],

    attributes: [
      {
        name: "Fit",
        value: "Regular",
      },
      {
        name: "Sleeve",
        value: "Three Quarter",
      },
    ],

    materials: ["100% Cotton"],

    careInstructions: ["Machine wash cold", "Wash similar colours together"],

    countryOfOrigin: "India",

    tags: ["kurti", "cotton", "women", "everyday"],

    images: [
      {
        url: "https://example.com/seed/aayu-aura-everyday-cotton-kurti.jpg",

        altText: "Aayu & Aura Everyday Cotton Kurti",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "AAA-KURTI-COTTON-BLU-M",

        size: "M",

        colorName: "Blue",

        colorCode: "#0000FF",

        buyingPrice: 450,

        sellingPrice: 999,

        discountPrice: 849,

        stock: 30,
      }),

      createVariant({
        sku: "AAA-KURTI-COTTON-BLU-L",

        size: "L",

        colorName: "Blue",

        colorCode: "#0000FF",

        buyingPrice: 450,

        sellingPrice: 999,

        discountPrice: 849,

        stock: 25,
      }),
    ],

    seo: {
      metaTitle: "Aayu & Aura Everyday Cotton Kurti",

      metaDescription: "Comfortable everyday cotton kurti from Aayu & Aura.",

      keywords: ["cotton kurti", "women kurti", "everyday kurti"],
    },

    isFeatured: true,

    isNewArrival: true,

    isBestSeller: true,
  },

  {
    name: "Urban Thread Classic Oxford Shirt",

    slug: "urban-thread-classic-oxford-shirt",

    shortDescription: "Classic Oxford shirt for smart casual everyday styling.",

    description:
      "A versatile men's Oxford shirt by Urban Thread with a regular fit, comfortable construction and timeless styling.",

    categorySlug: "men-shirts",

    brandSlug: "urban-thread",

    sizeGuideSlug: "mens-shirt-size-guide",

    collectionSlugs: ["best-sellers"],

    attributes: [
      {
        name: "Fit",
        value: "Regular",
      },
      {
        name: "Sleeve",
        value: "Full Sleeve",
      },
    ],

    materials: ["Cotton"],

    careInstructions: ["Machine wash cold", "Iron on medium heat"],

    countryOfOrigin: "India",

    tags: ["shirt", "men", "oxford", "formal"],

    images: [
      {
        url: "https://example.com/seed/urban-thread-classic-oxford-shirt.jpg",

        altText: "Urban Thread Classic Oxford Shirt",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "UT-OXFORD-WHT-M",

        size: "M",

        colorName: "White",

        colorCode: "#FFFFFF",

        buyingPrice: 600,

        sellingPrice: 1399,

        discountPrice: 1199,

        stock: 35,
      }),

      createVariant({
        sku: "UT-OXFORD-WHT-L",

        size: "L",

        colorName: "White",

        colorCode: "#FFFFFF",

        buyingPrice: 600,

        sellingPrice: 1399,

        discountPrice: 1199,

        stock: 30,
      }),
    ],

    seo: {
      metaTitle: "Urban Thread Classic Oxford Shirt",

      metaDescription: "Classic men's Oxford shirt by Urban Thread.",

      keywords: ["oxford shirt", "men shirt", "white shirt"],
    },

    isFeatured: true,

    isNewArrival: false,

    isBestSeller: true,
  },

  {
    name: "Urban Thread Essential Cotton T-Shirt",

    slug: "urban-thread-essential-cotton-tshirt",

    shortDescription:
      "Soft everyday cotton T-shirt with a relaxed casual style.",

    description:
      "Urban Thread essential cotton T-shirt designed for comfortable everyday wear with simple, versatile styling.",

    categorySlug: "men-t-shirts",

    brandSlug: "urban-thread",

    sizeGuideSlug: "generic-clothing-size-guide",

    collectionSlugs: ["summer-collection", "best-sellers"],

    attributes: [
      {
        name: "Fit",
        value: "Regular",
      },
      {
        name: "Neck",
        value: "Round Neck",
      },
    ],

    materials: ["100% Cotton"],

    careInstructions: ["Machine wash cold", "Do not bleach"],

    countryOfOrigin: "India",

    tags: ["tshirt", "men", "cotton", "casual"],

    images: [
      {
        url: "https://example.com/seed/urban-thread-essential-cotton-tshirt.jpg",

        altText: "Urban Thread Essential Cotton T-Shirt",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "UT-TEE-BLK-M",

        size: "M",

        colorName: "Black",

        colorCode: "#000000",

        buyingPrice: 250,

        sellingPrice: 699,

        discountPrice: 599,

        stock: 50,

        weightInGrams: 220,
      }),

      createVariant({
        sku: "UT-TEE-BLK-L",

        size: "L",

        colorName: "Black",

        colorCode: "#000000",

        buyingPrice: 250,

        sellingPrice: 699,

        discountPrice: 599,

        stock: 45,

        weightInGrams: 230,
      }),
    ],

    seo: {
      metaTitle: "Urban Thread Essential Cotton T-Shirt",

      metaDescription: "Everyday men's cotton T-shirt by Urban Thread.",

      keywords: ["cotton tshirt", "men tshirt", "black tshirt"],
    },

    isFeatured: false,

    isNewArrival: false,

    isBestSeller: true,
  },

  {
    name: "Classic Wear Linen Blend Shirt",

    slug: "classic-wear-linen-blend-shirt",

    shortDescription:
      "Lightweight linen blend shirt for comfortable smart-casual wear.",

    description:
      "Classic Wear linen blend shirt designed for breathable comfort and timeless smart-casual styling.",

    categorySlug: "men-shirts",

    brandSlug: "classic-wear",

    sizeGuideSlug: "mens-shirt-size-guide",

    collectionSlugs: ["summer-collection", "new-arrivals"],

    attributes: [
      {
        name: "Fit",
        value: "Regular",
      },
      {
        name: "Sleeve",
        value: "Full Sleeve",
      },
    ],

    materials: ["Linen Blend"],

    careInstructions: ["Gentle machine wash", "Iron on low heat"],

    countryOfOrigin: "India",

    tags: ["linen", "shirt", "men", "summer"],

    images: [
      {
        url: "https://example.com/seed/classic-wear-linen-blend-shirt.jpg",

        altText: "Classic Wear Linen Blend Shirt",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "CW-LINEN-BEIGE-M",

        size: "M",

        colorName: "Beige",

        colorCode: "#F5F5DC",

        buyingPrice: 700,

        sellingPrice: 1599,

        discountPrice: 1399,

        stock: 25,
      }),

      createVariant({
        sku: "CW-LINEN-BEIGE-L",

        size: "L",

        colorName: "Beige",

        colorCode: "#F5F5DC",

        buyingPrice: 700,

        sellingPrice: 1599,

        discountPrice: 1399,

        stock: 20,
      }),
    ],

    seo: {
      metaTitle: "Classic Wear Linen Blend Shirt",

      metaDescription: "Breathable men's linen blend shirt by Classic Wear.",

      keywords: ["linen shirt", "men shirt", "summer shirt"],
    },

    isFeatured: false,

    isNewArrival: true,

    isBestSeller: false,
  },

  {
    name: "Classic Wear Printed Cotton Kurti",

    slug: "classic-wear-printed-cotton-kurti",

    shortDescription:
      "Printed cotton kurti for comfortable casual and everyday styling.",

    description:
      "Classic Wear printed cotton kurti combining comfortable fabric with versatile everyday styling.",

    categorySlug: "women-kurtis",

    brandSlug: "classic-wear",

    sizeGuideSlug: "womens-kurti-size-guide",

    collectionSlugs: ["summer-collection"],

    attributes: [
      {
        name: "Pattern",
        value: "Printed",
      },
      {
        name: "Fit",
        value: "Regular",
      },
    ],

    materials: ["100% Cotton"],

    careInstructions: ["Machine wash separately", "Do not bleach"],

    countryOfOrigin: "India",

    tags: ["kurti", "cotton", "printed", "women"],

    images: [
      {
        url: "https://example.com/seed/classic-wear-printed-cotton-kurti.jpg",

        altText: "Classic Wear Printed Cotton Kurti",

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      createVariant({
        sku: "CW-KURTI-PRINT-GRN-M",

        size: "M",

        colorName: "Green",

        colorCode: "#008000",

        buyingPrice: 400,

        sellingPrice: 899,

        discountPrice: 749,

        stock: 30,
      }),

      createVariant({
        sku: "CW-KURTI-PRINT-GRN-L",

        size: "L",

        colorName: "Green",

        colorCode: "#008000",

        buyingPrice: 400,

        sellingPrice: 899,

        discountPrice: 749,

        stock: 25,
      }),
    ],

    seo: {
      metaTitle: "Classic Wear Printed Cotton Kurti",

      metaDescription: "Comfortable printed cotton kurti by Classic Wear.",

      keywords: ["printed kurti", "cotton kurti", "women kurti"],
    },

    isFeatured: false,

    isNewArrival: false,

    isBestSeller: false,
  },
]);

/*
|--------------------------------------------------------------------------
| Seed Products
|--------------------------------------------------------------------------
*/

export const seedProducts = async ({
  categoriesBySlug,

  brandsBySlug,

  sizeGuidesBySlug,

  collectionsBySlug,
}) => {
  const requiredMaps = [
    ["categoriesBySlug", categoriesBySlug],

    ["brandsBySlug", brandsBySlug],

    ["sizeGuidesBySlug", sizeGuidesBySlug],

    ["collectionsBySlug", collectionsBySlug],
  ];

  for (const [name, map] of requiredMaps) {
    if (!(map instanceof Map)) {
      throw new Error(`seedProducts requires ${name} Map.`);
    }
  }

  const productsBySlug = new Map();

  for (const seedData of PRODUCT_SEED_DATA) {
    const {
      categorySlug,

      brandSlug,

      sizeGuideSlug,

      collectionSlugs,

      images,

      variants,

      ...productData
    } = seedData;

    /*
     * Resolve real master-data documents.
     */
    const category = getRequiredSeedDocument(
      categoriesBySlug,

      categorySlug,

      "Category",

      productData.slug,
    );

    const brand = getRequiredSeedDocument(
      brandsBySlug,

      brandSlug,

      "Brand",

      productData.slug,
    );

    const sizeGuide = sizeGuideSlug
      ? getRequiredSeedDocument(
          sizeGuidesBySlug,

          sizeGuideSlug,

          "SizeGuide",

          productData.slug,
        )
      : null;

    const collections = collectionSlugs.map((collectionSlug) => {
      return getRequiredSeedDocument(
        collectionsBySlug,

        collectionSlug,

        "Collection",

        productData.slug,
      );
    });

    /*
     * Slug is the stable Product seed identity.
     *
     * This query also finds soft-deleted Products,
     * allowing the development seed to restore them.
     */
    let product = await Product.findOne({
      slug: productData.slug,
    });

    const isNewProduct = !product;

    if (isNewProduct) {
      product = new Product({
        slug: productData.slug,

        /*
         * Variants are created only on initial seed.
         *
         * Later seed runs preserve their MongoDB _id values
         * and existing inventory.
         */
        variants,

        /*
         * Placeholder images are also only needed initially.
         *
         * Real uploaded images must survive later seed runs.
         */
        images,
      });
    }

    product.set({
      ...productData,

      category: category._id,

      brand: brand._id,

      sizeGuide: sizeGuide?._id ?? null,

      collections: collections.map((collection) => {
        return collection._id;
      }),

      status: PRODUCT_STATUSES.ACTIVE,

      deletedAt: null,

      deletedBy: null,

      updatedBy: null,
    });

    /*
     * Safety:
     *
     * If an existing seeded Product somehow has no
     * variants/images, restore the seed defaults.
     *
     * Otherwise preserve existing values.
     */
    if (!product.variants?.length) {
      product.variants = variants;
    }

    if (!product.images?.length) {
      product.images = images;
    }

    /*
     * Keep the original publication time when possible.
     */
    if (!product.publishedAt) {
      product.publishedAt = new Date();
    }

    if (product.isNew) {
      product.createdBy = null;
    }

    await product.save();

    productsBySlug.set(
      product.slug,

      product,
    );
  }

  return productsBySlug;
};
