import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";
import { USER_ROLES } from "../../src/shared/constants/user.constants.js";
import Category from "../../src/modules/categories/category.model.js";

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

        brand: "Aayu & Aura",

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

    expect(updatedProduct.brand).toBe("Aayu & Aura");

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
});
