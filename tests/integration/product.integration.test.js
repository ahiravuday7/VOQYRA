import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent as createBaseAuthenticatedAgent } from "../helpers/auth-test.helper.js";
import { USER_ROLES } from "../../src/shared/constants/user.constants.js";
import Category from "../../src/modules/categories/category.model.js";

import ProductInventoryLedger from "../../src/modules/products/product-inventory-ledger.model.js";
import Product from "../../src/modules/products/product.model.js";

import { PRODUCT_INVENTORY_OPERATIONS } from "../../src/shared/constants/product-inventory.constants.js";

import { createActiveBrandFixture } from "../helpers/product-brand-test.helper.js";

const adminCategoryUrl = "/api/v1/admin/categories";

const adminProductUrl = "/api/v1/admin/products";

const publicProductUrl = "/api/v1/products";

const adminBrandUrl = "/api/v1/admin/brands";

const adminSizeGuideUrl = "/api/v1/admin/size-guides";

const adminCollectionUrl = "/api/v1/admin/collections";

let defaultProductBrandId = null;

/*
|--------------------------------------------------------------------------
| Product Test Authentication Wrapper
|--------------------------------------------------------------------------
|
| Every admin test agent also receives a valid active Brand fixture.
|
| Existing Product tests can therefore continue using the shared
| createProductPayload() factory without creating a Brand manually.
|--------------------------------------------------------------------------
*/

const createAuthenticatedAgent = async (options = {}) => {
  const result = await createBaseAuthenticatedAgent(options);

  const resolvedRole = options.role ?? USER_ROLES.ADMIN;

  if (resolvedRole === USER_ROLES.ADMIN) {
    const brand = await createActiveBrandFixture();

    defaultProductBrandId = String(brand._id ?? brand.id);
  }

  return result;
};

/*
|--------------------------------------------------------------------------
| Admin Authentication Wrapper
|--------------------------------------------------------------------------
*/

const createAuthenticatedAdminAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });
};

/*
|--------------------------------------------------------------------------
| Category Test Helper
|--------------------------------------------------------------------------
*/

const createCategoryRequest = (agent, categoryData) => {
  return agent.post(adminCategoryUrl).send(categoryData);
};

/*
|--------------------------------------------------------------------------
| Product Test Helper
|--------------------------------------------------------------------------
*/

const createProductRequest = (agent, productData) => {
  return agent.post(adminProductUrl).send(productData);
};

/*
|--------------------------------------------------------------------------
| Product Dependency Fixture Sequence
|--------------------------------------------------------------------------
*/

let productDependencyFixtureSequence = 0;

/*
|--------------------------------------------------------------------------
| Active Product Category Fixture
|--------------------------------------------------------------------------
*/

const createProductDependencyCategory = async (adminAgent, overrides = {}) => {
  productDependencyFixtureSequence += 1;

  const suffix = productDependencyFixtureSequence;

  const response = await adminAgent
    .post(adminCategoryUrl)
    .send({
      name: `Product Dependency Category ${suffix}`,

      slug: `product-dependency-category-${suffix}`,

      status: "active",

      ...overrides,
    })
    .expect(201);

  return response.body.data.category;
};

/*
|--------------------------------------------------------------------------
| Brand Fixture
|--------------------------------------------------------------------------
*/

const createProductDependencyBrand = async (adminAgent, overrides = {}) => {
  productDependencyFixtureSequence += 1;

  const suffix = productDependencyFixtureSequence;

  const response = await adminAgent
    .post(adminBrandUrl)
    .send({
      name: `Product Brand ${suffix}`,

      slug: `product-brand-${suffix}`,

      description: "Brand used by Product dependency integration tests.",

      status: "active",

      isFeatured: false,

      sortOrder: suffix,

      ...overrides,
    })
    .expect(201);

  return response.body.data.brand;
};

/*
|--------------------------------------------------------------------------
| Size Guide Fixture
|--------------------------------------------------------------------------
*/

const createProductDependencySizeGuide = async (
  adminAgent,
  { category = null, ...overrides } = {},
) => {
  productDependencyFixtureSequence += 1;

  const suffix = productDependencyFixtureSequence;

  const response = await adminAgent
    .post(adminSizeGuideUrl)
    .send({
      name: `Product Size Guide ${suffix}`,

      slug: `product-size-guide-${suffix}`,

      category,

      unit: "cm",

      columns: [
        {
          key: "chest",

          label: "Chest",

          sortOrder: 1,
        },
      ],

      rows: [
        {
          size: "M",

          measurements: [
            {
              key: "chest",

              value: "100",
            },
          ],

          sortOrder: 1,
        },
      ],

      status: "active",

      sortOrder: suffix,

      ...overrides,
    })
    .expect(201);

  return response.body.data.sizeGuide;
};

/*
|--------------------------------------------------------------------------
| Collection Fixture
|--------------------------------------------------------------------------
*/

const createProductDependencyCollection = async (
  adminAgent,
  overrides = {},
) => {
  productDependencyFixtureSequence += 1;

  const suffix = productDependencyFixtureSequence;

  const response = await adminAgent
    .post(adminCollectionUrl)
    .send({
      name: `Product Collection ${suffix}`,

      slug: `product-collection-${suffix}`,

      description: "Collection used by Product dependency integration tests.",

      status: "active",

      isFeatured: false,

      sortOrder: suffix,

      ...overrides,
    })
    .expect(201);

  return response.body.data.collection;
};

/*
|--------------------------------------------------------------------------
| Product Dependency Request Factory
|--------------------------------------------------------------------------
*/

const createProductDependencyRequestBody = ({
  categoryId,

  brandId,

  sizeGuideId = null,

  collectionIds = [],

  status = "active",

  overrides = {},
}) => {
  productDependencyFixtureSequence += 1;

  const suffix = productDependencyFixtureSequence;

  const name = `Dependency Product ${suffix}`;

  const slug = `dependency-product-${suffix}`;

  return {
    name,

    slug,

    shortDescription: "Product dependency integration test.",

    description:
      "Product used to verify Brand, SizeGuide and Collection dependencies.",

    category: String(categoryId),

    brand: String(brandId),

    sizeGuide: sizeGuideId ? String(sizeGuideId) : null,

    collections: collectionIds.map((id) => String(id)),

    materials: ["100% Cotton"],

    careInstructions: ["Machine wash cold"],

    countryOfOrigin: "India",

    tags: ["dependency-test"],

    images: [
      {
        url: `https://example.com/${slug}.jpg`,

        altText: name,

        sortOrder: 1,

        isPrimary: true,
      },
    ],

    variants: [
      {
        sku: `DEPENDENCY-${suffix}-M`,

        size: "M",

        color: {
          name: "Black",

          code: "#000000",
        },

        pricing: {
          buyingPrice: 300,

          sellingPrice: 799,

          discountPrice: 699,

          currency: "INR",
        },

        inventory: {
          stock: 10,

          reservedStock: 0,

          lowStockThreshold: 3,
        },

        shipping: {
          weightInGrams: 250,
        },

        isActive: true,
      },
    ],

    status,

    ...overrides,
  };
};

/*
|--------------------------------------------------------------------------
| Product Inventory URL Helper
|--------------------------------------------------------------------------
*/

const createInventoryUrl = (productId, variantId, operation = null) => {
  const baseUrl =
    `${adminProductUrl}/${productId}` + `/variants/${variantId}/inventory`;

  return operation ? `${baseUrl}/${operation}` : baseUrl;
};

/*
|--------------------------------------------------------------------------
| Create Inventory Ledger Test Product
|--------------------------------------------------------------------------
*/

const createInventoryLedgerTestProduct = async ({
  agent,
  categoryId,
  name,
  slug,
  sku,
  stock = 10,
  reservedStock = 0,
  lowStockThreshold = 3,
}) => {
  const createResponse = await createProductRequest(
    agent,
    createProductPayload({
      name,
      slug,

      category: categoryId,

      status: "active",

      images: [
        {
          url: `https://example.com/${slug}.jpg`,

          altText: name,

          isPrimary: true,
        },
      ],

      variants: [
        {
          sku,

          size: "M",

          color: {
            name: "Black",
            code: "#000000",
          },

          pricing: {
            buyingPrice: 300,
            sellingPrice: 799,
            discountPrice: 699,
          },

          inventory: {
            stock,
            reservedStock,
            lowStockThreshold,
          },

          isActive: true,
        },
      ],
    }),
  ).expect(201);

  const product = createResponse.body.data.product;

  return {
    product,

    variant: product.variants[0],
  };
};

/*
|--------------------------------------------------------------------------
| Product Payload Factory
|--------------------------------------------------------------------------
*/

const createProductPayload = (overrides = {}) => {
  const resolvedBrand = overrides.brand ?? defaultProductBrandId;

  if (!resolvedBrand) {
    throw new Error("Product test fixture requires an active Brand");
  }

  return {
    name: "Classic Cotton T-Shirt",

    slug: "classic-cotton-tshirt",

    shortDescription: "Comfortable everyday cotton T-shirt.",

    description: "A regular-fit cotton T-shirt for everyday wear.",

    category: overrides.category,

    brand: resolvedBrand,

    materials: ["100% Cotton"],

    careInstructions: ["Machine wash cold", "Do not bleach"],

    countryOfOrigin: "India",

    tags: ["t-shirt", "cotton"],

    variants: [
      {
        sku: "TSHIRT-BLK-S",

        size: "S",

        color: {
          name: "Black",

          code: "#000000",
        },

        pricing: {
          buyingPrice: 300,

          sellingPrice: 699,

          discountPrice: 599,

          currency: "INR",
        },

        inventory: {
          stock: 20,

          reservedStock: 2,

          lowStockThreshold: 5,
        },

        shipping: {
          weightInGrams: 250,
        },

        isActive: true,
      },
    ],

    status: "draft",

    ...overrides,
  };
};

describe("Product integration", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("rejects unauthenticated admin Product creation", async () => {
    const response = await request(app)
      .post(adminProductUrl)
      .send({
        name: "Unauthenticated Product",
      })
      .expect(401);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");
  });

  /*
    |--------------------------------------------------------------------------
    | Draft Product Creation and Admin Details
    |--------------------------------------------------------------------------
    */

  it("creates a draft Product and retrieves its admin details", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
        |--------------------------------------------------------------------------
        | Create Active Category
        |--------------------------------------------------------------------------
        */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "T-Shirts",
      slug: "t-shirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Create Draft Product
        |--------------------------------------------------------------------------
        */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        category: category.id,
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    expect(createResponse.body.success).toBe(true);

    expect(product.name).toBe("Classic Cotton T-Shirt");

    expect(product.slug).toBe("classic-cotton-tshirt");

    expect(product.category).toBe(category.id);

    expect(product.status).toBe("draft");

    expect(product.publishedAt).toBeNull();

    expect(product.activeVariantCount).toBe(1);

    expect(product.totalStock).toBe(20);

    expect(product.reservedStock).toBe(2);

    expect(product.availableStock).toBe(18);

    expect(product.priceRange).toEqual({
      minimum: 599,
      maximum: 599,
      currency: "INR",
    });

    expect(product.createdBy).toBe(String(user._id));

    expect(product.updatedBy).toBe(String(user._id));

    /*
        |--------------------------------------------------------------------------
        | Retrieve Admin Details
        |--------------------------------------------------------------------------
        */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    const retrievedProduct = detailsResponse.body.data.product;

    expect(retrievedProduct.id).toBe(product.id);

    expect(retrievedProduct.slug).toBe("classic-cotton-tshirt");

    expect(retrievedProduct.variants).toHaveLength(1);

    expect(retrievedProduct.variants[0].sku).toBe("TSHIRT-BLK-S");

    expect(retrievedProduct.variants[0].pricing.buyingPrice).toBe(300);

    /*
        |--------------------------------------------------------------------------
        | Draft Product Must Be Hidden Publicly
        |--------------------------------------------------------------------------
        */

    const publicListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    expect(publicListResponse.body.data.products).toHaveLength(0);

    const publicDetailsResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(404);

    expect(publicDetailsResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Activate Product and Verify Public Visibility
    |--------------------------------------------------------------------------
    */

  it("shows an active Product publicly without exposing admin fields", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
        |--------------------------------------------------------------------------
        | Create Active Category
        |--------------------------------------------------------------------------
        */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Shirts",
      slug: "shirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
        |--------------------------------------------------------------------------
        | Create Draft Product
        |--------------------------------------------------------------------------
        */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Premium Cotton Shirt",

        slug: "premium-cotton-shirt",

        category: category.id,

        variants: [
          {
            sku: "SHIRT-BLU-M",

            barcode: "1234567890",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 1099,
              discountPrice: 899,
              currency: "INR",
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
        |--------------------------------------------------------------------------
        | Activate Product
        |--------------------------------------------------------------------------
        */

    const activationResponse = await agent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        status: "active",

        images: [
          {
            url: "https://example.com/premium-cotton-shirt.jpg",

            altText: "Premium blue cotton shirt",

            sortOrder: 1,

            isPrimary: true,
          },
        ],
      })
      .expect(200);

    const activeProduct = activationResponse.body.data.product;

    expect(activeProduct.status).toBe("active");

    expect(activeProduct.publishedAt).not.toBeNull();

    /*
        |--------------------------------------------------------------------------
        | Public Product List
        |--------------------------------------------------------------------------
        */

    const publicListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    const publicProducts = publicListResponse.body.data.products;

    expect(publicProducts).toHaveLength(1);

    const publicSummary = publicProducts[0];

    expect(publicSummary.id).toBe(product.id);

    expect(publicSummary.slug).toBe("premium-cotton-shirt");

    expect(publicSummary.category).toEqual({
      id: category.id,
      name: "Shirts",
      slug: "shirts",
    });

    expect(publicSummary.priceRange).toEqual({
      minimum: 899,
      maximum: 899,
      currency: "INR",
    });

    expect(publicSummary.availability).toEqual({
      availableStock: 8,
      isInStock: true,
      isLowStock: false,
    });

    /*
        |--------------------------------------------------------------------------
        | Public Product Details
        |--------------------------------------------------------------------------
        */

    const publicDetailsResponse = await request(app)
      .get(`${publicProductUrl}/premium-cotton-shirt`)
      .expect(200);

    const publicProduct = publicDetailsResponse.body.data.product;

    expect(publicProduct.id).toBe(product.id);

    expect(publicProduct.variants).toHaveLength(1);

    const publicVariant = publicProduct.variants[0];

    expect(publicVariant.sku).toBe("SHIRT-BLU-M");

    expect(publicVariant.pricing.sellingPrice).toBe(1099);

    expect(publicVariant.pricing.discountPrice).toBe(899);

    expect(publicVariant.pricing.effectivePrice).toBe(899);

    expect(publicVariant.availability.availableStock).toBe(8);

    /*
        |--------------------------------------------------------------------------
        | Sensitive Fields Must Not Be Public
        |--------------------------------------------------------------------------
        */

    expect(publicVariant.pricing).not.toHaveProperty("buyingPrice");

    expect(publicVariant).not.toHaveProperty("barcode");

    expect(publicVariant.availability).not.toHaveProperty("reservedStock");

    expect(publicProduct).not.toHaveProperty("status");

    expect(publicProduct).not.toHaveProperty("createdBy");

    expect(publicProduct).not.toHaveProperty("updatedBy");

    expect(publicProduct).not.toHaveProperty("deletedAt");

    expect(publicProduct).not.toHaveProperty("deletedBy");
  });

  /*
  |--------------------------------------------------------------------------
  | Customer Authorization
  |--------------------------------------------------------------------------
  */

  it("rejects customer access to admin Product APIs", async () => {
    const { agent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const response = await agent
      .post(adminProductUrl)
      .send({
        name: "Customer Product",
      })
      .expect(403);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");
  });

  /*
  |--------------------------------------------------------------------------
  | Protected Product Fields
  |--------------------------------------------------------------------------
  */

  it("rejects backend-controlled Product fields", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Jeans",
      slug: "jeans",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const response = await createProductRequest(agent, {
      ...createProductPayload({
        name: "Regular Fit Jeans",

        slug: "regular-fit-jeans",

        category: category.id,

        variants: [
          {
            sku: "JEANS-BLU-32",

            size: "32",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1499,
            },
          },
        ],
      }),

      createdBy: String(user._id),

      deletedAt: new Date().toISOString(),

      totalStock: 100,
    }).expect(400);

    expect(response.body.success).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Product Slug
  |--------------------------------------------------------------------------
  */

  it("rejects a duplicate Product slug", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Footwear",
      slug: "footwear",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    await createProductRequest(
      agent,
      createProductPayload({
        name: "Casual Sneakers",

        slug: "casual-sneakers",

        category: category.id,

        variants: [
          {
            sku: "SNEAKER-WHT-8",

            size: "8",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 900,
              sellingPrice: 1999,
            },
          },
        ],
      }),
    ).expect(201);

    /*
     * Use a different SKU so this request tests
     * only the duplicate slug rule.
     */
    const duplicateResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Different Sneakers",

        slug: "casual-sneakers",

        category: category.id,

        variants: [
          {
            sku: "SNEAKER-BLK-9",

            size: "9",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 950,
              sellingPrice: 2099,
            },
          },
        ],
      }),
    ).expect(409);

    expect(duplicateResponse.body.success).toBe(false);

    expect(duplicateResponse.body.errorCode).toBe(
      "PRODUCT_SLUG_ALREADY_EXISTS",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Variant SKU
  |--------------------------------------------------------------------------
  */

  it("rejects a variant SKU already used by another Product", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Accessories",
      slug: "accessories",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    await createProductRequest(
      agent,
      createProductPayload({
        name: "Leather Belt",

        slug: "leather-belt",

        category: category.id,

        variants: [
          {
            sku: "BELT-BRN-M",

            size: "M",

            color: {
              name: "Brown",
              code: "#964B00",
            },

            pricing: {
              buyingPrice: 250,
              sellingPrice: 699,
            },
          },
        ],
      }),
    ).expect(201);

    /*
     * Use a different Product slug but repeat
     * the existing Product SKU.
     */
    const duplicateResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Formal Leather Belt",

        slug: "formal-leather-belt",

        category: category.id,

        variants: [
          {
            sku: "BELT-BRN-M",

            size: "L",

            color: {
              name: "Dark Brown",
              code: "#654321",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },
          },
        ],
      }),
    ).expect(409);

    expect(duplicateResponse.body.success).toBe(false);

    expect(duplicateResponse.body.errorCode).toBe("PRODUCT_SKU_ALREADY_EXISTS");

    expect(duplicateResponse.body.details.conflictingSkus).toContain(
      "BELT-BRN-M",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Product Category
  |--------------------------------------------------------------------------
  */

  it("rejects Product creation when the category does not exist", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownCategoryId = "507f1f77bcf86cd799439011";

    const response = await createProductRequest(
      agent,
      createProductPayload({
        name: "Unknown Category Product",

        slug: "unknown-category-product",

        category: unknownCategoryId,

        variants: [
          {
            sku: "UNKNOWN-PRODUCT-S",

            size: "S",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 100,
              sellingPrice: 299,
            },
          },
        ],
      }),
    ).expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("PRODUCT_CATEGORY_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Active Product Requires an Image
  |--------------------------------------------------------------------------
  */

  it("rejects an active Product without an image", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Activewear",
      slug: "activewear",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const response = await createProductRequest(
      agent,
      createProductPayload({
        name: "Active Sports T-Shirt",

        slug: "active-sports-tshirt",

        category: category.id,

        status: "active",

        /*
         * Active Products require at least
         * one image.
         */
        images: [],

        variants: [
          {
            sku: "SPORT-TSHIRT-BLK-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 350,
              sellingPrice: 799,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("PRODUCT_IMAGE_REQUIRED");
  });

  /*
  |--------------------------------------------------------------------------
  | Active Product Requires an Active Variant
  |--------------------------------------------------------------------------
  */

  it("rejects an active Product without an active variant", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Formal Shirts",
      slug: "formal-shirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const response = await createProductRequest(
      agent,
      createProductPayload({
        name: "Formal White Shirt",

        slug: "formal-white-shirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/formal-white-shirt.jpg",

            altText: "Formal white shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "FORMAL-SHIRT-WHT-M",

            size: "M",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 600,
              sellingPrice: 1299,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: false,
          },
        ],
      }),
    ).expect(409);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("PRODUCT_ACTIVE_VARIANT_REQUIRED");
  });

  /*
  |--------------------------------------------------------------------------
  | Product Category Status
  |--------------------------------------------------------------------------
  */

  it("allows a draft Product under an inactive category but rejects an active Product", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Seasonal Collection",
      slug: "seasonal-collection",
      status: "inactive",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Draft Product Is Allowed
    |--------------------------------------------------------------------------
    */

    const draftResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Seasonal Draft Product",

        slug: "seasonal-draft-product",

        category: category.id,

        status: "draft",

        variants: [
          {
            sku: "SEASONAL-DRAFT-S",

            size: "S",

            color: {
              name: "Red",
              code: "#FF0000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },
          },
        ],
      }),
    ).expect(201);

    expect(draftResponse.body.data.product.status).toBe("draft");

    /*
    |--------------------------------------------------------------------------
    | Active Product Is Rejected
    |--------------------------------------------------------------------------
    */

    const activeResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Seasonal Active Product",

        slug: "seasonal-active-product",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/seasonal-product.jpg",

            altText: "Seasonal Product",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "SEASONAL-ACTIVE-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 350,
              sellingPrice: 799,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(409);

    expect(activeResponse.body.success).toBe(false);

    expect(activeResponse.body.errorCode).toBe("PRODUCT_CATEGORY_INACTIVE");
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Variants Inside One Product
  |--------------------------------------------------------------------------
  */

  it("rejects duplicate SKUs and duplicate size-colour combinations inside one Product", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Kurtas",
      slug: "kurtas",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Duplicate SKU
    |--------------------------------------------------------------------------
    */

    const duplicateSkuResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Cotton Kurta",

        slug: "cotton-kurta",

        category: category.id,

        variants: [
          {
            sku: "KURTA-BLU-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 1199,
            },
          },
          {
            /*
             * Same SKU as the first variant.
             */
            sku: "KURTA-BLU-M",

            size: "L",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 1199,
            },
          },
        ],
      }),
    ).expect(400);

    expect(duplicateSkuResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Duplicate Size and Colour Combination
    |--------------------------------------------------------------------------
    */

    const duplicateCombinationResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Premium Cotton Kurta",

        slug: "premium-cotton-kurta",

        category: category.id,

        variants: [
          {
            sku: "PREMIUM-KURTA-1",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 600,
              sellingPrice: 1399,
            },
          },
          {
            /*
             * Different SKU but the same
             * size and colour combination.
             */
            sku: "PREMIUM-KURTA-2",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 600,
              sellingPrice: 1399,
            },
          },
        ],
      }),
    ).expect(400);

    expect(duplicateCombinationResponse.body.success).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Pricing and Inventory Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid discount pricing and reserved inventory", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Dresses",
      slug: "dresses",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Discount Price Exceeds Selling Price
    |--------------------------------------------------------------------------
    */

    const invalidPriceResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Floral Dress",

        slug: "floral-dress",

        category: category.id,

        variants: [
          {
            sku: "DRESS-FLR-M",

            size: "M",

            color: {
              name: "Pink",
              code: "#FFC0CB",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1499,

              /*
               * Invalid because it exceeds
               * the selling price.
               */
              discountPrice: 1699,
            },
          },
        ],
      }),
    ).expect(400);

    expect(invalidPriceResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Reserved Stock Exceeds Total Stock
    |--------------------------------------------------------------------------
    */

    const invalidInventoryResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Evening Dress",

        slug: "evening-dress",

        category: category.id,

        variants: [
          {
            sku: "DRESS-EVE-L",

            size: "L",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 900,
              sellingPrice: 1999,
            },

            inventory: {
              stock: 5,

              /*
               * Invalid because reservedStock
               * cannot exceed stock.
               */
              reservedStock: 8,

              lowStockThreshold: 2,
            },
          },
        ],
      }),
    ).expect(400);

    expect(invalidInventoryResponse.body.success).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Category Ancestor Availability
  |--------------------------------------------------------------------------
  */

  it("rejects Product activation when a category ancestor is inactive", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Category Hierarchy
    |--------------------------------------------------------------------------
    |
    | Men
    | └── T-Shirts
    |--------------------------------------------------------------------------
    */

    const menResponse = await createCategoryRequest(agent, {
      name: "Men",
      slug: "men",
      status: "active",
    }).expect(201);

    const menCategory = menResponse.body.data.category;

    const tshirtResponse = await createCategoryRequest(agent, {
      name: "Men T-Shirts",
      slug: "men-tshirts",
      parent: menCategory.id,
      status: "active",
    }).expect(201);

    const tshirtCategory = tshirtResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Draft Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Men Cotton T-Shirt",

        slug: "men-cotton-tshirt",

        category: tshirtCategory.id,

        images: [
          {
            url: "https://example.com/men-cotton-tshirt.jpg",

            altText: "Men cotton T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "MEN-TSHIRT-BLK-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],

        status: "draft",
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Simulate an Unavailable Ancestor
    |--------------------------------------------------------------------------
    |
    | Direct database update is used because the Category
    | service may block deactivating a parent that still
    | has active descendants.
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: menCategory.id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Product Activation Must Fail
    |--------------------------------------------------------------------------
    */

    const activationResponse = await agent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        status: "active",
      })
      .expect(409);

    expect(activationResponse.body.success).toBe(false);

    expect(activationResponse.body.errorCode).toBe(
      "PRODUCT_CATEGORY_ANCESTOR_UNAVAILABLE",
    );

    /*
     * The failed update must leave the Product as draft.
     */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.status).toBe("draft");

    expect(detailsResponse.body.data.product.publishedAt).toBeNull();
  });

  /*
  |--------------------------------------------------------------------------
  | Product PATCH Field Preservation
  |--------------------------------------------------------------------------
  */

  it("updates only provided Product fields and preserves existing values", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Polo T-Shirts",
      slug: "polo-tshirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Classic Polo T-Shirt",

        slug: "classic-polo-tshirt",

        category: category.id,

        tags: ["polo", "cotton"],

        variants: [
          {
            sku: "POLO-NVY-M",

            size: "M",

            color: {
              name: "Navy",
              code: "#000080",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 899,
              discountPrice: 799,
            },

            inventory: {
              stock: 15,
              reservedStock: 3,
              lowStockThreshold: 4,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const originalProduct = createResponse.body.data.product;

    const updateResponse = await agent
      .patch(`${adminProductUrl}/${originalProduct.id}`)
      .send({
        name: "Premium Classic Polo T-Shirt",

        shortDescription: "Updated premium polo T-shirt.",

        isFeatured: true,
      })
      .expect(200);

    const updatedProduct = updateResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Updated Fields
    |--------------------------------------------------------------------------
    */

    expect(updatedProduct.name).toBe("Premium Classic Polo T-Shirt");

    expect(updatedProduct.shortDescription).toBe(
      "Updated premium polo T-shirt.",
    );

    expect(updatedProduct.isFeatured).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Preserved Fields
    |--------------------------------------------------------------------------
    */

    expect(updatedProduct.slug).toBe("classic-polo-tshirt");

    expect(updatedProduct.category).toBe(category.id);

    expect(updatedProduct.brand.id).toBe(originalProduct.brand.id);

    expect(updatedProduct.tags).toEqual(["polo", "cotton"]);

    expect(updatedProduct.variants).toHaveLength(1);

    expect(updatedProduct.variants[0].sku).toBe("POLO-NVY-M");

    expect(updatedProduct.variants[0].pricing.buyingPrice).toBe(400);

    expect(updatedProduct.totalStock).toBe(15);

    expect(updatedProduct.reservedStock).toBe(3);

    expect(updatedProduct.availableStock).toBe(12);
  });

  /*
  |--------------------------------------------------------------------------
  | Product Publication Date
  |--------------------------------------------------------------------------
  */

  it("manages publishedAt when Product status changes", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Casual Shirts",
      slug: "casual-shirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Publishable Draft Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Casual Linen Shirt",

        slug: "casual-linen-shirt",

        category: category.id,

        images: [
          {
            url: "https://example.com/casual-linen-shirt.jpg",

            altText: "Casual linen shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "LINEN-SHIRT-BGE-M",

            size: "M",

            color: {
              name: "Beige",
              code: "#F5F5DC",
            },

            pricing: {
              buyingPrice: 600,
              sellingPrice: 1399,
              discountPrice: 1199,
            },

            inventory: {
              stock: 12,
              reservedStock: 1,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],

        status: "draft",
      }),
    ).expect(201);

    const draftProduct = createResponse.body.data.product;

    expect(draftProduct.publishedAt).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Draft → Active
    |--------------------------------------------------------------------------
    */

    const activateResponse = await agent
      .patch(`${adminProductUrl}/${draftProduct.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    const firstPublishedAt = activateResponse.body.data.product.publishedAt;

    expect(activateResponse.body.data.product.status).toBe("active");

    expect(firstPublishedAt).not.toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Active → Active
    |--------------------------------------------------------------------------
    |
    | Updating another field must preserve the original
    | publication date.
    |--------------------------------------------------------------------------
    */

    const activeUpdateResponse = await agent
      .patch(`${adminProductUrl}/${draftProduct.id}`)
      .send({
        isBestSeller: true,
      })
      .expect(200);

    expect(activeUpdateResponse.body.data.product.status).toBe("active");

    expect(activeUpdateResponse.body.data.product.publishedAt).toBe(
      firstPublishedAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Active → Inactive
    |--------------------------------------------------------------------------
    */

    const deactivateResponse = await agent
      .patch(`${adminProductUrl}/${draftProduct.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    expect(deactivateResponse.body.data.product.status).toBe("inactive");

    expect(deactivateResponse.body.data.product.publishedAt).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Inactive → Active
    |--------------------------------------------------------------------------
    */

    const reactivateResponse = await agent
      .patch(`${adminProductUrl}/${draftProduct.id}`)
      .send({
        status: "active",
      })
      .expect(200);

    const secondPublishedAt = reactivateResponse.body.data.product.publishedAt;

    expect(reactivateResponse.body.data.product.status).toBe("active");

    expect(secondPublishedAt).not.toBeNull();

    expect(new Date(secondPublishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstPublishedAt).getTime(),
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Product Update Conflicts
  |--------------------------------------------------------------------------
  */

  it("rejects duplicate Product slug and SKU updates", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Wallets",
      slug: "wallets",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create First Product
    |--------------------------------------------------------------------------
    */

    const firstProductResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Brown Leather Wallet",

        slug: "brown-leather-wallet",

        category: category.id,

        variants: [
          {
            sku: "WALLET-BRN-STD",

            size: "Standard",

            color: {
              name: "Brown",
              code: "#964B00",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },
          },
        ],
      }),
    ).expect(201);

    const firstProduct = firstProductResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Create Second Product
    |--------------------------------------------------------------------------
    */

    const secondProductResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Black Leather Wallet",

        slug: "black-leather-wallet",

        category: category.id,

        variants: [
          {
            sku: "WALLET-BLK-STD",

            size: "Standard",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 350,
              sellingPrice: 899,
            },
          },
        ],
      }),
    ).expect(201);

    const secondProduct = secondProductResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Duplicate Slug Update
    |--------------------------------------------------------------------------
    */

    const duplicateSlugResponse = await agent
      .patch(`${adminProductUrl}/${secondProduct.id}`)
      .send({
        slug: firstProduct.slug,
      })
      .expect(409);

    expect(duplicateSlugResponse.body.success).toBe(false);

    expect(duplicateSlugResponse.body.errorCode).toBe(
      "PRODUCT_SLUG_ALREADY_EXISTS",
    );

    /*
    |--------------------------------------------------------------------------
    | Duplicate SKU Update
    |--------------------------------------------------------------------------
    */

    const duplicateSkuResponse = await agent
      .patch(`${adminProductUrl}/${secondProduct.id}`)
      .send({
        variants: [
          {
            sku: "WALLET-BRN-STD",

            size: "Large",

            color: {
              name: "Dark Brown",

              code: "#654321",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 999,
            },
          },
        ],
      })
      .expect(409);

    expect(duplicateSkuResponse.body.success).toBe(false);

    expect(duplicateSkuResponse.body.errorCode).toBe(
      "PRODUCT_SKU_ALREADY_EXISTS",
    );

    expect(duplicateSkuResponse.body.details.conflictingSkus).toContain(
      "WALLET-BRN-STD",
    );

    /*
    |--------------------------------------------------------------------------
    | Failed Updates Must Not Modify Second Product
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${secondProduct.id}`)
      .expect(200);

    const unchangedProduct = detailsResponse.body.data.product;

    expect(unchangedProduct.slug).toBe("black-leather-wallet");

    expect(unchangedProduct.variants[0].sku).toBe("WALLET-BLK-STD");
  });

  /*
  |--------------------------------------------------------------------------
  | Product Soft Delete and Restore
  |--------------------------------------------------------------------------
  */

  it("soft deletes and restores an active Product safely", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Jackets",
      slug: "jackets",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Classic Denim Jacket",

        slug: "classic-denim-jacket",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/classic-denim-jacket.jpg",

            altText: "Classic denim jacket",

            sortOrder: 1,

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "JACKET-DENIM-BLU-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 900,
              sellingPrice: 2199,
              discountPrice: 1899,
              currency: "INR",
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    expect(product.status).toBe("active");

    expect(product.publishedAt).not.toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Product Is Initially Public
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | First Delete
    |--------------------------------------------------------------------------
    */

    const firstDeleteResponse = await agent
      .delete(`${adminProductUrl}/${product.id}`)
      .expect(200);

    const deletedProduct = firstDeleteResponse.body.data.product;

    expect(deletedProduct.isDeleted).toBe(true);

    expect(deletedProduct.deletedAt).not.toBeNull();

    expect(deletedProduct.deletedBy).toBe(String(user._id));

    expect(deletedProduct.updatedBy).toBe(String(user._id));

    /*
     * Product publication information is preserved.
     */
    expect(deletedProduct.status).toBe("active");

    expect(deletedProduct.publishedAt).toBe(product.publishedAt);

    const originalDeletedAt = deletedProduct.deletedAt;

    const originalDeletedBy = deletedProduct.deletedBy;

    /*
    |--------------------------------------------------------------------------
    | Deleted Product Is Hidden Publicly
    |--------------------------------------------------------------------------
    */

    const publicDetailsResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(404);

    expect(publicDetailsResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Default Admin List Excludes Deleted Product
    |--------------------------------------------------------------------------
    */

    const defaultListResponse = await agent.get(adminProductUrl).expect(200);

    expect(defaultListResponse.body.data.products).toHaveLength(0);

    /*
    |--------------------------------------------------------------------------
    | Deleted-Only Admin List Includes Product
    |--------------------------------------------------------------------------
    */

    const deletedListResponse = await agent
      .get(`${adminProductUrl}?deleted=only`)
      .expect(200);

    expect(deletedListResponse.body.data.products).toHaveLength(1);

    expect(deletedListResponse.body.data.products[0].id).toBe(product.id);

    expect(deletedListResponse.body.data.products[0].isDeleted).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Admin Details Can Retrieve Deleted Product
    |--------------------------------------------------------------------------
    */

    const deletedDetailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(deletedDetailsResponse.body.data.product.isDeleted).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Normal Update Is Blocked
    |--------------------------------------------------------------------------
    */

    const updateResponse = await agent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        name: "Updated Deleted Jacket",
      })
      .expect(404);

    expect(updateResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Repeated Delete Is Idempotent
    |--------------------------------------------------------------------------
    */

    const secondDeleteResponse = await agent
      .delete(`${adminProductUrl}/${product.id}`)
      .expect(200);

    const repeatedlyDeletedProduct = secondDeleteResponse.body.data.product;

    expect(repeatedlyDeletedProduct.deletedAt).toBe(originalDeletedAt);

    expect(repeatedlyDeletedProduct.deletedBy).toBe(originalDeletedBy);

    /*
    |--------------------------------------------------------------------------
    | Restore Product
    |--------------------------------------------------------------------------
    */

    const restoreResponse = await agent
      .patch(`${adminProductUrl}/${product.id}/restore`)
      .expect(200);

    const restoredProduct = restoreResponse.body.data.product;

    expect(restoredProduct.isDeleted).toBe(false);

    expect(restoredProduct.deletedAt).toBeNull();

    expect(restoredProduct.deletedBy).toBeNull();

    expect(restoredProduct.updatedBy).toBe(String(user._id));

    expect(restoredProduct.status).toBe("active");

    expect(restoredProduct.publishedAt).toBe(product.publishedAt);

    const restoredUpdatedAt = restoredProduct.updatedAt;

    /*
    |--------------------------------------------------------------------------
    | Repeated Restore Is Idempotent
    |--------------------------------------------------------------------------
    */

    const secondRestoreResponse = await agent
      .patch(`${adminProductUrl}/${product.id}/restore`)
      .expect(200);

    expect(secondRestoreResponse.body.data.product.isDeleted).toBe(false);

    expect(secondRestoreResponse.body.data.product.updatedAt).toBe(
      restoredUpdatedAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Restored Active Product Is Public Again
    |--------------------------------------------------------------------------
    */

    const restoredPublicResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(200);

    expect(restoredPublicResponse.body.data.product.id).toBe(product.id);

    /*
    |--------------------------------------------------------------------------
    | Default Admin List Includes Restored Product
    |--------------------------------------------------------------------------
    */

    const restoredListResponse = await agent.get(adminProductUrl).expect(200);

    expect(restoredListResponse.body.data.products).toHaveLength(1);

    expect(restoredListResponse.body.data.products[0].id).toBe(product.id);
  });

  /*
  |--------------------------------------------------------------------------
  | Restore Category Validation
  |--------------------------------------------------------------------------
  */

  it("rejects restoring an active Product when its category becomes inactive", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Sweatshirts",
      slug: "sweatshirts",
      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Premium Hooded Sweatshirt",

        slug: "premium-hooded-sweatshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/premium-hooded-sweatshirt.jpg",

            altText: "Premium hooded sweatshirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "SWEATSHIRT-GRY-L",

            size: "L",

            color: {
              name: "Grey",
              code: "#808080",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1599,
              discountPrice: 1399,
            },

            inventory: {
              stock: 8,
              reservedStock: 1,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Delete Product
    |--------------------------------------------------------------------------
    */

    await agent.delete(`${adminProductUrl}/${product.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Make Category Unavailable
    |--------------------------------------------------------------------------
    |
    | Direct update simulates the category changing
    | while the Product remains deleted.
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: category.id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Restore Must Fail
    |--------------------------------------------------------------------------
    */

    const restoreResponse = await agent
      .patch(`${adminProductUrl}/${product.id}/restore`)
      .expect(409);

    expect(restoreResponse.body.success).toBe(false);

    expect(restoreResponse.body.errorCode).toBe("PRODUCT_CATEGORY_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Product Must Remain Deleted
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.isDeleted).toBe(true);

    expect(detailsResponse.body.data.product.deletedAt).not.toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Product Must Remain Hidden Publicly
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(404);
  });

  /*
  |--------------------------------------------------------------------------
  | Admin Product Pagination, Search and Sorting
  |--------------------------------------------------------------------------
  */

  it("supports admin Product pagination, search, and sorting", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Admin List Shirts",

      slug: "admin-list-shirts",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Three Products
    |--------------------------------------------------------------------------
    */

    const products = [
      {
        name: "Gamma Denim Shirt",

        slug: "gamma-denim-shirt",

        sku: "GAMMA-DENIM-M",
      },
      {
        name: "Alpha Linen Shirt",

        slug: "alpha-linen-shirt",

        sku: "ALPHA-LINEN-M",
      },
      {
        name: "Beta Cotton Shirt",

        slug: "beta-cotton-shirt",

        sku: "BETA-COTTON-M",
      },
    ];

    for (const productData of products) {
      await createProductRequest(
        agent,
        createProductPayload({
          name: productData.name,

          slug: productData.slug,

          category: category.id,

          variants: [
            {
              sku: productData.sku,

              size: "M",

              color: {
                name: "Black",
                code: "#000000",
              },

              pricing: {
                buyingPrice: 400,
                sellingPrice: 899,
              },

              inventory: {
                stock: 10,
                reservedStock: 0,
                lowStockThreshold: 3,
              },
            },
          ],
        }),
      ).expect(201);
    }

    /*
    |--------------------------------------------------------------------------
    | First Page Sorted by Name
    |--------------------------------------------------------------------------
    */

    const firstPageResponse = await agent
      .get(`${adminProductUrl}?page=1&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      firstPageResponse.body.data.products.map((product) => product.name),
    ).toEqual(["Alpha Linen Shirt", "Beta Cotton Shirt"]);

    expect(firstPageResponse.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    /*
    |--------------------------------------------------------------------------
    | Second Page
    |--------------------------------------------------------------------------
    */

    const secondPageResponse = await agent
      .get(`${adminProductUrl}?page=2&limit=2&sortBy=name&sortDirection=asc`)
      .expect(200);

    expect(
      secondPageResponse.body.data.products.map((product) => product.name),
    ).toEqual(["Gamma Denim Shirt"]);

    expect(secondPageResponse.body.data.pagination).toEqual({
      page: 2,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });

    /*
    |--------------------------------------------------------------------------
    | Search by Product Name
    |--------------------------------------------------------------------------
    */

    const nameSearchResponse = await agent
      .get(`${adminProductUrl}?search=denim`)
      .expect(200);

    expect(nameSearchResponse.body.data.products).toHaveLength(1);

    expect(nameSearchResponse.body.data.products[0].slug).toBe(
      "gamma-denim-shirt",
    );

    /*
    |--------------------------------------------------------------------------
    | Search by Variant SKU
    |--------------------------------------------------------------------------
    */

    const skuSearchResponse = await agent
      .get(`${adminProductUrl}?search=BETA-COTTON-M`)
      .expect(200);

    expect(skuSearchResponse.body.data.products).toHaveLength(1);

    expect(skuSearchResponse.body.data.products[0].slug).toBe(
      "beta-cotton-shirt",
    );
  });
  /*
  |--------------------------------------------------------------------------
  | Admin Product Category, Status and Flag Filters
  |--------------------------------------------------------------------------
  */

  it("filters admin Products by category, status, and Product flags", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Categories
    |--------------------------------------------------------------------------
    */

    const shirtsResponse = await createCategoryRequest(agent, {
      name: "Filter Shirts",

      slug: "filter-shirts",

      status: "active",
    }).expect(201);

    const trousersResponse = await createCategoryRequest(agent, {
      name: "Filter Trousers",

      slug: "filter-trousers",

      status: "active",
    }).expect(201);

    const shirtsCategory = shirtsResponse.body.data.category;

    const trousersCategory = trousersResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Featured and New-Arrival Draft Product
    |--------------------------------------------------------------------------
    */

    const shirtResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Featured Cotton Shirt",

        slug: "featured-cotton-shirt",

        category: shirtsCategory.id,

        status: "draft",

        isFeatured: true,
        isNewArrival: true,
        isBestSeller: false,

        variants: [
          {
            sku: "FEATURED-SHIRT-M",

            size: "M",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 1099,
            },
          },
        ],
      }),
    ).expect(201);

    const shirtProduct = shirtResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Best-Seller Inactive Product
    |--------------------------------------------------------------------------
    */

    const trouserResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Best Seller Trousers",

        slug: "best-seller-trousers",

        category: trousersCategory.id,

        status: "inactive",

        isFeatured: false,
        isNewArrival: false,
        isBestSeller: true,

        variants: [
          {
            sku: "BEST-TROUSER-32",

            size: "32",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1499,
            },
          },
        ],
      }),
    ).expect(201);

    const trouserProduct = trouserResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Category Filter
    |--------------------------------------------------------------------------
    */

    const categoryFilterResponse = await agent
      .get(`${adminProductUrl}?category=${shirtsCategory.id}`)
      .expect(200);

    expect(categoryFilterResponse.body.data.products).toHaveLength(1);

    expect(categoryFilterResponse.body.data.products[0].id).toBe(
      shirtProduct.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Status Filter
    |--------------------------------------------------------------------------
    */

    const statusFilterResponse = await agent
      .get(`${adminProductUrl}?status=inactive`)
      .expect(200);

    expect(statusFilterResponse.body.data.products).toHaveLength(1);

    expect(statusFilterResponse.body.data.products[0].id).toBe(
      trouserProduct.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Featured Filter
    |--------------------------------------------------------------------------
    */

    const featuredResponse = await agent
      .get(`${adminProductUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.products).toHaveLength(1);

    expect(featuredResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | New-Arrival Filter
    |--------------------------------------------------------------------------
    */

    const newArrivalResponse = await agent
      .get(`${adminProductUrl}?isNewArrival=true`)
      .expect(200);

    expect(newArrivalResponse.body.data.products).toHaveLength(1);

    expect(newArrivalResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Best-Seller Filter
    |--------------------------------------------------------------------------
    */

    const bestSellerResponse = await agent
      .get(`${adminProductUrl}?isBestSeller=true`)
      .expect(200);

    expect(bestSellerResponse.body.data.products).toHaveLength(1);

    expect(bestSellerResponse.body.data.products[0].id).toBe(trouserProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Combined Filters
    |--------------------------------------------------------------------------
    */

    const combinedResponse = await agent
      .get(
        `${adminProductUrl}?category=${shirtsCategory.id}&status=draft&isFeatured=true&isNewArrival=true`,
      )
      .expect(200);

    expect(combinedResponse.body.data.products).toHaveLength(1);

    expect(combinedResponse.body.data.products[0].id).toBe(shirtProduct.id);
  });
  /*
  |--------------------------------------------------------------------------
  | Admin Product Stock and Deleted Filters
  |--------------------------------------------------------------------------
  */

  it("filters admin Products by stock and deletion state", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Stock Filter Products",

      slug: "stock-filter-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Regular In-Stock Product
    |--------------------------------------------------------------------------
    |
    | Available stock:
    | 10 - 2 = 8
    |
    | Low-stock threshold:
    | 3
    |--------------------------------------------------------------------------
    */

    const inStockResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Regular Stock Product",

        slug: "regular-stock-product",

        category: category.id,

        variants: [
          {
            sku: "REGULAR-STOCK-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const inStockProduct = inStockResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Low-Stock Product
    |--------------------------------------------------------------------------
    |
    | Available stock:
    | 5 - 2 = 3
    |
    | Low-stock threshold:
    | 3
    |--------------------------------------------------------------------------
    */

    const lowStockResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Low Stock Product",

        slug: "low-stock-product",

        category: category.id,

        variants: [
          {
            sku: "LOW-STOCK-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 899,
            },

            inventory: {
              stock: 5,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const lowStockProduct = lowStockResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Out-of-Stock Product
    |--------------------------------------------------------------------------
    |
    | Available stock:
    | 4 - 4 = 0
    |--------------------------------------------------------------------------
    */

    const outOfStockResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Out Of Stock Product",

        slug: "out-of-stock-product",

        category: category.id,

        variants: [
          {
            sku: "OUT-STOCK-M",

            size: "M",

            color: {
              name: "Red",
              code: "#FF0000",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 999,
            },

            inventory: {
              stock: 4,
              reservedStock: 4,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const outOfStockProduct = outOfStockResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | In-Stock Filter
    |--------------------------------------------------------------------------
    |
    | Both regular and low-stock Products are in stock.
    |--------------------------------------------------------------------------
    */

    const inStockListResponse = await agent
      .get(
        `${adminProductUrl}?stockStatus=in-stock&sortBy=name&sortDirection=asc`,
      )
      .expect(200);

    expect(
      inStockListResponse.body.data.products.map((product) => product.slug),
    ).toEqual(["low-stock-product", "regular-stock-product"]);

    /*
    |--------------------------------------------------------------------------
    | Low-Stock Filter
    |--------------------------------------------------------------------------
    */

    const lowStockListResponse = await agent
      .get(`${adminProductUrl}?stockStatus=low-stock`)
      .expect(200);

    expect(lowStockListResponse.body.data.products).toHaveLength(1);

    expect(lowStockListResponse.body.data.products[0].id).toBe(
      lowStockProduct.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Out-of-Stock Filter
    |--------------------------------------------------------------------------
    */

    const outOfStockListResponse = await agent
      .get(`${adminProductUrl}?stockStatus=out-of-stock`)
      .expect(200);

    expect(outOfStockListResponse.body.data.products).toHaveLength(1);

    expect(outOfStockListResponse.body.data.products[0].id).toBe(
      outOfStockProduct.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Delete Low-Stock Product
    |--------------------------------------------------------------------------
    */

    await agent.delete(`${adminProductUrl}/${lowStockProduct.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Default List Excludes Deleted Product
    |--------------------------------------------------------------------------
    */

    const defaultListResponse = await agent.get(adminProductUrl).expect(200);

    expect(
      defaultListResponse.body.data.products.map((product) => product.id),
    ).toEqual(
      expect.arrayContaining([inStockProduct.id, outOfStockProduct.id]),
    );

    expect(
      defaultListResponse.body.data.products.map((product) => product.id),
    ).not.toContain(lowStockProduct.id);

    expect(defaultListResponse.body.data.pagination.totalItems).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Deleted-Only List
    |--------------------------------------------------------------------------
    */

    const deletedOnlyResponse = await agent
      .get(`${adminProductUrl}?deleted=only`)
      .expect(200);

    expect(deletedOnlyResponse.body.data.products).toHaveLength(1);

    expect(deletedOnlyResponse.body.data.products[0].id).toBe(
      lowStockProduct.id,
    );

    expect(deletedOnlyResponse.body.data.products[0].isDeleted).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Include Deleted List
    |--------------------------------------------------------------------------
    */

    const includeDeletedResponse = await agent
      .get(`${adminProductUrl}?deleted=include`)
      .expect(200);

    expect(includeDeletedResponse.body.data.pagination.totalItems).toBe(3);

    expect(
      includeDeletedResponse.body.data.products.map((product) => product.id),
    ).toEqual(
      expect.arrayContaining([
        inStockProduct.id,
        lowStockProduct.id,
        outOfStockProduct.id,
      ]),
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Public Product Search, Category and Flag Filters
  |--------------------------------------------------------------------------
  */

  it("filters public Products by search, category, and Product flags", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Categories
    |--------------------------------------------------------------------------
    */

    const topsResponse = await createCategoryRequest(agent, {
      name: "Public Tops",

      slug: "public-tops",

      status: "active",
    }).expect(201);

    const bottomsResponse = await createCategoryRequest(agent, {
      name: "Public Bottoms",

      slug: "public-bottoms",

      status: "active",
    }).expect(201);

    const topsCategory = topsResponse.body.data.category;

    const bottomsCategory = bottomsResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Featured and New-Arrival Shirt
    |--------------------------------------------------------------------------
    */

    const shirtResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Premium Cotton Shirt",

        slug: "public-premium-cotton-shirt",

        category: topsCategory.id,

        tags: ["cotton", "shirt"],

        status: "active",

        isFeatured: true,
        isNewArrival: true,
        isBestSeller: false,

        images: [
          {
            url: "https://example.com/public-premium-cotton-shirt.jpg",

            altText: "Premium cotton shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "PUBLIC-COTTON-SHIRT-M",

            size: "M",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 500,
              sellingPrice: 999,
              discountPrice: 799,
            },

            inventory: {
              stock: 10,
              reservedStock: 1,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const shirtProduct = shirtResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Best-Seller Jeans
    |--------------------------------------------------------------------------
    */

    const jeansResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Classic Denim Jeans",

        slug: "public-classic-denim-jeans",

        category: bottomsCategory.id,

        tags: ["denim", "jeans"],

        status: "active",

        isFeatured: false,
        isNewArrival: false,
        isBestSeller: true,

        images: [
          {
            url: "https://example.com/public-classic-denim-jeans.jpg",

            altText: "Classic denim jeans",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "PUBLIC-DENIM-JEANS-32",

            size: "32",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 800,
              sellingPrice: 1599,
            },

            inventory: {
              stock: 6,
              reservedStock: 0,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const jeansProduct = jeansResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Search by Product Name and Tag
    |--------------------------------------------------------------------------
    */

    const cottonSearchResponse = await request(app)
      .get(`${publicProductUrl}?search=cotton`)
      .expect(200);

    expect(cottonSearchResponse.body.data.products).toHaveLength(1);

    expect(cottonSearchResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Search by Variant SKU
    |--------------------------------------------------------------------------
    */

    const skuSearchResponse = await request(app)
      .get(`${publicProductUrl}?search=PUBLIC-COTTON-SHIRT-M`)
      .expect(200);

    expect(skuSearchResponse.body.data.products).toHaveLength(1);

    expect(skuSearchResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Category Filter
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await request(app)
      .get(`${publicProductUrl}?category=${bottomsCategory.id}`)
      .expect(200);

    expect(categoryResponse.body.data.products).toHaveLength(1);

    expect(categoryResponse.body.data.products[0].id).toBe(jeansProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Featured Filter
    |--------------------------------------------------------------------------
    */

    const featuredResponse = await request(app)
      .get(`${publicProductUrl}?isFeatured=true`)
      .expect(200);

    expect(featuredResponse.body.data.products).toHaveLength(1);

    expect(featuredResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | New-Arrival Filter
    |--------------------------------------------------------------------------
    */

    const newArrivalResponse = await request(app)
      .get(`${publicProductUrl}?isNewArrival=true`)
      .expect(200);

    expect(newArrivalResponse.body.data.products).toHaveLength(1);

    expect(newArrivalResponse.body.data.products[0].id).toBe(shirtProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Best-Seller Filter
    |--------------------------------------------------------------------------
    */

    const bestSellerResponse = await request(app)
      .get(`${publicProductUrl}?isBestSeller=true`)
      .expect(200);

    expect(bestSellerResponse.body.data.products).toHaveLength(1);

    expect(bestSellerResponse.body.data.products[0].id).toBe(jeansProduct.id);
  });

  /*
  |--------------------------------------------------------------------------
  | Public Product Price, Stock and Sorting
  |--------------------------------------------------------------------------
  */

  it("filters and sorts public Products by price and stock availability", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Public Price Products",

      slug: "public-price-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Budget Product
    |--------------------------------------------------------------------------
    |
    | Effective price: 499
    | Available stock: 10
    |--------------------------------------------------------------------------
    */

    const budgetResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Budget Cotton Top",

        slug: "public-budget-cotton-top",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/public-budget-cotton-top.jpg",

            altText: "Budget cotton top",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "PUBLIC-BUDGET-TOP-M",

            size: "M",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 200,
              sellingPrice: 599,
              discountPrice: 499,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const budgetProduct = budgetResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Premium Low-Stock Product
    |--------------------------------------------------------------------------
    |
    | Effective price: 1299
    | Available stock: 2
    | Low-stock threshold: 3
    |--------------------------------------------------------------------------
    */

    const premiumResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Premium Designer Top",

        slug: "public-premium-designer-top",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/public-premium-designer-top.jpg",

            altText: "Premium designer top",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "PUBLIC-PREMIUM-TOP-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1499,
              discountPrice: 1299,
            },

            inventory: {
              stock: 3,
              reservedStock: 1,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const premiumProduct = premiumResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Out-of-Stock Product
    |--------------------------------------------------------------------------
    |
    | Effective price: 799
    | Available stock: 0
    |--------------------------------------------------------------------------
    */

    const soldOutResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Sold Out Casual Top",

        slug: "public-sold-out-casual-top",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/public-sold-out-casual-top.jpg",

            altText: "Sold out casual top",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "PUBLIC-SOLD-OUT-TOP-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 899,
              discountPrice: 799,
            },

            inventory: {
              stock: 5,
              reservedStock: 5,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const soldOutProduct = soldOutResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | In-Stock Products Sorted by Lowest Price
    |--------------------------------------------------------------------------
    */

    const inStockResponse = await request(app)
      .get(`${publicProductUrl}?inStock=true&sort=price-low-to-high`)
      .expect(200);

    expect(
      inStockResponse.body.data.products.map((product) => product.id),
    ).toEqual([budgetProduct.id, premiumProduct.id]);

    /*
    |--------------------------------------------------------------------------
    | Low-Stock Public Summary
    |--------------------------------------------------------------------------
    */

    const premiumSummary = inStockResponse.body.data.products.find(
      (product) => {
        return product.id === premiumProduct.id;
      },
    );

    expect(premiumSummary.availability).toEqual({
      availableStock: 2,
      isInStock: true,
      isLowStock: true,
    });

    /*
    |--------------------------------------------------------------------------
    | Out-of-Stock Filter
    |--------------------------------------------------------------------------
    */

    const outOfStockResponse = await request(app)
      .get(`${publicProductUrl}?inStock=false`)
      .expect(200);

    expect(outOfStockResponse.body.data.products).toHaveLength(1);

    expect(outOfStockResponse.body.data.products[0].id).toBe(soldOutProduct.id);

    expect(outOfStockResponse.body.data.products[0].availability).toEqual({
      availableStock: 0,
      isInStock: false,
      isLowStock: false,
    });

    /*
    |--------------------------------------------------------------------------
    | Price Range Filter
    |--------------------------------------------------------------------------
    |
    | Only the Product priced at 799 should match.
    |--------------------------------------------------------------------------
    */

    const priceRangeResponse = await request(app)
      .get(`${publicProductUrl}?minPrice=700&maxPrice=900`)
      .expect(200);

    expect(priceRangeResponse.body.data.products).toHaveLength(1);

    expect(priceRangeResponse.body.data.products[0].id).toBe(soldOutProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Highest-to-Lowest Price Sorting
    |--------------------------------------------------------------------------
    */

    const descendingPriceResponse = await request(app)
      .get(`${publicProductUrl}?sort=price-high-to-low`)
      .expect(200);

    expect(
      descendingPriceResponse.body.data.products.map((product) => product.id),
    ).toEqual([premiumProduct.id, soldOutProduct.id, budgetProduct.id]);

    /*
    |--------------------------------------------------------------------------
    | Name Sorting
    |--------------------------------------------------------------------------
    */

    const nameSortResponse = await request(app)
      .get(`${publicProductUrl}?sort=name-asc`)
      .expect(200);

    expect(
      nameSortResponse.body.data.products.map((product) => product.name),
    ).toEqual([
      "Budget Cotton Top",
      "Premium Designer Top",
      "Sold Out Casual Top",
    ]);
  });
  /*
  |--------------------------------------------------------------------------
  | Public Product Query Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid and admin-only public Product query parameters", async () => {
    const invalidRequests = [
      `${publicProductUrl}?page=0`,

      `${publicProductUrl}?page=abc`,

      `${publicProductUrl}?limit=51`,

      `${publicProductUrl}?inStock=yes`,

      `${publicProductUrl}?minPrice=-1`,

      `${publicProductUrl}?minPrice=1000&maxPrice=500`,

      `${publicProductUrl}?sort=price`,

      /*
       * Admin-only filters.
       */
      `${publicProductUrl}?status=draft`,

      `${publicProductUrl}?deleted=include`,

      `${publicProductUrl}?stockStatus=low-stock`,

      `${publicProductUrl}?sortBy=name`,

      /*
       * Unknown query field.
       */
      `${publicProductUrl}?unknown=value`,
    ];

    for (const requestUrl of invalidRequests) {
      const response = await request(app).get(requestUrl).expect(400);

      expect(response.body.success).toBe(false);
    }

    /*
    |--------------------------------------------------------------------------
    | Product Details Must Not Accept Query Parameters
    |--------------------------------------------------------------------------
    */

    const detailsQueryResponse = await request(app)
      .get(`${publicProductUrl}/valid-product-slug?includeDeleted=true`)
      .expect(400);

    expect(detailsQueryResponse.body.success).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Direct Category Public Visibility
  |--------------------------------------------------------------------------
  */

  it("hides an active Product when its category becomes inactive or deleted", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Visibility Dresses",

      slug: "visibility-dresses",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Visibility Floral Dress",

        slug: "visibility-floral-dress",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/visibility-floral-dress.jpg",

            altText: "Visibility floral dress",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "VISIBILITY-DRESS-M",

            size: "M",

            color: {
              name: "Pink",
              code: "#FFC0CB",
            },

            pricing: {
              buyingPrice: 700,
              sellingPrice: 1499,
              discountPrice: 1299,
            },

            inventory: {
              stock: 10,
              reservedStock: 1,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Initially Public
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Inactivate Category Directly
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: category.id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    const inactiveDetailsResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(404);

    expect(inactiveDetailsResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    const inactiveListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    expect(inactiveListResponse.body.data.products).toHaveLength(0);

    /*
    |--------------------------------------------------------------------------
    | Reactivate Category
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: category.id,
      },
      {
        $set: {
          status: "active",
        },
      },
    );

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Soft Delete Category Directly
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: category.id,
      },
      {
        $set: {
          deletedAt: new Date(),

          deletedBy: user._id,
        },
      },
    );

    const deletedCategoryResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(404);

    expect(deletedCategoryResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    const deletedCategoryListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    expect(deletedCategoryListResponse.body.data.products).toHaveLength(0);

    /*
     * Admin Product details remain available.
     */
    const adminDetailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(adminDetailsResponse.body.data.product.id).toBe(product.id);
  });

  /*
  |--------------------------------------------------------------------------
  | Category Ancestor Public Visibility
  |--------------------------------------------------------------------------
  */

  it("hides an active Product when a category ancestor becomes unavailable", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Category Hierarchy
    |--------------------------------------------------------------------------
    |
    | Women
    | └── Tops
    |--------------------------------------------------------------------------
    */

    const womenResponse = await createCategoryRequest(agent, {
      name: "Visibility Women",

      slug: "visibility-women",

      status: "active",
    }).expect(201);

    const womenCategory = womenResponse.body.data.category;

    const topsResponse = await createCategoryRequest(agent, {
      name: "Visibility Women Tops",

      slug: "visibility-women-tops",

      parent: womenCategory.id,

      status: "active",
    }).expect(201);

    const topsCategory = topsResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product Under Child Category
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Visibility Women Top",

        slug: "visibility-women-top",

        category: topsCategory.id,

        status: "active",

        images: [
          {
            url: "https://example.com/visibility-women-top.jpg",

            altText: "Visibility women top",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "VISIBILITY-WOMEN-TOP-M",

            size: "M",

            color: {
              name: "White",
              code: "#FFFFFF",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 899,
              discountPrice: 799,
            },

            inventory: {
              stock: 8,
              reservedStock: 0,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Initially Public
    |--------------------------------------------------------------------------
    */

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Inactivate Parent Category
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: womenCategory.id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    const inactiveAncestorDetailsResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(404);

    expect(inactiveAncestorDetailsResponse.body.errorCode).toBe(
      "PRODUCT_NOT_FOUND",
    );

    const inactiveAncestorListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    expect(inactiveAncestorListResponse.body.data.products).toHaveLength(0);

    /*
    |--------------------------------------------------------------------------
    | Reactivate Parent
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: womenCategory.id,
      },
      {
        $set: {
          status: "active",
        },
      },
    );

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Delete Parent Category
    |--------------------------------------------------------------------------
    */

    await Category.updateOne(
      {
        _id: womenCategory.id,
      },
      {
        $set: {
          deletedAt: new Date(),

          deletedBy: user._id,
        },
      },
    );

    await request(app).get(`${publicProductUrl}/${product.slug}`).expect(404);

    const deletedAncestorListResponse = await request(app)
      .get(publicProductUrl)
      .expect(200);

    expect(deletedAncestorListResponse.body.data.products).toHaveLength(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Product Identifier Validation and Not Found
  |--------------------------------------------------------------------------
  */

  it("handles invalid and unknown Product IDs and slugs", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Invalid Admin Product ID
    |--------------------------------------------------------------------------
    */

    const invalidAdminIdResponse = await agent
      .get(`${adminProductUrl}/invalid-id`)
      .expect(400);

    expect(invalidAdminIdResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Unknown Valid Admin Product ID
    |--------------------------------------------------------------------------
    */

    const unknownProductId = "507f1f77bcf86cd799439011";

    const unknownAdminResponse = await agent
      .get(`${adminProductUrl}/${unknownProductId}`)
      .expect(404);

    expect(unknownAdminResponse.body.success).toBe(false);

    expect(unknownAdminResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Unknown Product Update
    |--------------------------------------------------------------------------
    */

    const unknownUpdateResponse = await agent
      .patch(`${adminProductUrl}/${unknownProductId}`)
      .send({
        name: "Unknown Updated Product",
      })
      .expect(404);

    expect(unknownUpdateResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Unknown Product Delete
    |--------------------------------------------------------------------------
    */

    const unknownDeleteResponse = await agent
      .delete(`${adminProductUrl}/${unknownProductId}`)
      .expect(404);

    expect(unknownDeleteResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Unknown Product Restore
    |--------------------------------------------------------------------------
    */

    const unknownRestoreResponse = await agent
      .patch(`${adminProductUrl}/${unknownProductId}/restore`)
      .expect(404);

    expect(unknownRestoreResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Invalid Public Product Slug
    |--------------------------------------------------------------------------
    |
    | Product slug requires at least three characters.
    |--------------------------------------------------------------------------
    */

    const invalidPublicSlugResponse = await request(app)
      .get(`${publicProductUrl}/ab`)
      .expect(400);

    expect(invalidPublicSlugResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Unknown Valid Public Product Slug
    |--------------------------------------------------------------------------
    */

    const unknownPublicResponse = await request(app)
      .get(`${publicProductUrl}/unknown-valid-product`)
      .expect(404);

    expect(unknownPublicResponse.body.success).toBe(false);

    expect(unknownPublicResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Product Image Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid Product images and multiple primary images", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Image Validation Products",

      slug: "image-validation-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Invalid Image URL
    |--------------------------------------------------------------------------
    */

    const invalidUrlResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Invalid Image Product",

        slug: "invalid-image-product",

        category: category.id,

        images: [
          {
            url: "not-a-valid-url",

            altText: "Invalid Product image",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "INVALID-IMAGE-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },
          },
        ],
      }),
    ).expect(400);

    expect(invalidUrlResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Multiple Primary Images
    |--------------------------------------------------------------------------
    */

    const multiplePrimaryResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Multiple Primary Images Product",

        slug: "multiple-primary-images-product",

        category: category.id,

        images: [
          {
            url: "https://example.com/product-front.jpg",

            altText: "Product front image",

            sortOrder: 1,

            isPrimary: true,
          },

          {
            url: "https://example.com/product-back.jpg",

            altText: "Product back image",

            sortOrder: 2,

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "MULTI-PRIMARY-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 400,
              sellingPrice: 899,
            },
          },
        ],
      }),
    ).expect(400);

    expect(multiplePrimaryResponse.body.success).toBe(false);
  });
  /*
  |--------------------------------------------------------------------------
  | Product Update Validation
  |--------------------------------------------------------------------------
  */

  it("rejects empty and backend-controlled Product updates", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Update Validation Products",

      slug: "update-validation-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Update Validation Product",

        slug: "update-validation-product",

        category: category.id,

        variants: [
          {
            sku: "UPDATE-VALIDATION-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Empty PATCH
    |--------------------------------------------------------------------------
    */

    const emptyUpdateResponse = await agent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({})
      .expect(400);

    expect(emptyUpdateResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Backend-Controlled Field
    |--------------------------------------------------------------------------
    */

    const protectedFieldResponse = await agent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        deletedBy: String(user._id),
      })
      .expect(400);

    expect(protectedFieldResponse.body.success).toBe(false);

    /*
     * Failed requests must not modify the Product.
     */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.name).toBe(
      "Update Validation Product",
    );

    expect(detailsResponse.body.data.product.isDeleted).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Admin Product List Query Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid admin Product list query parameters", async () => {
    const { agent } = await createAuthenticatedAgent();

    const invalidRequests = [
      `${adminProductUrl}?page=0`,

      `${adminProductUrl}?page=abc`,

      `${adminProductUrl}?limit=0`,

      `${adminProductUrl}?limit=101`,

      `${adminProductUrl}?isFeatured=yes`,

      `${adminProductUrl}?isNewArrival=1`,

      `${adminProductUrl}?isBestSeller=no`,

      `${adminProductUrl}?status=published`,

      `${adminProductUrl}?stockStatus=available`,

      `${adminProductUrl}?deleted=true`,

      `${adminProductUrl}?sortBy=price`,

      `${adminProductUrl}?sortDirection=ascending`,

      `${adminProductUrl}?category=invalid-id`,

      `${adminProductUrl}?unknown=value`,
    ];

    for (const requestUrl of invalidRequests) {
      const response = await agent.get(requestUrl).expect(400);

      expect(response.body.success).toBe(false);
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Public Inactive Variant Filtering
  |--------------------------------------------------------------------------
  */

  it("excludes inactive variants from public Product responses", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Variant Visibility Products",

      slug: "variant-visibility-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Variant Visibility T-Shirt",

        slug: "variant-visibility-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/variant-visibility-tshirt.jpg",

            altText: "Variant visibility T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          /*
            |--------------------------------------------------------------------------
            | Active Variant
            |--------------------------------------------------------------------------
            */

          {
            sku: "VISIBLE-VARIANT-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
              discountPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },

          /*
            |--------------------------------------------------------------------------
            | Inactive Variant
            |--------------------------------------------------------------------------
            |
            | Its cheaper price and large inventory must not affect
            | the public Product price or availability summary.
            |--------------------------------------------------------------------------
            */

          {
            sku: "HIDDEN-VARIANT-L",

            size: "L",

            color: {
              name: "Red",
              code: "#FF0000",
            },

            pricing: {
              buyingPrice: 100,
              sellingPrice: 299,
              discountPrice: 199,
            },

            inventory: {
              stock: 100,
              reservedStock: 0,
              lowStockThreshold: 5,
            },

            isActive: false,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Admin Response Includes Both Variants
    |--------------------------------------------------------------------------
    */

    expect(product.variants).toHaveLength(2);

    /*
    |--------------------------------------------------------------------------
    | Public Details Include Only Active Variant
    |--------------------------------------------------------------------------
    */

    const publicDetailsResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(200);

    const publicProduct = publicDetailsResponse.body.data.product;

    expect(publicProduct.variants).toHaveLength(1);

    expect(publicProduct.variants[0].sku).toBe("VISIBLE-VARIANT-M");

    expect(publicProduct.variants.map((variant) => variant.sku)).not.toContain(
      "HIDDEN-VARIANT-L",
    );

    /*
    |--------------------------------------------------------------------------
    | Price Uses Only Active Variant
    |--------------------------------------------------------------------------
    */

    expect(publicProduct.priceRange).toEqual({
      minimum: 699,
      maximum: 699,
      currency: "INR",
    });

    /*
    |--------------------------------------------------------------------------
    | Availability Uses Only Active Variant
    |--------------------------------------------------------------------------
    |
    | 10 stock - 2 reserved = 8 available.
    |--------------------------------------------------------------------------
    */

    expect(publicProduct.availability).toEqual({
      availableStock: 8,
      isInStock: true,
      isLowStock: false,
    });

    /*
    |--------------------------------------------------------------------------
    | Public List Summary Also Ignores Inactive Variant
    |--------------------------------------------------------------------------
    */

    const publicListResponse = await request(app)
      .get(`${publicProductUrl}?search=variant-visibility-tshirt`)
      .expect(200);

    expect(publicListResponse.body.data.products).toHaveLength(1);

    const publicSummary = publicListResponse.body.data.products[0];

    expect(publicSummary.priceRange).toEqual({
      minimum: 699,
      maximum: 699,
      currency: "INR",
    });

    expect(publicSummary.availability).toEqual({
      availableStock: 8,
      isInStock: true,
      isLowStock: false,
    });
  });

  // Product Inventory Core Integration Tests

  /*
  |--------------------------------------------------------------------------
  | Product Inventory Lifecycle
  |--------------------------------------------------------------------------
  */

  it("adjusts, reserves, releases, and commits Product inventory", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
    |--------------------------------------------------------------------------
    | Create Active Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Inventory Lifecycle Products",

      slug: "inventory-lifecycle-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    |
    | Initial inventory:
    |
    | stock         = 10
    | reservedStock = 2
    | available     = 8
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Inventory Lifecycle T-Shirt",

        slug: "inventory-lifecycle-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/inventory-lifecycle-tshirt.jpg",

            altText: "Inventory lifecycle T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "INVENTORY-LIFECYCLE-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
              discountPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    const inventoryUrl = createInventoryUrl(product.id, variant.id);

    expect(variant.inventory).toEqual({
      stock: 10,
      reservedStock: 2,
      availableStock: 8,
      lowStockThreshold: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Add Physical Stock
    |--------------------------------------------------------------------------
    |
    | stock         = 10 + 5 = 15
    | reservedStock = 2
    | available     = 13
    |--------------------------------------------------------------------------
    */

    const adjustmentResponse = await agent
      .patch(inventoryUrl)
      .send({
        quantityDelta: 5,
        reason: "restock",
        note: "Supplier delivery received",
      })
      .expect(200);

    expect(adjustmentResponse.body.success).toBe(true);

    expect(adjustmentResponse.body.data.variant.inventory).toEqual({
      stock: 15,
      reservedStock: 2,
      availableStock: 13,
      lowStockThreshold: 3,
    });

    expect(adjustmentResponse.body.data.inventorySummary).toEqual({
      totalStock: 15,
      reservedStock: 2,
      availableStock: 13,
    });

    /*
    |--------------------------------------------------------------------------
    | Reserve Four Units
    |--------------------------------------------------------------------------
    |
    | stock         = 15
    | reservedStock = 2 + 4 = 6
    | available     = 9
    |--------------------------------------------------------------------------
    */

    const reserveResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 4,
        referenceId: "ORDER-INVENTORY-001",
      })
      .expect(200);

    expect(reserveResponse.body.data.variant.inventory).toEqual({
      stock: 15,
      reservedStock: 6,
      availableStock: 9,
      lowStockThreshold: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Release Two Reserved Units
    |--------------------------------------------------------------------------
    |
    | stock         = 15
    | reservedStock = 6 - 2 = 4
    | available     = 11
    |--------------------------------------------------------------------------
    */

    const releaseResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 2,
        referenceId: "ORDER-INVENTORY-001",
      })
      .expect(200);

    expect(releaseResponse.body.data.variant.inventory).toEqual({
      stock: 15,
      reservedStock: 4,
      availableStock: 11,
      lowStockThreshold: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Commit Three Reserved Units
    |--------------------------------------------------------------------------
    |
    | stock         = 15 - 3 = 12
    | reservedStock = 4 - 3 = 1
    | available     = 11
    |--------------------------------------------------------------------------
    */

    const commitResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 3,
        referenceId: "ORDER-INVENTORY-001",
      })
      .expect(200);

    expect(commitResponse.body.data.variant.inventory).toEqual({
      stock: 12,
      reservedStock: 1,
      availableStock: 11,
      lowStockThreshold: 3,
    });

    expect(commitResponse.body.data.inventorySummary).toEqual({
      totalStock: 12,
      reservedStock: 1,
      availableStock: 11,
    });

    /*
    |--------------------------------------------------------------------------
    | Verify Persisted Admin Inventory
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 12,
      reservedStock: 1,
      availableStock: 11,
      lowStockThreshold: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Verify Public Availability
    |--------------------------------------------------------------------------
    |
    | Reserved stock is not exposed publicly.
    |--------------------------------------------------------------------------
    */

    const publicResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(200);

    const publicVariant = publicResponse.body.data.product.variants[0];

    expect(publicVariant.availability).toEqual({
      availableStock: 11,
      isInStock: true,
      isLowStock: false,
    });

    expect(publicVariant.availability).not.toHaveProperty("reservedStock");
  });

  /*
  |--------------------------------------------------------------------------
  | Product Inventory Request Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid Product inventory requests", async () => {
    const { agent } = await createAuthenticatedAgent();

    /*
     * Valid ObjectId values are sufficient because
     * validation fails before the service is called.
     */
    const productId = "507f1f77bcf86cd799439011";

    const variantId = "507f1f77bcf86cd799439012";

    const inventoryUrl = createInventoryUrl(productId, variantId);

    const invalidAdjustments = [
      {
        quantityDelta: 0,
        reason: "restock",
      },

      {
        quantityDelta: 1.5,
        reason: "restock",
      },

      {
        quantityDelta: 2,
        reason: "unknown",
      },

      {
        quantityDelta: 2,
        reason: "restock",
        updatedBy: "507f1f77bcf86cd799439013",
      },
    ];

    for (const body of invalidAdjustments) {
      const response = await agent.patch(inventoryUrl).send(body).expect(400);

      expect(response.body.success).toBe(false);
    }

    const quantityOperations = ["reserve", "release", "commit"];

    const invalidQuantities = [0, -1, 1.5, 1_000_001];

    for (const operation of quantityOperations) {
      for (const quantity of invalidQuantities) {
        const response = await agent
          .post(createInventoryUrl(productId, variantId, operation))
          .send({
            quantity,
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Unknown Body Property
    |--------------------------------------------------------------------------
    */

    const protectedFieldResponse = await agent
      .post(createInventoryUrl(productId, variantId, "reserve"))
      .send({
        quantity: 1,
        reservedStock: 100,
      })
      .expect(400);

    expect(protectedFieldResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Invalid Product and Variant IDs
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl("invalid-product-id", variantId))
      .send({
        quantityDelta: 1,
        reason: "restock",
      })
      .expect(400);

    await agent
      .patch(createInventoryUrl(productId, "invalid-variant-id"))
      .send({
        quantityDelta: 1,
        reason: "restock",
      })
      .expect(400);
  });

  /*
  |--------------------------------------------------------------------------
  | Product Inventory Safety Conflicts
  |--------------------------------------------------------------------------
  */

  it("rejects unsafe inventory adjustments and insufficient stock operations", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Inventory Conflict Products",

      slug: "inventory-conflict-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Initial Inventory
    |--------------------------------------------------------------------------
    |
    | stock         = 10
    | reservedStock = 4
    | available     = 6
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Inventory Conflict T-Shirt",

        slug: "inventory-conflict-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/inventory-conflict-tshirt.jpg",

            altText: "Inventory conflict T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "INVENTORY-CONFLICT-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },

            inventory: {
              stock: 10,
              reservedStock: 4,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    const inventoryUrl = createInventoryUrl(product.id, variant.id);

    /*
    |--------------------------------------------------------------------------
    | Stock Cannot Fall Below Reserved Stock
    |--------------------------------------------------------------------------
    |
    | 10 - 7 = 3
    | Reserved stock is 4.
    |--------------------------------------------------------------------------
    */

    const unsafeAdjustmentResponse = await agent
      .patch(inventoryUrl)
      .send({
        quantityDelta: -7,
        reason: "damage",
        note: "Attempt unsafe reduction",
      })
      .expect(409);

    expect(unsafeAdjustmentResponse.body.errorCode).toBe(
      "PRODUCT_STOCK_ADJUSTMENT_CONFLICT",
    );

    expect(unsafeAdjustmentResponse.body.details).toEqual({
      quantityDelta: -7,
      stock: 10,
      reservedStock: 4,
      resultingStock: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Cannot Reserve More Than Available
    |--------------------------------------------------------------------------
    |
    | Available stock is 6.
    |--------------------------------------------------------------------------
    */

    const insufficientAvailableResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 7,
        referenceId: "ORDER-CONFLICT-001",
      })
      .expect(409);

    expect(insufficientAvailableResponse.body.errorCode).toBe(
      "PRODUCT_INSUFFICIENT_AVAILABLE_STOCK",
    );

    expect(insufficientAvailableResponse.body.details).toEqual({
      requestedQuantity: 7,
      stock: 10,
      reservedStock: 4,
      availableStock: 6,
    });

    /*
    |--------------------------------------------------------------------------
    | Cannot Release More Than Reserved
    |--------------------------------------------------------------------------
    */

    const insufficientReleaseResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 5,
        referenceId: "ORDER-CONFLICT-001",
      })
      .expect(409);

    expect(insufficientReleaseResponse.body.errorCode).toBe(
      "PRODUCT_INSUFFICIENT_RESERVED_STOCK",
    );

    /*
    |--------------------------------------------------------------------------
    | Cannot Commit More Than Reserved
    |--------------------------------------------------------------------------
    */

    const insufficientCommitResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 5,
        referenceId: "ORDER-CONFLICT-001",
      })
      .expect(409);

    expect(insufficientCommitResponse.body.errorCode).toBe(
      "PRODUCT_INSUFFICIENT_RESERVED_STOCK",
    );

    /*
    |--------------------------------------------------------------------------
    | Failed Operations Must Not Change Inventory
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 10,
      reservedStock: 4,
      availableStock: 6,
      lowStockThreshold: 3,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Product and Variant Inventory
  |--------------------------------------------------------------------------
  */

  it("returns not-found errors for missing Products and variants", async () => {
    const { agent } = await createAuthenticatedAgent();

    const unknownProductId = "507f1f77bcf86cd799439011";

    const unknownVariantId = "507f1f77bcf86cd799439012";

    /*
    |--------------------------------------------------------------------------
    | Missing Product
    |--------------------------------------------------------------------------
    */

    const missingProductResponse = await agent
      .patch(createInventoryUrl(unknownProductId, unknownVariantId))
      .send({
        quantityDelta: 5,
        reason: "restock",
      })
      .expect(404);

    expect(missingProductResponse.body.success).toBe(false);

    expect(missingProductResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Missing Variant Products",

      slug: "missing-variant-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Missing Variant T-Shirt",

        slug: "missing-variant-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/missing-variant-tshirt.jpg",

            altText: "Missing variant T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "MISSING-VARIANT-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Missing Variant
    |--------------------------------------------------------------------------
    */

    const missingVariantResponse = await agent
      .post(createInventoryUrl(product.id, unknownVariantId, "reserve"))
      .send({
        quantity: 1,
        referenceId: "ORDER-MISSING-VARIANT",
      })
      .expect(404);

    expect(missingVariantResponse.body.success).toBe(false);

    expect(missingVariantResponse.body.errorCode).toBe(
      "PRODUCT_VARIANT_NOT_FOUND",
    );

    /*
     * Failed operations must not change
     * the existing variant inventory.
     */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 10,
      reservedStock: 0,
      availableStock: 10,
      lowStockThreshold: 3,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Inactive Inventory Reservation Rules
  |--------------------------------------------------------------------------
  */

  it("rejects reservations for inactive Products and inactive variants", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Inactive Inventory Products",

      slug: "inactive-inventory-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Draft Product
    |--------------------------------------------------------------------------
    */

    const draftResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Draft Inventory Product",

        slug: "draft-inventory-product",

        category: category.id,

        status: "draft",

        variants: [
          {
            sku: "DRAFT-INVENTORY-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const draftProduct = draftResponse.body.data.product;

    const draftVariant = draftProduct.variants[0];

    /*
    |--------------------------------------------------------------------------
    | Draft Product Reservation
    |--------------------------------------------------------------------------
    */

    const inactiveProductResponse = await agent
      .post(createInventoryUrl(draftProduct.id, draftVariant.id, "reserve"))
      .send({
        quantity: 1,
        referenceId: "ORDER-INACTIVE-PRODUCT",
      })
      .expect(409);

    expect(inactiveProductResponse.body.errorCode).toBe("PRODUCT_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Active Product with Active and Inactive Variants
    |--------------------------------------------------------------------------
    */

    const activeResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Variant Status Product",

        slug: "variant-status-product",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/variant-status-product.jpg",

            altText: "Variant status Product",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "VARIANT-STATUS-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },

          {
            sku: "VARIANT-STATUS-L",

            size: "L",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 8,
              reservedStock: 0,
              lowStockThreshold: 2,
            },

            isActive: false,
          },
        ],
      }),
    ).expect(201);

    const activeProduct = activeResponse.body.data.product;

    const inactiveVariant = activeProduct.variants.find((variant) => {
      return variant.sku === "VARIANT-STATUS-L";
    });

    /*
    |--------------------------------------------------------------------------
    | Inactive Variant Reservation
    |--------------------------------------------------------------------------
    */

    const inactiveVariantResponse = await agent
      .post(createInventoryUrl(activeProduct.id, inactiveVariant.id, "reserve"))
      .send({
        quantity: 1,
        referenceId: "ORDER-INACTIVE-VARIANT",
      })
      .expect(409);

    expect(inactiveVariantResponse.body.errorCode).toBe(
      "PRODUCT_VARIANT_INACTIVE",
    );

    /*
    |--------------------------------------------------------------------------
    | Inventories Remain Unchanged
    |--------------------------------------------------------------------------
    */

    const draftDetailsResponse = await agent
      .get(`${adminProductUrl}/${draftProduct.id}`)
      .expect(200);

    expect(
      draftDetailsResponse.body.data.product.variants[0].inventory
        .reservedStock,
    ).toBe(0);

    const activeDetailsResponse = await agent
      .get(`${adminProductUrl}/${activeProduct.id}`)
      .expect(200);

    const persistedInactiveVariant =
      activeDetailsResponse.body.data.product.variants.find((variant) => {
        return variant.sku === "VARIANT-STATUS-L";
      });

    expect(persistedInactiveVariant.inventory.reservedStock).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Deleted Product Inventory
  |--------------------------------------------------------------------------
  */

  it("rejects every inventory operation for a soft-deleted Product", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Deleted Inventory Products",

      slug: "deleted-inventory-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Deleted Inventory T-Shirt",

        slug: "deleted-inventory-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/deleted-inventory-tshirt.jpg",

            altText: "Deleted inventory T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "DELETED-INVENTORY-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    /*
    |--------------------------------------------------------------------------
    | Delete Product
    |--------------------------------------------------------------------------
    */

    await agent.delete(`${adminProductUrl}/${product.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Adjustment
    |--------------------------------------------------------------------------
    */

    const adjustmentResponse = await agent
      .patch(createInventoryUrl(product.id, variant.id))
      .send({
        quantityDelta: 1,
        reason: "restock",
      })
      .expect(404);

    expect(adjustmentResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Reservation
    |--------------------------------------------------------------------------
    */

    const reserveResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 1,
      })
      .expect(404);

    expect(reserveResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Release
    |--------------------------------------------------------------------------
    */

    const releaseResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 1,
      })
      .expect(404);

    expect(releaseResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Commit
    |--------------------------------------------------------------------------
    */

    const commitResponse = await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 1,
      })
      .expect(404);

    expect(commitResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Inventory Was Not Modified
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 10,
      reservedStock: 2,
      availableStock: 8,
      lowStockThreshold: 3,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Product Inventory Reservation
  |--------------------------------------------------------------------------
  */

  it("prevents concurrent requests from reserving the same available stock", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Concurrent Inventory Products",

      slug: "concurrent-inventory-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Product with One Available Unit
    |--------------------------------------------------------------------------
    |
    | stock         = 1
    | reservedStock = 0
    | available     = 1
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Last Unit T-Shirt",

        slug: "last-unit-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/last-unit-tshirt.jpg",

            altText: "Last unit T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "LAST-UNIT-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
            },

            inventory: {
              stock: 1,
              reservedStock: 0,
              lowStockThreshold: 1,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    const reserveUrl = createInventoryUrl(product.id, variant.id, "reserve");

    /*
    |--------------------------------------------------------------------------
    | Send Two Reservations Concurrently
    |--------------------------------------------------------------------------
    |
    | Both requests attempt to reserve the only
    | available unit.
    |--------------------------------------------------------------------------
    */

    const responses = await Promise.all([
      agent.post(reserveUrl).send({
        quantity: 1,

        referenceId: "ORDER-CONCURRENT-001",
      }),

      agent.post(reserveUrl).send({
        quantity: 1,

        referenceId: "ORDER-CONCURRENT-002",
      }),
    ]);

    const statusCodes = responses
      .map((response) => {
        return response.status;
      })
      .sort((firstStatus, secondStatus) => {
        return firstStatus - secondStatus;
      });

    /*
     * Exactly one request succeeds.
     * The other request is rejected.
     */
    expect(statusCodes).toEqual([200, 409]);

    const successfulResponse = responses.find((response) => {
      return response.status === 200;
    });

    const failedResponse = responses.find((response) => {
      return response.status === 409;
    });

    expect(successfulResponse.body.success).toBe(true);

    expect(failedResponse.body.success).toBe(false);

    expect(failedResponse.body.errorCode).toBe(
      "PRODUCT_INSUFFICIENT_AVAILABLE_STOCK",
    );

    expect(failedResponse.body.details).toEqual({
      requestedQuantity: 1,
      stock: 1,
      reservedStock: 1,
      availableStock: 0,
    });

    /*
    |--------------------------------------------------------------------------
    | Verify Final Inventory
    |--------------------------------------------------------------------------
    |
    | The same unit must not be reserved twice.
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 1,
      reservedStock: 1,
      availableStock: 0,
      lowStockThreshold: 1,
    });

    /*
    |--------------------------------------------------------------------------
    | Public Product Is Now Out of Stock
    |--------------------------------------------------------------------------
    */

    const publicResponse = await request(app)
      .get(`${publicProductUrl}/${product.slug}`)
      .expect(200);

    expect(publicResponse.body.data.product.availability).toEqual({
      availableStock: 0,
      isInStock: false,
      isLowStock: false,
    });
  });

  // Inventory Ledger Integration Tests

  /*
  |--------------------------------------------------------------------------
  | Inventory Ledger Lifecycle
  |--------------------------------------------------------------------------
  */

  it("creates an exact Inventory Ledger entry for every successful operation", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const actorId = String(user._id ?? user.id);

    /*
    |--------------------------------------------------------------------------
    | Create Active Category
    |--------------------------------------------------------------------------
    */

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Inventory Ledger Products",

      slug: "inventory-ledger-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    |
    | Initial inventory:
    |
    | stock         = 10
    | reservedStock = 2
    | available     = 8
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Inventory Ledger T-Shirt",

        slug: "inventory-ledger-tshirt",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/inventory-ledger-tshirt.jpg",

            altText: "Inventory ledger T-shirt",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "INVENTORY-LEDGER-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 799,
              discountPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 2,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    /*
    |--------------------------------------------------------------------------
    | Adjustment
    |--------------------------------------------------------------------------
    |
    | 10 / 2 / 8
    |       ↓
    | 15 / 2 / 13
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl(product.id, variant.id))
      .send({
        quantityDelta: 5,
        reason: "restock",
        note: "Ledger supplier delivery",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Reservation
    |--------------------------------------------------------------------------
    |
    | 15 / 2 / 13
    |       ↓
    | 15 / 6 / 9
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 4,
        referenceId: "ORDER-LEDGER-001",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Release
    |--------------------------------------------------------------------------
    |
    | 15 / 6 / 9
    |       ↓
    | 15 / 4 / 11
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 2,
        referenceId: "ORDER-LEDGER-001",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Commit
    |--------------------------------------------------------------------------
    |
    | 15 / 4 / 11
    |       ↓
    | 12 / 1 / 11
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 3,
        referenceId: "ORDER-LEDGER-001",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Read Ledger Entries
    |--------------------------------------------------------------------------
    */

    const entries = await ProductInventoryLedger.find({
      product: product.id,
    })
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .lean();

    expect(entries).toHaveLength(4);

    const [adjustmentEntry, reservationEntry, releaseEntry, commitEntry] =
      entries;

    /*
    |--------------------------------------------------------------------------
    | Common Ledger Fields
    |--------------------------------------------------------------------------
    */

    for (const entry of entries) {
      expect(String(entry.product)).toBe(product.id);

      expect(String(entry.variantId)).toBe(variant.id);

      expect(entry.sku).toBe("INVENTORY-LEDGER-M");

      expect(String(entry.actor)).toBe(actorId);

      expect(entry.createdAt).toBeInstanceOf(Date);
    }

    /*
    |--------------------------------------------------------------------------
    | Adjustment Ledger
    |--------------------------------------------------------------------------
    */

    expect(adjustmentEntry.operation).toBe(PRODUCT_INVENTORY_OPERATIONS.ADJUST);

    expect(adjustmentEntry.quantity).toBe(5);

    expect(adjustmentEntry.stockDelta).toBe(5);

    expect(adjustmentEntry.reservedStockDelta).toBe(0);

    expect(adjustmentEntry.reason).toBe("restock");

    expect(adjustmentEntry.note).toBe("Ledger supplier delivery");

    expect(adjustmentEntry.referenceId).toBeUndefined();

    expect(adjustmentEntry.before).toEqual({
      stock: 10,
      reservedStock: 2,
      availableStock: 8,
    });

    expect(adjustmentEntry.after).toEqual({
      stock: 15,
      reservedStock: 2,
      availableStock: 13,
    });

    /*
    |--------------------------------------------------------------------------
    | Reservation Ledger
    |--------------------------------------------------------------------------
    */

    expect(reservationEntry.operation).toBe(
      PRODUCT_INVENTORY_OPERATIONS.RESERVE,
    );

    expect(reservationEntry.quantity).toBe(4);

    expect(reservationEntry.stockDelta).toBe(0);

    expect(reservationEntry.reservedStockDelta).toBe(4);

    expect(reservationEntry.referenceId).toBe("ORDER-LEDGER-001");

    expect(reservationEntry.before).toEqual({
      stock: 15,
      reservedStock: 2,
      availableStock: 13,
    });

    expect(reservationEntry.after).toEqual({
      stock: 15,
      reservedStock: 6,
      availableStock: 9,
    });

    /*
    |--------------------------------------------------------------------------
    | Release Ledger
    |--------------------------------------------------------------------------
    */

    expect(releaseEntry.operation).toBe(PRODUCT_INVENTORY_OPERATIONS.RELEASE);

    expect(releaseEntry.quantity).toBe(2);

    expect(releaseEntry.stockDelta).toBe(0);

    expect(releaseEntry.reservedStockDelta).toBe(-2);

    expect(releaseEntry.referenceId).toBe("ORDER-LEDGER-001");

    expect(releaseEntry.before).toEqual({
      stock: 15,
      reservedStock: 6,
      availableStock: 9,
    });

    expect(releaseEntry.after).toEqual({
      stock: 15,
      reservedStock: 4,
      availableStock: 11,
    });

    /*
    |--------------------------------------------------------------------------
    | Commit Ledger
    |--------------------------------------------------------------------------
    */

    expect(commitEntry.operation).toBe(PRODUCT_INVENTORY_OPERATIONS.COMMIT);

    expect(commitEntry.quantity).toBe(3);

    expect(commitEntry.stockDelta).toBe(-3);

    expect(commitEntry.reservedStockDelta).toBe(-3);

    expect(commitEntry.referenceId).toBe("ORDER-LEDGER-001");

    expect(commitEntry.before).toEqual({
      stock: 15,
      reservedStock: 4,
      availableStock: 11,
    });

    expect(commitEntry.after).toEqual({
      stock: 12,
      reservedStock: 1,
      availableStock: 11,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Failed Inventory Operations Do Not Create Ledger Entries
  |--------------------------------------------------------------------------
  */

  it("does not create Inventory Ledger entries for failed operations", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Failed Ledger Products",

      slug: "failed-ledger-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    /*
    |--------------------------------------------------------------------------
    | Initial Inventory
    |--------------------------------------------------------------------------
    |
    | stock         = 5
    | reservedStock = 2
    | available     = 3
    |--------------------------------------------------------------------------
    */

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Failed Ledger Product",

        slug: "failed-ledger-product",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/failed-ledger-product.jpg",

            altText: "Failed ledger Product",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "FAILED-LEDGER-M",

            size: "M",

            color: {
              name: "Blue",
              code: "#0000FF",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 5,
              reservedStock: 2,
              lowStockThreshold: 2,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    /*
    |--------------------------------------------------------------------------
    | Unsafe Physical Adjustment
    |--------------------------------------------------------------------------
    |
    | 5 - 4 = 1
    | Reserved stock is 2.
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl(product.id, variant.id))
      .send({
        quantityDelta: -4,
        reason: "damage",
      })
      .expect(409);

    /*
    |--------------------------------------------------------------------------
    | Insufficient Available Stock
    |--------------------------------------------------------------------------
    |
    | Only three units are available.
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 4,
        referenceId: "ORDER-FAILED-001",
      })
      .expect(409);

    /*
    |--------------------------------------------------------------------------
    | Excessive Release
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 3,
        referenceId: "ORDER-FAILED-001",
      })
      .expect(409);

    /*
    |--------------------------------------------------------------------------
    | Excessive Commit
    |--------------------------------------------------------------------------
    */

    await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 3,
        referenceId: "ORDER-FAILED-001",
      })
      .expect(409);

    /*
    |--------------------------------------------------------------------------
    | No Ledger Entries Created
    |--------------------------------------------------------------------------
    */

    const ledgerCount = await ProductInventoryLedger.countDocuments({
      product: product.id,
    });

    expect(ledgerCount).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Product Inventory Remains Unchanged
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await agent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.variants[0].inventory).toEqual({
      stock: 5,
      reservedStock: 2,
      availableStock: 3,
      lowStockThreshold: 2,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | Inventory Ledger Transaction Rollback
  |--------------------------------------------------------------------------
  */

  it("rolls back Product inventory when Inventory Ledger creation fails", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Ledger Rollback Products",

      slug: "ledger-rollback-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const createResponse = await createProductRequest(
      agent,
      createProductPayload({
        name: "Ledger Rollback Product",

        slug: "ledger-rollback-product",

        category: category.id,

        status: "active",

        images: [
          {
            url: "https://example.com/ledger-rollback-product.jpg",

            altText: "Ledger rollback Product",

            isPrimary: true,
          },
        ],

        variants: [
          {
            sku: "LEDGER-ROLLBACK-M",

            size: "M",

            color: {
              name: "Black",
              code: "#000000",
            },

            pricing: {
              buyingPrice: 300,
              sellingPrice: 699,
            },

            inventory: {
              stock: 10,
              reservedStock: 0,
              lowStockThreshold: 3,
            },

            isActive: true,
          },
        ],
      }),
    ).expect(201);

    const product = createResponse.body.data.product;

    const variant = product.variants[0];

    /*
    |--------------------------------------------------------------------------
    | Deliberately Corrupt the SKU
    |--------------------------------------------------------------------------
    |
    | Direct collection access bypasses Mongoose validation.
    |--------------------------------------------------------------------------
    */

    await Product.collection.updateOne(
      {
        _id: new Product.base.Types.ObjectId(product.id),
      },
      {
        $unset: {
          "variants.0.sku": "",
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Attempt Inventory Adjustment
    |--------------------------------------------------------------------------
    |
    | Product update occurs inside the transaction.
    |
    | Ledger validation fails because SKU is missing.
    | The centralized error handler maps the Mongoose
    | validation failure to 400 Bad Request.
    |
    | The complete transaction must still be rolled back.
    |--------------------------------------------------------------------------
    */

    const adjustmentResponse = await agent
      .patch(createInventoryUrl(product.id, variant.id))
      .send({
        quantityDelta: 5,
        reason: "restock",
        note: "This transaction must roll back",
      })
      .expect(400);

    expect(adjustmentResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Verify Product Update Was Rolled Back
    |--------------------------------------------------------------------------
    */

    const persistedProduct = await Product.findById(product.id).lean();

    expect(persistedProduct.variants[0].inventory.stock).toBe(10);

    expect(persistedProduct.variants[0].inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Verify No Ledger Entry Was Inserted
    |--------------------------------------------------------------------------
    */

    const ledgerCount = await ProductInventoryLedger.countDocuments({
      product: product.id,
    });

    expect(ledgerCount).toBe(0);
  });

  /*
|--------------------------------------------------------------------------
| Inventory Ledger Authorization
|--------------------------------------------------------------------------
*/

  it("protects the Inventory Ledger endpoint with admin authorization", async () => {
    /*
    |--------------------------------------------------------------------------
    | Unauthenticated Request
    |--------------------------------------------------------------------------
    */

    const unauthenticatedResponse = await request(app)
      .get(`${adminProductUrl}/inventory-ledger`)
      .expect(401);

    expect(unauthenticatedResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Customer Request
    |--------------------------------------------------------------------------
    */

    const { agent: customerAgent } = await createAuthenticatedAgent({
      role: USER_ROLES.CUSTOMER,
    });

    const forbiddenResponse = await customerAgent
      .get(`${adminProductUrl}/inventory-ledger`)
      .expect(403);

    expect(forbiddenResponse.body.success).toBe(false);

    /*
    |--------------------------------------------------------------------------
    | Admin Request
    |--------------------------------------------------------------------------
    */

    const { agent: adminAgent } = await createAuthenticatedAgent({
      role: USER_ROLES.ADMIN,
    });

    const adminResponse = await adminAgent
      .get(`${adminProductUrl}/inventory-ledger`)
      .expect(200);

    expect(adminResponse.body.success).toBe(true);

    expect(adminResponse.body.data.inventoryLedger).toEqual([]);

    expect(adminResponse.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      totalItems: 0,
      totalPages: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  /*
|--------------------------------------------------------------------------
| Inventory Ledger Pagination and Sorting
|--------------------------------------------------------------------------
*/

  it("paginates and sorts Inventory Ledger entries", async () => {
    const { agent } = await createAuthenticatedAgent();

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Ledger Pagination Products",

      slug: "ledger-pagination-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const { product, variant } = await createInventoryLedgerTestProduct({
      agent,

      categoryId: category.id,

      name: "Ledger Pagination Product",

      slug: "ledger-pagination-product",

      sku: "LEDGER-PAGINATION-M",

      stock: 10,
      reservedStock: 2,
    });

    /*
    |--------------------------------------------------------------------------
    | Create Four Ledger Entries
    |--------------------------------------------------------------------------
    |
    | 1. Adjust
    | 2. Reserve
    | 3. Release
    | 4. Commit
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl(product.id, variant.id))
      .send({
        quantityDelta: 5,
        reason: "restock",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(product.id, variant.id, "reserve"))
      .send({
        quantity: 4,
        referenceId: "ORDER-PAGINATION-001",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(product.id, variant.id, "release"))
      .send({
        quantity: 2,
        referenceId: "ORDER-PAGINATION-001",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(product.id, variant.id, "commit"))
      .send({
        quantity: 3,
        referenceId: "ORDER-PAGINATION-001",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Ascending — Page One
    |--------------------------------------------------------------------------
    */

    const ascendingPageOneResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        page: 1,
        limit: 2,
        sortDirection: "asc",
      })
      .expect(200);

    expect(
      ascendingPageOneResponse.body.data.inventoryLedger.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["adjust", "reserve"]);

    expect(ascendingPageOneResponse.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      totalItems: 4,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    /*
    |--------------------------------------------------------------------------
    | Ascending — Page Two
    |--------------------------------------------------------------------------
    */

    const ascendingPageTwoResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        page: 2,
        limit: 2,
        sortDirection: "asc",
      })
      .expect(200);

    expect(
      ascendingPageTwoResponse.body.data.inventoryLedger.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["release", "commit"]);

    expect(ascendingPageTwoResponse.body.data.pagination).toEqual({
      page: 2,
      limit: 2,
      totalItems: 4,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });

    /*
    |--------------------------------------------------------------------------
    | Descending — Page One
    |--------------------------------------------------------------------------
    */

    const descendingResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        page: 1,
        limit: 2,
        sortDirection: "desc",
      })
      .expect(200);

    expect(
      descendingResponse.body.data.inventoryLedger.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["commit", "release"]);
  });

  /*
|--------------------------------------------------------------------------
| Inventory Ledger Filters
|--------------------------------------------------------------------------
*/

  it("filters Inventory Ledger entries by Product, variant, operation, reference, actor, and date range", async () => {
    const { agent, user } = await createAuthenticatedAgent();

    const actorId = String(user._id ?? user.id);

    const categoryResponse = await createCategoryRequest(agent, {
      name: "Ledger Filter Products",

      slug: "ledger-filter-products",

      status: "active",
    }).expect(201);

    const category = categoryResponse.body.data.category;

    const firstResult = await createInventoryLedgerTestProduct({
      agent,

      categoryId: category.id,

      name: "First Ledger Filter Product",

      slug: "first-ledger-filter-product",

      sku: "LEDGER-FILTER-FIRST-M",

      stock: 10,
      reservedStock: 2,
    });

    const secondResult = await createInventoryLedgerTestProduct({
      agent,

      categoryId: category.id,

      name: "Second Ledger Filter Product",

      slug: "second-ledger-filter-product",

      sku: "LEDGER-FILTER-SECOND-M",

      stock: 8,
      reservedStock: 0,
    });

    const firstProduct = firstResult.product;

    const firstVariant = firstResult.variant;

    const secondProduct = secondResult.product;

    const secondVariant = secondResult.variant;

    const rangeStart = new Date(Date.now() - 2_000).toISOString();

    /*
    |--------------------------------------------------------------------------
    | First Product — Four Entries
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl(firstProduct.id, firstVariant.id))
      .send({
        quantityDelta: 5,
        reason: "restock",
        note: "First Product delivery",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(firstProduct.id, firstVariant.id, "reserve"))
      .send({
        quantity: 3,
        referenceId: "ORDER-FILTER-FIRST",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(firstProduct.id, firstVariant.id, "release"))
      .send({
        quantity: 1,
        referenceId: "ORDER-FILTER-FIRST",
      })
      .expect(200);

    await agent
      .post(createInventoryUrl(firstProduct.id, firstVariant.id, "commit"))
      .send({
        quantity: 2,
        referenceId: "ORDER-FILTER-FIRST",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Second Product — One Entry
    |--------------------------------------------------------------------------
    */

    await agent
      .patch(createInventoryUrl(secondProduct.id, secondVariant.id))
      .send({
        quantityDelta: 2,
        reason: "correction",
        note: "Second Product correction",
      })
      .expect(200);

    const rangeEnd = new Date(Date.now() + 2_000).toISOString();

    /*
    |--------------------------------------------------------------------------
    | Product Filter
    |--------------------------------------------------------------------------
    */

    const productFilterResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        product: firstProduct.id,

        sortDirection: "asc",
      })
      .expect(200);

    expect(productFilterResponse.body.data.inventoryLedger).toHaveLength(4);

    expect(
      productFilterResponse.body.data.inventoryLedger.every((entry) => {
        return entry.productId === firstProduct.id;
      }),
    ).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Variant Filter
    |--------------------------------------------------------------------------
    */

    const variantFilterResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        variantId: secondVariant.id,
      })
      .expect(200);

    expect(variantFilterResponse.body.data.inventoryLedger).toHaveLength(1);

    expect(variantFilterResponse.body.data.inventoryLedger[0].variantId).toBe(
      secondVariant.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Operation Filter
    |--------------------------------------------------------------------------
    */

    const operationFilterResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        operation: "reserve",
      })
      .expect(200);

    expect(operationFilterResponse.body.data.inventoryLedger).toHaveLength(1);

    expect(operationFilterResponse.body.data.inventoryLedger[0].operation).toBe(
      "reserve",
    );

    /*
    |--------------------------------------------------------------------------
    | Reference Filter
    |--------------------------------------------------------------------------
    */

    const referenceFilterResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        referenceId: "ORDER-FILTER-FIRST",

        sortDirection: "asc",
      })
      .expect(200);

    expect(
      referenceFilterResponse.body.data.inventoryLedger.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "release", "commit"]);

    /*
    |--------------------------------------------------------------------------
    | Actor Filter
    |--------------------------------------------------------------------------
    */

    const actorFilterResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        actor: actorId,
      })
      .expect(200);

    expect(actorFilterResponse.body.data.inventoryLedger).toHaveLength(5);

    expect(
      actorFilterResponse.body.data.inventoryLedger.every((entry) => {
        return entry.actorId === actorId;
      }),
    ).toBe(true);

    /*
    |--------------------------------------------------------------------------
    | Inclusive Date-Time Range
    |--------------------------------------------------------------------------
    */

    const dateRangeResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        from: rangeStart,

        to: rangeEnd,
      })
      .expect(200);

    expect(dateRangeResponse.body.data.inventoryLedger).toHaveLength(5);

    /*
    |--------------------------------------------------------------------------
    | Historical Date Range with No Matches
    |--------------------------------------------------------------------------
    */

    const emptyDateRangeResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        from: "2000-01-01",

        to: "2000-01-02",
      })
      .expect(200);

    expect(emptyDateRangeResponse.body.data.inventoryLedger).toEqual([]);

    expect(emptyDateRangeResponse.body.data.pagination.totalItems).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Combined Filters
    |--------------------------------------------------------------------------
    */

    const combinedResponse = await agent
      .get(`${adminProductUrl}/inventory-ledger`)
      .query({
        product: firstProduct.id,

        variantId: firstVariant.id,

        operation: "commit",

        referenceId: "ORDER-FILTER-FIRST",

        actor: actorId,

        from: rangeStart,

        to: rangeEnd,
      })
      .expect(200);

    expect(combinedResponse.body.data.inventoryLedger).toHaveLength(1);

    const combinedEntry = combinedResponse.body.data.inventoryLedger[0];

    expect(combinedEntry).toMatchObject({
      productId: firstProduct.id,

      variantId: firstVariant.id,

      operation: "commit",

      referenceId: "ORDER-FILTER-FIRST",

      actorId,
    });

    /*
    |--------------------------------------------------------------------------
    | Mapper Fields
    |--------------------------------------------------------------------------
    */

    expect(combinedEntry.changes).toEqual({
      stockDelta: -2,
      reservedStockDelta: -2,
      availableStockDelta: 0,
    });

    expect(new Date(combinedEntry.createdAt).toString()).not.toBe(
      "Invalid Date",
    );
  });
  /*
|--------------------------------------------------------------------------
| Inventory Ledger Query Validation
|--------------------------------------------------------------------------
*/

  it("rejects invalid Inventory Ledger query parameters", async () => {
    const { agent } = await createAuthenticatedAgent();

    const ledgerUrl = `${adminProductUrl}/inventory-ledger`;

    const invalidQueries = [
      {
        page: 0,
      },

      {
        page: "abc",
      },

      {
        limit: 0,
      },

      {
        limit: 101,
      },

      {
        operation: "sale",
      },

      {
        product: "invalid-product-id",
      },

      {
        variantId: "invalid-variant-id",
      },

      {
        actor: "invalid-actor-id",
      },

      {
        referenceId: "   ",
      },

      {
        from: "31-07-2026",
      },

      {
        from: "2026-02-30",
      },

      {
        from: "2026-08-03",

        to: "2026-08-01",
      },

      {
        sortDirection: "newest",
      },

      {
        unknown: "value",
      },
    ];

    for (const query of invalidQueries) {
      const response = await agent.get(ledgerUrl).query(query).expect(400);

      expect(response.body.success).toBe(false);
    }
  });
});

/*
|--------------------------------------------------------------------------
| Part 212 — Product Master-Data Dependencies
|--------------------------------------------------------------------------
*/

describe("Product master-data dependencies", () => {
  /*
    |--------------------------------------------------------------------------
    | Complete Dependency Creation
    |--------------------------------------------------------------------------
    */

  it("creates an active Product with Brand, SizeGuide and Collections", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const sizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: category.id,
    });

    const collection = await createProductDependencyCollection(adminAgent);

    const requestBody = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: brand.id,

      sizeGuideId: sizeGuide.id,

      collectionIds: [collection.id],
    });

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(requestBody)
      .expect(201);

    const product = createResponse.body.data.product;

    expect(product.id).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Admin Detail Must Populate Dependencies
        |--------------------------------------------------------------------------
        */

    const detailResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    const detailedProduct = detailResponse.body.data.product;

    expect(detailedProduct.brand.id).toBe(brand.id);

    expect(detailedProduct.brand.name).toBe(brand.name);

    expect(detailedProduct.sizeGuide.id).toBe(sizeGuide.id);

    expect(detailedProduct.collections).toHaveLength(1);

    expect(detailedProduct.collections[0].id).toBe(collection.id);
  });

  it("rejects the old String Brand format", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const requestBody = createProductDependencyRequestBody({
      categoryId: category.id,

      /*
       * Temporarily valid ObjectId;
       * overridden below.
       */
      brandId: new mongoose.Types.ObjectId(),
    });

    requestBody.brand = "Aayu & Aura";

    const response = await adminAgent.post(adminProductUrl).send(requestBody);

    expect(response.status).toBe(400);
  });

  it("rejects an active Product using an inactive Brand", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent, {
      status: "inactive",
    });

    const response = await adminAgent.post(adminProductUrl).send(
      createProductDependencyRequestBody({
        categoryId: category.id,

        brandId: brand.id,

        status: "active",
      }),
    );

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("PRODUCT_BRAND_INACTIVE");
  });

  it("rejects a SizeGuide from an unrelated Category", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const productCategory = await createProductDependencyCategory(adminAgent);

    const unrelatedCategory = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const sizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: unrelatedCategory.id,
    });

    const response = await adminAgent.post(adminProductUrl).send(
      createProductDependencyRequestBody({
        categoryId: productCategory.id,

        brandId: brand.id,

        sizeGuideId: sizeGuide.id,
      }),
    );

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "PRODUCT_SIZE_GUIDE_CATEGORY_MISMATCH",
    );
  });

  it("rejects a Product referencing a missing Collection", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const missingCollectionId = new mongoose.Types.ObjectId();

    const response = await adminAgent.post(adminProductUrl).send(
      createProductDependencyRequestBody({
        categoryId: category.id,

        brandId: brand.id,

        collectionIds: [missingCollectionId],
      }),
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("PRODUCT_COLLECTION_NOT_FOUND");
  });

  it("hides an active Product publicly when its Brand becomes inactive", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const requestBody = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: brand.id,
    });

    await adminAgent.post(adminProductUrl).send(requestBody).expect(201);

    /*
     * Initially publicly available.
     */

    await request(app)
      .get(`${publicProductUrl}/${requestBody.slug}`)
      .expect(200);

    /*
     * Disable Brand after Product publication.
     */

    await adminAgent
      .patch(`${adminBrandUrl}/${brand.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
     * Product must disappear defensively.
     */

    const hiddenResponse = await request(app).get(
      `${publicProductUrl}/${requestBody.slug}`,
    );

    expect(hiddenResponse.status).toBe(404);

    expect(hiddenResponse.body.errorCode).toBe("PRODUCT_NOT_FOUND");
  });

  it("filters admin Products by Brand, SizeGuide and Collection", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
    |--------------------------------------------------------------------------
    | Category
    |--------------------------------------------------------------------------
    */

    const category = await createProductDependencyCategory(adminAgent);

    /*
    |--------------------------------------------------------------------------
    | Brands
    |--------------------------------------------------------------------------
    */

    const firstBrand = await createProductDependencyBrand(adminAgent, {
      name: "Filter Alpha Brand",

      slug: "filter-alpha-brand",
    });

    const secondBrand = await createProductDependencyBrand(adminAgent, {
      name: "Filter Beta Brand",

      slug: "filter-beta-brand",
    });

    /*
    |--------------------------------------------------------------------------
    | Size Guide
    |--------------------------------------------------------------------------
    */

    const sizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: category.id,
    });

    /*
    |--------------------------------------------------------------------------
    | Collection
    |--------------------------------------------------------------------------
    */

    const collection = await createProductDependencyCollection(adminAgent, {
      name: "Filter Summer Collection",

      slug: "filter-summer-collection",
    });

    /*
    |--------------------------------------------------------------------------
    | Product One
    |--------------------------------------------------------------------------
    |
    | Brand      = Alpha
    | SizeGuide  = assigned
    | Collection = assigned
    |--------------------------------------------------------------------------
    */

    const firstRequest = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: firstBrand.id,

      sizeGuideId: sizeGuide.id,

      collectionIds: [collection.id],

      overrides: {
        name: "Alpha Filter Product",

        slug: "alpha-filter-product",
      },
    });

    const firstResponse = await adminAgent
      .post(adminProductUrl)
      .send(firstRequest)
      .expect(201);

    const firstProduct = firstResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Product Two
    |--------------------------------------------------------------------------
    |
    | Brand      = Beta
    | SizeGuide  = null
    | Collection = none
    |--------------------------------------------------------------------------
    */

    const secondRequest = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: secondBrand.id,

      overrides: {
        name: "Beta Filter Product",

        slug: "beta-filter-product",
      },
    });

    const secondResponse = await adminAgent
      .post(adminProductUrl)
      .send(secondRequest)
      .expect(201);

    const secondProduct = secondResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Brand Filter
    |--------------------------------------------------------------------------
    */

    const brandResponse = await adminAgent
      .get(`${adminProductUrl}?brand=${firstBrand.id}`)
      .expect(200);

    expect(brandResponse.body.data.products).toHaveLength(1);

    expect(brandResponse.body.data.products[0].id).toBe(firstProduct.id);

    /*
    |--------------------------------------------------------------------------
    | SizeGuide Filter
    |--------------------------------------------------------------------------
    */

    const sizeGuideResponse = await adminAgent
      .get(`${adminProductUrl}?sizeGuide=${sizeGuide.id}`)
      .expect(200);

    expect(sizeGuideResponse.body.data.products).toHaveLength(1);

    expect(sizeGuideResponse.body.data.products[0].id).toBe(firstProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Collection Filter
    |--------------------------------------------------------------------------
    */

    const collectionResponse = await adminAgent
      .get(`${adminProductUrl}?collection=${collection.id}`)
      .expect(200);

    expect(collectionResponse.body.data.products).toHaveLength(1);

    expect(collectionResponse.body.data.products[0].id).toBe(firstProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Defensive Check
    |--------------------------------------------------------------------------
    */

    expect(
      brandResponse.body.data.products.map((product) => product.id),
    ).not.toContain(secondProduct.id);
  });

  it("searches admin and public Products by Brand name", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const searchableBrand = await createProductDependencyBrand(adminAgent, {
      name: "Aurora Heritage",

      slug: "aurora-heritage",
    });

    const otherBrand = await createProductDependencyBrand(adminAgent, {
      name: "Urban Thread",

      slug: "urban-thread",
    });

    /*
    |--------------------------------------------------------------------------
    | Aurora Product
    |--------------------------------------------------------------------------
    */

    const auroraRequest = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: searchableBrand.id,

      overrides: {
        /*
         * Deliberately do NOT put Aurora
         * in Product name, slug, SKU or tags.
         *
         * Search must succeed only through Brand.
         */
        name: "Classic Cotton Piece",

        slug: "classic-cotton-piece",

        tags: ["cotton"],
      },
    });

    const auroraResponse = await adminAgent
      .post(adminProductUrl)
      .send(auroraRequest)
      .expect(201);

    const auroraProduct = auroraResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Other Product
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: otherBrand.id,

          overrides: {
            name: "Regular Linen Piece",

            slug: "regular-linen-piece",

            tags: ["linen"],
          },
        }),
      )
      .expect(201);

    /*
    |--------------------------------------------------------------------------
    | Admin Search
    |--------------------------------------------------------------------------
    */

    const adminSearchResponse = await adminAgent
      .get(`${adminProductUrl}?search=Aurora`)
      .expect(200);

    expect(adminSearchResponse.body.data.products).toHaveLength(1);

    expect(adminSearchResponse.body.data.products[0].id).toBe(auroraProduct.id);

    /*
    |--------------------------------------------------------------------------
    | Public Search
    |--------------------------------------------------------------------------
    */

    const publicSearchResponse = await request(app)
      .get(`${publicProductUrl}?search=Aurora`)
      .expect(200);

    expect(publicSearchResponse.body.data.products).toHaveLength(1);

    expect(publicSearchResponse.body.data.products[0].id).toBe(
      auroraProduct.id,
    );

    expect(publicSearchResponse.body.data.products[0].brand.name).toBe(
      "Aurora Heritage",
    );
  });

  it("sorts admin Products alphabetically by Brand name", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    /*
    |--------------------------------------------------------------------------
    | Intentionally Create Brands Out of Alphabetical Order
    |--------------------------------------------------------------------------
    */

    const zuluBrand = await createProductDependencyBrand(adminAgent, {
      name: "Zulu Fashion",

      slug: "zulu-fashion",
    });

    const alphaBrand = await createProductDependencyBrand(adminAgent, {
      name: "Alpha Apparel",

      slug: "alpha-apparel",
    });

    const mangoBrand = await createProductDependencyBrand(adminAgent, {
      name: "Mango Studio",

      slug: "mango-studio",
    });

    /*
    |--------------------------------------------------------------------------
    | Products
    |--------------------------------------------------------------------------
    */

    const brandProducts = [
      {
        brand: zuluBrand,

        name: "Zulu Product",

        slug: "zulu-brand-product",
      },

      {
        brand: alphaBrand,

        name: "Alpha Product",

        slug: "alpha-brand-product",
      },

      {
        brand: mangoBrand,

        name: "Mango Product",

        slug: "mango-brand-product",
      },
    ];

    for (const item of brandProducts) {
      await adminAgent
        .post(adminProductUrl)
        .send(
          createProductDependencyRequestBody({
            categoryId: category.id,

            brandId: item.brand.id,

            overrides: {
              name: item.name,

              slug: item.slug,
            },
          }),
        )
        .expect(201);
    }

    /*
    |--------------------------------------------------------------------------
    | Ascending Brand Sort
    |--------------------------------------------------------------------------
    */

    const ascendingResponse = await adminAgent
      .get(`${adminProductUrl}?sortBy=brand&sortDirection=asc`)
      .expect(200);

    expect(
      ascendingResponse.body.data.products.map((product) => product.brand.name),
    ).toEqual(["Alpha Apparel", "Mango Studio", "Zulu Fashion"]);

    /*
    |--------------------------------------------------------------------------
    | Descending Brand Sort
    |--------------------------------------------------------------------------
    */

    const descendingResponse = await adminAgent
      .get(`${adminProductUrl}?sortBy=brand&sortDirection=desc`)
      .expect(200);

    expect(
      descendingResponse.body.data.products.map(
        (product) => product.brand.name,
      ),
    ).toEqual(["Zulu Fashion", "Mango Studio", "Alpha Apparel"]);
  });
  it("filters public Products by Brand ID", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const firstBrand = await createProductDependencyBrand(adminAgent);

    const secondBrand = await createProductDependencyBrand(adminAgent);

    const firstResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: firstBrand.id,

          overrides: {
            name: "Public First Brand Product",

            slug: "public-first-brand-product",
          },
        }),
      )
      .expect(201);

    const firstProduct = firstResponse.body.data.product;

    await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: secondBrand.id,

          overrides: {
            name: "Public Second Brand Product",

            slug: "public-second-brand-product",
          },
        }),
      )
      .expect(201);

    const response = await request(app)
      .get(`${publicProductUrl}?brand=${firstBrand.id}`)
      .expect(200);

    expect(response.body.data.products).toHaveLength(1);

    expect(response.body.data.products[0].id).toBe(firstProduct.id);

    expect(response.body.data.products[0].brand.id).toBe(firstBrand.id);
  });

  it("keeps a Product public when its Collection becomes inactive but excludes it from that Collection filter", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const collection = await createProductDependencyCollection(adminAgent, {
      name: "Seasonal Edit",

      slug: "seasonal-edit",
    });

    const requestBody = createProductDependencyRequestBody({
      categoryId: category.id,

      brandId: brand.id,

      collectionIds: [collection.id],

      overrides: {
        name: "Seasonal Public Product",

        slug: "seasonal-public-product",
      },
    });

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(requestBody)
      .expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Initially Public Through Collection
    |--------------------------------------------------------------------------
    */

    const initialCollectionResponse = await request(app)
      .get(`${publicProductUrl}?collection=${collection.id}`)
      .expect(200);

    expect(initialCollectionResponse.body.data.products).toHaveLength(1);

    expect(initialCollectionResponse.body.data.products[0].id).toBe(product.id);

    /*
    |--------------------------------------------------------------------------
    | Disable Collection
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .patch(`${adminCollectionUrl}/${collection.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Product Itself Remains Public
    |--------------------------------------------------------------------------
    */

    const publicDetailResponse = await request(app)
      .get(`${publicProductUrl}/${requestBody.slug}`)
      .expect(200);

    expect(publicDetailResponse.body.data.product.id).toBe(product.id);

    /*
     * Inactive Collection must not be exposed.
     */

    expect(publicDetailResponse.body.data.product.collections).toEqual([]);

    /*
    |--------------------------------------------------------------------------
    | Public Collection Filter No Longer Matches
    |--------------------------------------------------------------------------
    */

    const filteredResponse = await request(app)
      .get(`${publicProductUrl}?collection=${collection.id}`)
      .expect(200);

    expect(filteredResponse.body.data.products).toEqual([]);

    expect(filteredResponse.body.data.pagination.totalItems).toBe(0);
  });

  it("rejects changing an active Product to an inactive Brand and preserves the original Brand", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const activeBrand = await createProductDependencyBrand(adminAgent, {
      name: "Original Active Brand",

      slug: "original-active-brand",
    });

    const inactiveBrand = await createProductDependencyBrand(adminAgent, {
      name: "Inactive Replacement Brand",

      slug: "inactive-replacement-brand",

      status: "inactive",
    });

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: activeBrand.id,

          overrides: {
            name: "Brand Update Product",

            slug: "brand-update-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Invalid Brand Update
    |--------------------------------------------------------------------------
    */

    const updateResponse = await adminAgent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        brand: inactiveBrand.id,
      });

    expect(updateResponse.status).toBe(409);

    expect(updateResponse.body.errorCode).toBe("PRODUCT_BRAND_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Original Brand Must Remain
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.brand.id).toBe(activeBrand.id);
  });

  it("rejects assigning an inactive SizeGuide to an active Product but allows removing the SizeGuide", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    /*
    |--------------------------------------------------------------------------
    | Initial Active SizeGuide
    |--------------------------------------------------------------------------
    */

    const activeSizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: category.id,

      name: "Active Product Size Guide",

      slug: "active-product-size-guide",
    });

    /*
    |--------------------------------------------------------------------------
    | Inactive SizeGuide
    |--------------------------------------------------------------------------
    */

    const inactiveSizeGuide = await createProductDependencySizeGuide(
      adminAgent,
      {
        category: category.id,

        name: "Inactive Product Size Guide",

        slug: "inactive-product-size-guide",

        status: "inactive",
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Create Active Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: brand.id,

          sizeGuideId: activeSizeGuide.id,

          overrides: {
            name: "Size Guide Update Product",

            slug: "size-guide-update-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Inactive SizeGuide Must Be Rejected
    |--------------------------------------------------------------------------
    */

    const invalidResponse = await adminAgent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        sizeGuide: inactiveSizeGuide.id,
      });

    expect(invalidResponse.status).toBe(409);

    expect(invalidResponse.body.errorCode).toBe("PRODUCT_SIZE_GUIDE_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Existing SizeGuide Must Remain
    |--------------------------------------------------------------------------
    */

    const unchangedResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(unchangedResponse.body.data.product.sizeGuide.id).toBe(
      activeSizeGuide.id,
    );

    /*
    |--------------------------------------------------------------------------
    | Removing SizeGuide Is Allowed
    |--------------------------------------------------------------------------
    |
    | SizeGuide is optional.
    |--------------------------------------------------------------------------
    */

    const clearResponse = await adminAgent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        sizeGuide: null,
      })
      .expect(200);

    expect(clearResponse.body.data.product.sizeGuide).toBeNull();
  });

  it("rejects changing a Product to a SizeGuide from an unrelated Category", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const productCategory = await createProductDependencyCategory(adminAgent);

    const unrelatedCategory = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const validSizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: productCategory.id,
    });

    const invalidSizeGuide = await createProductDependencySizeGuide(
      adminAgent,
      {
        category: unrelatedCategory.id,
      },
    );

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: productCategory.id,

          brandId: brand.id,

          sizeGuideId: validSizeGuide.id,

          overrides: {
            name: "Size Guide Category Product",

            slug: "size-guide-category-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    const response = await adminAgent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        sizeGuide: invalidSizeGuide.id,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "PRODUCT_SIZE_GUIDE_CATEGORY_MISMATCH",
    );

    const detailsResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.sizeGuide.id).toBe(
      validSizeGuide.id,
    );
  });

  it("rejects updating a Product with a missing Collection and preserves its existing Collections", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const collection = await createProductDependencyCollection(adminAgent);

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: brand.id,

          collectionIds: [collection.id],

          overrides: {
            name: "Collection Update Product",

            slug: "collection-update-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    const missingCollectionId = new mongoose.Types.ObjectId().toString();

    /*
    |--------------------------------------------------------------------------
    | Invalid Collection Update
    |--------------------------------------------------------------------------
    */

    const response = await adminAgent
      .patch(`${adminProductUrl}/${product.id}`)
      .send({
        collections: [missingCollectionId],
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("PRODUCT_COLLECTION_NOT_FOUND");

    /*
    |--------------------------------------------------------------------------
    | Existing Collection Must Remain
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.collections).toHaveLength(1);

    expect(detailsResponse.body.data.product.collections[0].id).toBe(
      collection.id,
    );
  });

  it("rejects restoring an active Product when its Brand became inactive while deleted", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    /*
    |--------------------------------------------------------------------------
    | Active Product
    |--------------------------------------------------------------------------
    */

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: brand.id,

          overrides: {
            name: "Restore Brand Product",

            slug: "restore-brand-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Delete Product
    |--------------------------------------------------------------------------
    */

    await adminAgent.delete(`${adminProductUrl}/${product.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | Brand Becomes Inactive While Product Is Deleted
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .patch(`${adminBrandUrl}/${brand.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Restore Must Fail
    |--------------------------------------------------------------------------
    */

    const restoreResponse = await adminAgent.patch(
      `${adminProductUrl}/${product.id}/restore`,
    );

    expect(restoreResponse.status).toBe(409);

    expect(restoreResponse.body.errorCode).toBe("PRODUCT_BRAND_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Product Must Remain Deleted
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.isDeleted).toBe(true);
  });

  it("rejects restoring an active Product when its SizeGuide became inactive while deleted", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createProductDependencyCategory(adminAgent);

    const brand = await createProductDependencyBrand(adminAgent);

    const sizeGuide = await createProductDependencySizeGuide(adminAgent, {
      category: category.id,
    });

    const createResponse = await adminAgent
      .post(adminProductUrl)
      .send(
        createProductDependencyRequestBody({
          categoryId: category.id,

          brandId: brand.id,

          sizeGuideId: sizeGuide.id,

          overrides: {
            name: "Restore Size Guide Product",

            slug: "restore-size-guide-product",
          },
        }),
      )
      .expect(201);

    const product = createResponse.body.data.product;

    /*
    |--------------------------------------------------------------------------
    | Delete Product
    |--------------------------------------------------------------------------
    */

    await adminAgent.delete(`${adminProductUrl}/${product.id}`).expect(200);

    /*
    |--------------------------------------------------------------------------
    | SizeGuide Becomes Inactive
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .patch(`${adminSizeGuideUrl}/${sizeGuide.id}`)
      .send({
        status: "inactive",
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Restore Must Fail
    |--------------------------------------------------------------------------
    */

    const restoreResponse = await adminAgent.patch(
      `${adminProductUrl}/${product.id}/restore`,
    );

    expect(restoreResponse.status).toBe(409);

    expect(restoreResponse.body.errorCode).toBe("PRODUCT_SIZE_GUIDE_INACTIVE");

    /*
    |--------------------------------------------------------------------------
    | Product Remains Deleted
    |--------------------------------------------------------------------------
    */

    const detailsResponse = await adminAgent
      .get(`${adminProductUrl}/${product.id}`)
      .expect(200);

    expect(detailsResponse.body.data.product.isDeleted).toBe(true);
  });
});
