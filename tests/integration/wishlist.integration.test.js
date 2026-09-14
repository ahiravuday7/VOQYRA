import mongoose from "mongoose";

import { WISHLIST_LIMITS } from "../../src/modules/wishlist/wishlist.constants.js";

import { describe, expect, it } from "vitest";

import request from "supertest";

import app from "../../src/app.js";

import Wishlist from "../../src/modules/wishlist/wishlist.model.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import Product from "../../src/modules/products/product.model.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

import Brand from "../../src/modules/brands/brand.model.js";

import Category from "../../src/modules/categories/category.model.js";

/*
|--------------------------------------------------------------------------
| URLs and Request Helpers
|--------------------------------------------------------------------------
*/

const wishlistUrl = "/api/v1/wishlist";

const sampleProductId = "507f1f77bcf86cd799439011";

const wishlistEndpoints = [
  ["get", wishlistUrl],
  ["post", `${wishlistUrl}/items`],
  ["delete", `${wishlistUrl}/items/${sampleProductId}`],
  ["delete", wishlistUrl],
];

const sendWishlistRequest = (client, method, url) => {
  const pendingRequest = client[method](url);

  if (method === "post") {
    return pendingRequest.send({
      productId: sampleProductId,
    });
  }

  return pendingRequest;
};

const createAuthenticatedCustomerAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });
};

/*
|--------------------------------------------------------------------------
| Product Fixtures
|--------------------------------------------------------------------------
*/

let fixtureSequence = 0;

const createActiveProductFixture = async (options = {}) => {
  const {
    stock = 10,
    reservedStock = 0,
    sellingPrice = 799,
    discountPrice = 699,
  } = options;

  const { agent } = await createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });

  fixtureSequence += 1;

  const suffix = fixtureSequence;

  const categoryResponse = await agent
    .post("/api/v1/admin/categories")
    .send({
      name: `Wishlist Test Category ${suffix}`,
      slug: `wishlist-test-category-${suffix}`,
      description: "Category used by Wishlist integration tests.",
      status: "active",
    })
    .expect(201);

  const brand = await createActiveBrandFixture();

  const name = `Wishlist Test Product ${suffix}`;
  const slug = `wishlist-test-product-${suffix}`;

  const productResponse = await agent
    .post("/api/v1/admin/products")
    .send({
      name,
      slug,

      shortDescription: "Wishlist integration test Product.",
      description: "An active Product used by Wishlist integration tests.",

      category: categoryResponse.body.data.category.id,
      brand: resolveProductBrandRequestValue(brand),

      materials: ["100% Cotton"],
      careInstructions: ["Machine wash cold"],
      countryOfOrigin: "India",
      tags: ["wishlist-test"],

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
          sku: `WISHLIST-TEST-${suffix}`,
          size: "M",

          color: {
            name: "Black",
            code: "#000000",
          },

          pricing: {
            buyingPrice: 300,
            sellingPrice,
            discountPrice,
            currency: "INR",
          },

          inventory: {
            stock,
            reservedStock,
            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],

      status: "active",
    })
    .expect(201);

  return Product.findById(productResponse.body.data.product.id).lean();
};

const addProductToWishlist = ({ agent, product, expectedStatus = 200 }) => {
  return agent
    .post(`${wishlistUrl}/items`)
    .send({
      productId: String(product._id),
    })
    .expect(expectedStatus);
};

/*
|--------------------------------------------------------------------------
| Wishlist Capacity Fixture
|--------------------------------------------------------------------------
*/

const createWishlistAtSize = ({
  user,
  itemCount = WISHLIST_LIMITS.MAX_ITEMS,
  productIds = [],
}) => {
  return Wishlist.create({
    user: user._id,

    items: Array.from({ length: itemCount }, (_, index) => ({
      product: productIds[index] ?? new mongoose.Types.ObjectId(),

      addedAt: new Date("2020-01-01T00:00:00.000Z"),
    })),
  });
};

/*
|--------------------------------------------------------------------------
| Customer Wishlist Integration Tests
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication — 4 tests
  |--------------------------------------------------------------------------
  */

  it.each(wishlistEndpoints)(
    "rejects unauthenticated requests: %s %s",
    async (method, url) => {
      const response = await sendWishlistRequest(
        request(app),
        method,
        url,
      ).expect(401);

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");

      expect(await Wishlist.countDocuments()).toBe(0);
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Customer Role — 4 tests
  |--------------------------------------------------------------------------
  */

  it.each(wishlistEndpoints)(
    "rejects authenticated admins: %s %s",
    async (method, url) => {
      const { agent } = await createAuthenticatedAgent({
        role: USER_ROLES.ADMIN,
      });

      const response = await sendWishlistRequest(agent, method, url).expect(
        403,
      );

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");

      expect(await Wishlist.countDocuments()).toBe(0);
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Empty Wishlist — 3 tests
  |--------------------------------------------------------------------------
  */

  it("returns an empty Wishlist without creating a document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent.get(wishlistUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Wishlist retrieved successfully");

    expect(response.body.data.wishlist).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    });

    expect(storedWishlist).toBeNull();
  });

  it("clears a nonexistent Wishlist without creating a document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent.delete(wishlistUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Wishlist cleared successfully");

    expect(response.body.data.wishlist).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    });

    expect(storedWishlist).toBeNull();
  });

  it("removes an unsaved Product without creating a Wishlist document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .delete(`${wishlistUrl}/items/${sampleProductId}`)
      .expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Product removed from Wishlist successfully",
    );

    expect(response.body.data.wishlist).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    });

    expect(storedWishlist).toBeNull();
  });
});

/*
|--------------------------------------------------------------------------
| Wishlist Additions
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - additions", () => {
  it("saves an active Product reference and returns current Product details", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const response = await addProductToWishlist({
      agent,
      product,
    });

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Product saved to Wishlist successfully",
    );

    const wishlist = response.body.data.wishlist;

    expect(wishlist.id).toBeTruthy();
    expect(wishlist.itemCount).toBe(1);
    expect(wishlist.items).toHaveLength(1);

    const item = wishlist.items[0];

    expect(item.productId).toBe(String(product._id));
    expect(item.addedAt).toEqual(expect.any(String));
    expect(item.isAvailable).toBe(true);

    expect(item.product.id).toBe(String(product._id));
    expect(item.product.name).toBe(product.name);
    expect(item.product.slug).toBe(product.slug);

    expect(item.product.primaryImage.url).toBe(product.images[0].url);

    expect(item.product.priceRange).toEqual({
      minimum: 699,
      maximum: 699,
      currency: "INR",
    });

    expect(item.product.availability.availableStock).toBe(8);
    expect(item.product.availability.isInStock).toBe(true);

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(String(storedWishlist._id)).toBe(wishlist.id);
    expect(storedWishlist.items).toHaveLength(1);

    expect(String(storedWishlist.items[0].product)).toBe(String(product._id));

    // Stored items contain references and timestamps only.
    expect(Object.keys(storedWishlist.items[0]).sort()).toEqual([
      "addedAt",
      "product",
    ]);

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory.stock).toBe(10);
    expect(refreshedProduct.variants[0].inventory.reservedStock).toBe(2);

    const serialized = JSON.stringify(wishlist);

    expect(serialized).not.toContain('"buyingPrice"');
    expect(serialized).not.toContain('"reservedStock"');
  });

  it("treats a duplicate addition as success and preserves addedAt", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const firstResponse = await addProductToWishlist({
      agent,
      product,
    });

    // Use an older timestamp so an accidental reset is detectable.
    const originalAddedAt = new Date("2020-01-01T00:00:00.000Z");

    await Wishlist.updateOne(
      { user: user._id },
      {
        $set: {
          "items.0.addedAt": originalAddedAt,
        },
      },
    );

    const response = await addProductToWishlist({
      agent,
      product,
    });

    const wishlist = response.body.data.wishlist;

    expect(wishlist.id).toBe(firstResponse.body.data.wishlist.id);
    expect(wishlist.itemCount).toBe(1);
    expect(wishlist.items).toHaveLength(1);

    expect(wishlist.items[0].addedAt).toBe(originalAddedAt.toISOString());

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist.items).toHaveLength(1);

    expect(storedWishlist.items[0].addedAt).toEqual(originalAddedAt);

    expect(await Wishlist.countDocuments({ user: user._id })).toBe(1);
  });

  it("keeps different Products as separate Wishlist entries", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    await addProductToWishlist({
      agent,
      product: firstProduct,
    });

    const response = await addProductToWishlist({
      agent,
      product: secondProduct,
    });

    const wishlist = response.body.data.wishlist;

    expect(wishlist.itemCount).toBe(2);
    expect(wishlist.items).toHaveLength(2);

    expect(wishlist.items.map((item) => item.productId).sort()).toEqual(
      [String(firstProduct._id), String(secondProduct._id)].sort(),
    );

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist.items).toHaveLength(2);
  });

  it("allows a Product with zero available stock without changing inventory", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 5,
      reservedStock: 5,
    });

    const response = await addProductToWishlist({
      agent,
      product,
    });

    const item = response.body.data.wishlist.items[0];

    expect(item.productId).toBe(String(product._id));
    expect(item.isAvailable).toBe(true);

    expect(item.product.availability.availableStock).toBe(0);
    expect(item.product.availability.isInStock).toBe(false);

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory.stock).toBe(5);
    expect(refreshedProduct.variants[0].inventory.reservedStock).toBe(5);
  });
});
/*
|--------------------------------------------------------------------------
| Wishlist Product Visibility
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - Product visibility", () => {
  it("rejects a missing Product without creating a Wishlist", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${wishlistUrl}/items`)
      .send({
        productId: sampleProductId,
      })
      .expect(404);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("WISHLIST_PRODUCT_NOT_FOUND");

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    });

    expect(storedWishlist).toBeNull();
  });

  it.each([
    [
      "inactive",
      () => ({
        status: "inactive",
      }),
    ],
    [
      "soft-deleted",
      () => ({
        deletedAt: new Date(),
      }),
    ],
    [
      "scheduled for future publication",
      () => ({
        publishedAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    ],
    [
      "unpublished",
      () => ({
        publishedAt: null,
      }),
    ],
  ])(
    "rejects a Product that is %s without creating a Wishlist",
    async (_description, createChanges) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      // Change visibility after creating a valid Product fixture.
      const updateResult = await Product.updateOne(
        {
          _id: product._id,
        },
        {
          $set: createChanges(),
        },
      );

      expect(updateResult.matchedCount).toBe(1);
      expect(updateResult.modifiedCount).toBe(1);

      const response = await addProductToWishlist({
        agent,
        product,
        expectedStatus: 404,
      });

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("WISHLIST_PRODUCT_NOT_FOUND");

      const storedWishlist = await Wishlist.findOne({
        user: user._id,
      });

      expect(storedWishlist).toBeNull();

      const refreshedProduct = await Product.findById(product._id).lean();

      expect(refreshedProduct.variants[0].inventory.stock).toBe(
        product.variants[0].inventory.stock,
      );

      expect(refreshedProduct.variants[0].inventory.reservedStock).toBe(
        product.variants[0].inventory.reservedStock,
      );
    },
  );
});

/*
|--------------------------------------------------------------------------
| Wishlist Master Data Visibility
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - Brand and Category visibility", () => {
  it.each([
    ["inactive Brand", Brand, "brand", () => ({ status: "inactive" })],
    ["soft-deleted Brand", Brand, "brand", () => ({ deletedAt: new Date() })],
    ["inactive Category", Category, "category", () => ({ status: "inactive" })],
    [
      "soft-deleted Category",
      Category,
      "category",
      () => ({ deletedAt: new Date() }),
    ],
  ])(
    "rejects a Product with an %s without creating a Wishlist",
    async (_description, DependencyModel, field, createChanges) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      // Confirm that the Product starts publicly visible.
      await agent.get(`/api/v1/products/${product.slug}`).expect(200);

      // Change only the referenced Brand or Category.
      const updateResult = await DependencyModel.updateOne(
        {
          _id: product[field],
        },
        {
          $set: createChanges(),
        },
      );

      expect(updateResult.matchedCount).toBe(1);
      expect(updateResult.modifiedCount).toBe(1);

      // The Product itself remains active and is not deleted.
      const refreshedProduct = await Product.findById(product._id).lean();

      expect(refreshedProduct.status).toBe("active");
      expect(refreshedProduct.deletedAt ?? null).toBeNull();

      const response = await addProductToWishlist({
        agent,
        product,
        expectedStatus: 404,
      });

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("WISHLIST_PRODUCT_NOT_FOUND");

      const storedWishlist = await Wishlist.findOne({
        user: user._id,
      });

      expect(storedWishlist).toBeNull();
    },
  );
});

/*
|--------------------------------------------------------------------------
| Stale Wishlist Entries and Recovery
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - stale entries and recovery", () => {
  it.each([
    ["Product", Product, "_id"],
    ["Brand", Brand, "brand"],
    ["Category", Category, "category"],
  ])(
    "preserves the saved entry when its %s becomes inactive and restores its details after reactivation",
    async (_description, TargetModel, field) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      const addResponse = await addProductToWishlist({
        agent,
        product,
      });

      const originalItem = addResponse.body.data.wishlist.items[0];

      const originalWishlist = await Wishlist.findOne({
        user: user._id,
      }).lean();

      const deactivateResult = await TargetModel.updateOne(
        { _id: product[field] },
        { $set: { status: "inactive" } },
      );

      expect(deactivateResult.modifiedCount).toBe(1);

      const unavailableResponse = await agent.get(wishlistUrl).expect(200);

      const unavailableWishlist = unavailableResponse.body.data.wishlist;

      expect(unavailableWishlist.id).toBe(String(originalWishlist._id));
      expect(unavailableWishlist.itemCount).toBe(1);

      expect(unavailableWishlist.items).toEqual([
        {
          productId: String(product._id),
          addedAt: originalItem.addedAt,
          isAvailable: false,
          product: null,
        },
      ]);

      // GET must preserve the stored reference and timestamps.
      const storedWhileUnavailable = await Wishlist.findOne({
        user: user._id,
      }).lean();

      expect(storedWhileUnavailable).toEqual(originalWishlist);

      const reactivateResult = await TargetModel.updateOne(
        { _id: product[field] },
        { $set: { status: "active" } },
      );

      expect(reactivateResult.modifiedCount).toBe(1);

      const recoveredResponse = await agent.get(wishlistUrl).expect(200);

      const recoveredWishlist = recoveredResponse.body.data.wishlist;

      expect(recoveredWishlist.itemCount).toBe(1);

      // Current details return without adding the Product again.
      expect(recoveredWishlist.items[0]).toEqual(originalItem);

      const storedAfterRecovery = await Wishlist.findOne({
        user: user._id,
      }).lean();

      expect(storedAfterRecovery).toEqual(originalWishlist);
    },
  );

  it("preserves the Product ID after permanent deletion without modifying the Wishlist on repeated GETs", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    const originalItem = addResponse.body.data.wishlist.items[0];

    const originalWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    // Simulate a reference whose Product document no longer exists.
    const deleteResult = await Product.collection.deleteOne({
      _id: product._id,
    });

    expect(deleteResult.deletedCount).toBe(1);

    const expectedWishlist = {
      id: String(originalWishlist._id),
      itemCount: 1,
      items: [
        {
          productId: String(product._id),
          addedAt: originalItem.addedAt,
          isAvailable: false,
          product: null,
        },
      ],
    };

    const firstGet = await agent.get(wishlistUrl).expect(200);
    const secondGet = await agent.get(wishlistUrl).expect(200);

    expect(firstGet.body.data.wishlist).toEqual(expectedWishlist);
    expect(secondGet.body.data.wishlist).toEqual(expectedWishlist);

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);
  });

  it("treats adding an already-saved inactive Product as a successful no-op", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToWishlist({
      agent,
      product,
    });

    const originalAddedAt = new Date("2020-01-01T00:00:00.000Z");

    await Wishlist.updateOne(
      { user: user._id },
      {
        $set: {
          "items.0.addedAt": originalAddedAt,
        },
      },
    );

    await Product.updateOne(
      { _id: product._id },
      { $set: { status: "inactive" } },
    );

    const originalWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    const response = await addProductToWishlist({
      agent,
      product,
      expectedStatus: 200,
    });

    expect(response.body.success).toBe(true);

    expect(response.body.data.wishlist).toEqual({
      id: String(originalWishlist._id),
      itemCount: 1,
      items: [
        {
          productId: String(product._id),
          addedAt: originalAddedAt.toISOString(),
          isAvailable: false,
          product: null,
        },
      ],
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);
  });
});

/*
|--------------------------------------------------------------------------
| Wishlist Removal and Clearing
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - removal and clearing", () => {
  it("removes only the requested Product and treats repeated removal as a no-op", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    await addProductToWishlist({
      agent,
      product: firstProduct,
    });

    const addResponse = await addProductToWishlist({
      agent,
      product: secondProduct,
    });

    const originalWishlist = addResponse.body.data.wishlist;

    const remainingItem = originalWishlist.items.find(
      (item) => item.productId === String(secondProduct._id),
    );

    const removeUrl = `${wishlistUrl}/items/${firstProduct._id}`;

    const response = await agent.delete(removeUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Product removed from Wishlist successfully",
    );

    expect(response.body.data.wishlist).toEqual({
      id: originalWishlist.id,
      items: [remainingItem],
      itemCount: 1,
    });

    const storedAfterRemoval = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedAfterRemoval.items).toHaveLength(1);

    expect(String(storedAfterRemoval.items[0].product)).toBe(
      String(secondProduct._id),
    );

    const repeatedResponse = await agent.delete(removeUrl).expect(200);

    expect(repeatedResponse.body.data.wishlist).toEqual(
      response.body.data.wishlist,
    );

    const storedAfterRepeat = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedAfterRepeat).toEqual(storedAfterRemoval);
  });

  it("keeps the Wishlist document when its final item is removed and preserves inventory", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    const wishlistId = addResponse.body.data.wishlist.id;

    const response = await agent
      .delete(`${wishlistUrl}/items/${product._id}`)
      .expect(200);

    expect(response.body.data.wishlist).toEqual({
      id: wishlistId,
      items: [],
      itemCount: 0,
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).not.toBeNull();
    expect(String(storedWishlist._id)).toBe(wishlistId);
    expect(storedWishlist.items).toEqual([]);

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory).toEqual(
      product.variants[0].inventory,
    );
  });

  it("removes a stale entry whose Product has been permanently deleted", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    const wishlistId = addResponse.body.data.wishlist.id;

    const deleteResult = await Product.collection.deleteOne({
      _id: product._id,
    });

    expect(deleteResult.deletedCount).toBe(1);

    // Use the preserved Product ID returned by GET for removal.
    const getResponse = await agent.get(wishlistUrl).expect(200);

    const staleItem = getResponse.body.data.wishlist.items[0];

    expect(staleItem.productId).toBe(String(product._id));
    expect(staleItem.isAvailable).toBe(false);
    expect(staleItem.product).toBeNull();

    const response = await agent
      .delete(`${wishlistUrl}/items/${staleItem.productId}`)
      .expect(200);

    expect(response.body.data.wishlist).toEqual({
      id: wishlistId,
      items: [],
      itemCount: 0,
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).not.toBeNull();
    expect(String(storedWishlist._id)).toBe(wishlistId);
    expect(storedWishlist.items).toEqual([]);
  });

  it("clears multiple items, keeps the document, preserves inventory, and allows repeated clearing", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const secondProduct = await createActiveProductFixture({
      stock: 5,
      reservedStock: 5,
    });

    await addProductToWishlist({
      agent,
      product: firstProduct,
    });

    const addResponse = await addProductToWishlist({
      agent,
      product: secondProduct,
    });

    expect(addResponse.body.data.wishlist.itemCount).toBe(2);

    const wishlistId = addResponse.body.data.wishlist.id;

    const response = await agent.delete(wishlistUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Wishlist cleared successfully");

    expect(response.body.data.wishlist).toEqual({
      id: wishlistId,
      items: [],
      itemCount: 0,
    });

    const storedAfterClear = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedAfterClear).not.toBeNull();
    expect(String(storedAfterClear._id)).toBe(wishlistId);
    expect(storedAfterClear.items).toEqual([]);

    for (const originalProduct of [firstProduct, secondProduct]) {
      const refreshedProduct = await Product.findById(
        originalProduct._id,
      ).lean();

      expect(refreshedProduct.variants[0].inventory).toEqual(
        originalProduct.variants[0].inventory,
      );
    }

    const repeatedResponse = await agent.delete(wishlistUrl).expect(200);

    expect(repeatedResponse.body.data.wishlist).toEqual(
      response.body.data.wishlist,
    );

    const storedAfterRepeat = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedAfterRepeat).toEqual(storedAfterClear);
  });
});

/*
|--------------------------------------------------------------------------
| Wishlist Customer Isolation
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - customer isolation", () => {
  it("returns only the authenticated customer's Wishlist", async () => {
    const firstCustomer = await createAuthenticatedCustomerAgent();
    const secondCustomer = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    const firstAdd = await addProductToWishlist({
      agent: firstCustomer.agent,
      product: firstProduct,
    });

    const secondAdd = await addProductToWishlist({
      agent: secondCustomer.agent,
      product: secondProduct,
    });

    const firstGet = await firstCustomer.agent.get(wishlistUrl).expect(200);

    const secondGet = await secondCustomer.agent.get(wishlistUrl).expect(200);

    const firstWishlist = firstGet.body.data.wishlist;
    const secondWishlist = secondGet.body.data.wishlist;

    expect(firstWishlist.id).toBe(firstAdd.body.data.wishlist.id);
    expect(secondWishlist.id).toBe(secondAdd.body.data.wishlist.id);

    expect(firstWishlist.id).not.toBe(secondWishlist.id);

    expect(firstWishlist.itemCount).toBe(1);
    expect(secondWishlist.itemCount).toBe(1);

    expect(firstWishlist.items.map((item) => item.productId)).toEqual([
      String(firstProduct._id),
    ]);

    expect(secondWishlist.items.map((item) => item.productId)).toEqual([
      String(secondProduct._id),
    ]);
  });

  it("allows two customers to save the same Product independently", async () => {
    const firstCustomer = await createAuthenticatedCustomerAgent();
    const secondCustomer = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const firstAdd = await addProductToWishlist({
      agent: firstCustomer.agent,
      product,
    });

    const secondAdd = await addProductToWishlist({
      agent: secondCustomer.agent,
      product,
    });

    expect(firstAdd.body.data.wishlist.id).not.toBe(
      secondAdd.body.data.wishlist.id,
    );

    for (const customer of [firstCustomer, secondCustomer]) {
      const storedWishlist = await Wishlist.findOne({
        user: customer.user._id,
      }).lean();

      expect(storedWishlist).not.toBeNull();

      expect(String(storedWishlist.user)).toBe(String(customer.user._id));

      expect(storedWishlist.items).toHaveLength(1);

      expect(String(storedWishlist.items[0].product)).toBe(String(product._id));

      expect(
        await Wishlist.countDocuments({
          user: customer.user._id,
        }),
      ).toBe(1);
    }

    expect(await Wishlist.countDocuments()).toBe(2);
  });

  it("does not remove another customer's saved Product", async () => {
    const firstCustomer = await createAuthenticatedCustomerAgent();
    const secondCustomer = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    const firstAdd = await addProductToWishlist({
      agent: firstCustomer.agent,
      product: firstProduct,
    });

    await addProductToWishlist({
      agent: secondCustomer.agent,
      product: secondProduct,
    });

    const firstBefore = await Wishlist.findOne({
      user: firstCustomer.user._id,
    }).lean();

    const secondBefore = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    // This Product exists only in the second customer's Wishlist.
    const response = await firstCustomer.agent
      .delete(`${wishlistUrl}/items/${secondProduct._id}`)
      .expect(200);

    expect(response.body.success).toBe(true);

    // The first customer's Wishlist remains unchanged.
    expect(response.body.data.wishlist).toEqual(firstAdd.body.data.wishlist);

    const firstAfter = await Wishlist.findOne({
      user: firstCustomer.user._id,
    }).lean();

    const secondAfter = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    expect(firstAfter).toEqual(firstBefore);
    expect(secondAfter).toEqual(secondBefore);
  });

  it("clears only the authenticated customer's Wishlist", async () => {
    const firstCustomer = await createAuthenticatedCustomerAgent();
    const secondCustomer = await createAuthenticatedCustomerAgent();

    // Both customers save the same Product.
    const product = await createActiveProductFixture();

    const firstAdd = await addProductToWishlist({
      agent: firstCustomer.agent,
      product,
    });

    const secondAdd = await addProductToWishlist({
      agent: secondCustomer.agent,
      product,
    });

    const secondBefore = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    const response = await firstCustomer.agent.delete(wishlistUrl).expect(200);

    expect(response.body.data.wishlist).toEqual({
      id: firstAdd.body.data.wishlist.id,
      items: [],
      itemCount: 0,
    });

    const firstAfter = await Wishlist.findOne({
      user: firstCustomer.user._id,
    }).lean();

    expect(firstAfter).not.toBeNull();

    expect(String(firstAfter._id)).toBe(firstAdd.body.data.wishlist.id);

    expect(firstAfter.items).toEqual([]);

    const secondAfter = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    expect(secondAfter).toEqual(secondBefore);

    const secondGet = await secondCustomer.agent.get(wishlistUrl).expect(200);

    expect(secondGet.body.data.wishlist).toEqual(secondAdd.body.data.wishlist);
  });
});
/*
|--------------------------------------------------------------------------
| Wishlist Request Validation
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - request validation", () => {
  it.each([
    ["missing productId", {}],
    ["malformed productId", { productId: "invalid" }],
    ["numeric productId", { productId: 123 }],
    [
      "unexpected userId",
      {
        productId: sampleProductId,
        userId: "507f1f77bcf86cd799439099",
      },
    ],
    [
      "unexpected variantId",
      {
        productId: sampleProductId,
        variantId: "507f1f77bcf86cd799439098",
      },
    ],
    [
      "unexpected quantity",
      {
        productId: sampleProductId,
        quantity: 1,
      },
    ],
  ])("rejects an add request with %s", async (_description, body) => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${wishlistUrl}/items`)
      .send(body)
      .expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(await Wishlist.countDocuments()).toBe(0);
  });

  it("rejects an invalid Product ID in the removal URL", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .delete(`${wishlistUrl}/items/invalid`)
      .expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(await Wishlist.countDocuments()).toBe(0);
  });

  it("rejects an unexpected userId query parameter without exposing another customer's Wishlist", async () => {
    const firstCustomer = await createAuthenticatedCustomerAgent();
    const secondCustomer = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToWishlist({
      agent: secondCustomer.agent,
      product,
    });

    const secondBefore = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    const response = await firstCustomer.agent
      .get(wishlistUrl)
      .query({
        userId: String(secondCustomer.user._id),
      })
      .expect(400);

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.data?.wishlist).toBeUndefined();

    const firstWishlist = await Wishlist.findOne({
      user: firstCustomer.user._id,
    });

    expect(firstWishlist).toBeNull();

    const secondAfter = await Wishlist.findOne({
      user: secondCustomer.user._id,
    }).lean();

    expect(secondAfter).toEqual(secondBefore);
  });
});

/*
|--------------------------------------------------------------------------
| Wishlist Item Limit
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - item limit", () => {
  it("allows adding a Product when exactly one slot remains", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seededWishlist = await createWishlistAtSize({
      user,
      itemCount: WISHLIST_LIMITS.MAX_ITEMS - 1,
    });

    const response = await addProductToWishlist({
      agent,
      product,
    });

    const wishlist = response.body.data.wishlist;

    expect(wishlist.id).toBe(String(seededWishlist._id));
    expect(wishlist.itemCount).toBe(WISHLIST_LIMITS.MAX_ITEMS);
    expect(wishlist.items).toHaveLength(WISHLIST_LIMITS.MAX_ITEMS);

    const addedItem = wishlist.items.find(
      (item) => item.productId === String(product._id),
    );

    expect(addedItem).toBeDefined();
    expect(addedItem.isAvailable).toBe(true);

    expect(wishlist.items.filter((item) => !item.isAvailable)).toHaveLength(
      WISHLIST_LIMITS.MAX_ITEMS - 1,
    );

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist.items).toHaveLength(WISHLIST_LIMITS.MAX_ITEMS);
  });

  it("rejects a new Product when stale entries already fill the Wishlist", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seededWishlist = await createWishlistAtSize({ user });

    const originalWishlist = seededWishlist.toObject();

    const response = await addProductToWishlist({
      agent,
      product,
      expectedStatus: 409,
    });

    expect(response.body.success).toBe(false);

    expect(response.body.errorCode).toBe("WISHLIST_ITEM_LIMIT_EXCEEDED");

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory).toEqual(
      product.variants[0].inventory,
    );
  });

  it.each(["active", "inactive"])(
    "allows a duplicate %s Product at capacity without modifying the Wishlist",
    async (status) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      const seededWishlist = await createWishlistAtSize({
        user,
        productIds: [product._id],
      });

      const originalWishlist = seededWishlist.toObject();

      if (status === "inactive") {
        const updateResult = await Product.updateOne(
          { _id: product._id },
          { $set: { status: "inactive" } },
        );

        expect(updateResult.modifiedCount).toBe(1);
      }

      const response = await addProductToWishlist({
        agent,
        product,
        expectedStatus: 200,
      });

      const wishlist = response.body.data.wishlist;

      expect(wishlist.itemCount).toBe(WISHLIST_LIMITS.MAX_ITEMS);
      expect(wishlist.items).toHaveLength(WISHLIST_LIMITS.MAX_ITEMS);

      const matchingItems = wishlist.items.filter(
        (item) => item.productId === String(product._id),
      );

      expect(matchingItems).toHaveLength(1);

      expect(matchingItems[0].addedAt).toBe(
        originalWishlist.items[0].addedAt.toISOString(),
      );

      expect(matchingItems[0].isAvailable).toBe(status === "active");

      if (status === "inactive") {
        expect(matchingItems[0].product).toBeNull();
      }

      const storedWishlist = await Wishlist.findOne({
        user: user._id,
      }).lean();

      expect(storedWishlist).toEqual(originalWishlist);
    },
  );

  it("allows a new Product after removing a stale entry from a full Wishlist", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seededWishlist = await createWishlistAtSize({ user });

    const removedProductId = String(seededWishlist.items[0].product);

    const removeResponse = await agent
      .delete(`${wishlistUrl}/items/${removedProductId}`)
      .expect(200);

    expect(removeResponse.body.data.wishlist.itemCount).toBe(
      WISHLIST_LIMITS.MAX_ITEMS - 1,
    );

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    const wishlist = addResponse.body.data.wishlist;

    expect(wishlist.id).toBe(String(seededWishlist._id));
    expect(wishlist.itemCount).toBe(WISHLIST_LIMITS.MAX_ITEMS);

    expect(
      wishlist.items.some((item) => item.productId === removedProductId),
    ).toBe(false);

    expect(
      wishlist.items.filter((item) => item.productId === String(product._id)),
    ).toHaveLength(1);

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist.items).toHaveLength(WISHLIST_LIMITS.MAX_ITEMS);

    expect(
      storedWishlist.items.some(
        (item) => String(item.product) === removedProductId,
      ),
    ).toBe(false);
  });
});

/*
|--------------------------------------------------------------------------
| Current Pricing, Stock, Variants, Ordering, and Database Uniqueness
|--------------------------------------------------------------------------
*/

describe("Customer Wishlist API - final behavior checks", () => {
  it("reflects current Product pricing without changing the stored Wishlist", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      sellingPrice: 799,
      discountPrice: 699,
    });

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    expect(addResponse.body.data.wishlist.items[0].product.priceRange).toEqual({
      minimum: 699,
      maximum: 699,
      currency: "INR",
    });

    const originalWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    const priceUpdate = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": product.variants[0]._id,
      },
      {
        $set: {
          "variants.$.pricing.sellingPrice": 1299,
          "variants.$.pricing.discountPrice": 999,
        },
      },
    );

    expect(priceUpdate.modifiedCount).toBe(1);

    const discountedResponse = await agent.get(wishlistUrl).expect(200);

    expect(
      discountedResponse.body.data.wishlist.items[0].product.priceRange,
    ).toEqual({
      minimum: 999,
      maximum: 999,
      currency: "INR",
    });

    // Removing the discount should expose the current selling price.
    const discountRemoval = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": product.variants[0]._id,
      },
      {
        $set: {
          "variants.$.pricing.discountPrice": null,
        },
      },
    );

    expect(discountRemoval.modifiedCount).toBe(1);

    const regularPriceResponse = await agent.get(wishlistUrl).expect(200);

    expect(
      regularPriceResponse.body.data.wishlist.items[0].product.priceRange,
    ).toEqual({
      minimum: 1299,
      maximum: 1299,
      currency: "INR",
    });

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);
  });

  it("reflects current stock and reservations without modifying inventory during GET", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    expect(
      addResponse.body.data.wishlist.items[0].product.availability
        .availableStock,
    ).toBe(8);

    const originalWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    // Simulate inventory changes made outside Wishlist.
    for (const state of [
      { stock: 6, reservedStock: 6, availableStock: 0 },
      { stock: 6, reservedStock: 1, availableStock: 5 },
    ]) {
      const updateResult = await Product.updateOne(
        {
          _id: product._id,
          "variants._id": product.variants[0]._id,
        },
        {
          $set: {
            "variants.$.inventory.stock": state.stock,
            "variants.$.inventory.reservedStock": state.reservedStock,
          },
        },
      );

      expect(updateResult.modifiedCount).toBe(1);

      const productBeforeGet = await Product.findById(product._id).lean();

      const response = await agent.get(wishlistUrl).expect(200);

      const item = response.body.data.wishlist.items[0];

      expect(item.isAvailable).toBe(true);

      expect(item.product.availability.availableStock).toBe(
        state.availableStock,
      );

      expect(item.product.availability.isInStock).toBe(
        state.availableStock > 0,
      );

      const productAfterGet = await Product.findById(product._id).lean();

      expect(productAfterGet).toEqual(productBeforeGet);
    }

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);
  });

  it("excludes a variant from current pricing and stock after it becomes inactive", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      sellingPrice: 799,
      discountPrice: 699,
      stock: 10,
      reservedStock: 2,
    });

    const originalVariant = product.variants[0];

    const secondVariant = {
      ...originalVariant,

      _id: new mongoose.Types.ObjectId(),

      sku: `${originalVariant.sku}-SECOND`,
      size: "L",

      pricing: {
        ...originalVariant.pricing,
        sellingPrice: 1199,
        discountPrice: 1099,
      },

      inventory: {
        ...originalVariant.inventory,
        stock: 20,
        reservedStock: 5,
      },

      isActive: true,
    };

    const addVariantResult = await Product.updateOne(
      { _id: product._id },
      {
        $push: {
          variants: secondVariant,
        },
      },
      { runValidators: true },
    );

    expect(addVariantResult.modifiedCount).toBe(1);

    const addResponse = await addProductToWishlist({
      agent,
      product,
    });

    const initialProduct = addResponse.body.data.wishlist.items[0].product;

    expect(initialProduct.priceRange).toEqual({
      minimum: 699,
      maximum: 1099,
      currency: "INR",
    });

    // First variant: 8 available. Second variant: 15 available.
    expect(initialProduct.availability.availableStock).toBe(23);

    const deactivateResult = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": originalVariant._id,
      },
      {
        $set: {
          "variants.$.isActive": false,
        },
      },
    );

    expect(deactivateResult.modifiedCount).toBe(1);

    const response = await agent.get(wishlistUrl).expect(200);

    const item = response.body.data.wishlist.items[0];

    expect(item.isAvailable).toBe(true);

    expect(item.product.priceRange).toEqual({
      minimum: 1099,
      maximum: 1099,
      currency: "INR",
    });

    expect(item.product.availability.availableStock).toBe(15);
    expect(item.product.availability.isInStock).toBe(true);

    const refreshedProduct = await Product.findById(product._id).lean();

    const inactiveVariant = refreshedProduct.variants.find(
      (variant) => String(variant._id) === String(originalVariant._id),
    );

    // Its inventory still exists, but does not contribute to the summary.
    expect(inactiveVariant.isActive).toBe(false);
    expect(inactiveVariant.inventory.stock).toBe(10);
    expect(inactiveVariant.inventory.reservedStock).toBe(2);
  });

  it("returns newest additions first and preserves ordering after a duplicate addition", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    await addProductToWishlist({
      agent,
      product: firstProduct,
    });

    await addProductToWishlist({
      agent,
      product: secondProduct,
    });

    const olderDate = new Date("2020-01-01T00:00:00.000Z");
    const newerDate = new Date("2020-01-02T00:00:00.000Z");

    // Use deterministic timestamps instead of waiting between requests.
    await Wishlist.updateOne(
      { user: user._id },
      {
        $set: {
          "items.0.addedAt": olderDate,
          "items.1.addedAt": newerDate,
        },
      },
    );

    const originalWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    // Stored order is oldest first; the response must reverse it.
    expect(originalWishlist.items.map((item) => String(item.product))).toEqual([
      String(firstProduct._id),
      String(secondProduct._id),
    ]);

    const getResponse = await agent.get(wishlistUrl).expect(200);

    const expectedOrder = [String(secondProduct._id), String(firstProduct._id)];

    expect(
      getResponse.body.data.wishlist.items.map((item) => item.productId),
    ).toEqual(expectedOrder);

    expect(
      getResponse.body.data.wishlist.items.map((item) => item.addedAt),
    ).toEqual([newerDate.toISOString(), olderDate.toISOString()]);

    // Adding the older Product again must not move it to the top.
    const duplicateResponse = await addProductToWishlist({
      agent,
      product: firstProduct,
    });

    expect(duplicateResponse.body.data.wishlist).toEqual(
      getResponse.body.data.wishlist,
    );

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(storedWishlist).toEqual(originalWishlist);
  });

  it("enforces one Wishlist per customer through the database unique index", async () => {
    const { user } = await createAuthenticatedCustomerAgent();

    // Ensure the model's indexes are initialized before testing uniqueness.
    await Wishlist.init();

    const originalWishlist = await Wishlist.create({
      user: user._id,
    });

    // A direct database write must also respect customer uniqueness.
    await expect(
      Wishlist.create({
        user: user._id,
      }),
    ).rejects.toMatchObject({
      code: 11000,
      keyPattern: {
        user: 1,
      },
    });

    expect(
      await Wishlist.countDocuments({
        user: user._id,
      }),
    ).toBe(1);

    const storedWishlist = await Wishlist.findOne({
      user: user._id,
    }).lean();

    expect(String(storedWishlist._id)).toBe(String(originalWishlist._id));

    expect(storedWishlist.items).toEqual([]);
  });
});
