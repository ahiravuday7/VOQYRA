import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";
import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

const adminCategoryUrl = "/api/v1/admin/categories";

const adminProductUrl = "/api/v1/admin/products";

const publicProductUrl = "/api/v1/products";

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
| Product Payload Factory
|--------------------------------------------------------------------------
*/

const createProductPayload = (overrides = {}) => {
  return {
    name: "Classic Cotton T-Shirt",

    slug: "classic-cotton-tshirt",

    shortDescription: "Comfortable everyday cotton T-shirt.",

    description: "A regular-fit cotton T-shirt for everyday wear.",

    category: overrides.category,

    brand: "Aayu & Aura",

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
});
