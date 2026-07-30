import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

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
});
