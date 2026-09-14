import mongoose from "mongoose";

import { describe, expect, it } from "vitest";

import request from "supertest";

import app from "../../src/app.js";

import RecentlyViewed from "../../src/modules/recently-viewed/recently-viewed.model.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import Product from "../../src/modules/products/product.model.js";

import Brand from "../../src/modules/brands/brand.model.js";

import Category from "../../src/modules/categories/category.model.js";

import { RECENTLY_VIEWED_LIMITS } from "../../src/modules/recently-viewed/recently-viewed.constants.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

/*
|--------------------------------------------------------------------------
| URLs and Authentication Helper
|--------------------------------------------------------------------------
*/

const recentlyViewedUrl = "/api/v1/recently-viewed";

const sampleProductId = "507f1f77bcf86cd799439011";

const recentlyViewedEndpoints = [
  ["get", recentlyViewedUrl],
  ["post", `${recentlyViewedUrl}/${sampleProductId}`],
  ["delete", `${recentlyViewedUrl}/${sampleProductId}`],
  ["delete", recentlyViewedUrl],
];

const createAuthenticatedCustomerAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });
};

/*
|--------------------------------------------------------------------------
| Product and History Fixtures
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
  const name = `Recently Viewed Product ${suffix}`;
  const slug = `recently-viewed-product-${suffix}`;

  const categoryResponse = await agent
    .post("/api/v1/admin/categories")
    .send({
      name: `Recently Viewed Category ${suffix}`,
      slug: `recently-viewed-category-${suffix}`,
      description: "Category used by Recently Viewed tests.",
      status: "active",
    })
    .expect(201);

  const brand = await createActiveBrandFixture();

  const response = await agent
    .post("/api/v1/admin/products")
    .send({
      name,
      slug,

      shortDescription: "Recently Viewed integration test Product.",
      description: "An active Product used by Recently Viewed tests.",

      category: categoryResponse.body.data.category.id,
      brand: resolveProductBrandRequestValue(brand),

      materials: ["100% Cotton"],
      careInstructions: ["Machine wash cold"],
      countryOfOrigin: "India",
      tags: ["recently-viewed-test"],

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
          sku: `RECENTLY-VIEWED-${suffix}`,
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

  return Product.findById(response.body.data.product.id).lean();
};

const recordProductView = ({ agent, product, expectedStatus = 200 }) => {
  return agent
    .post(`${recentlyViewedUrl}/${product._id}`)
    .expect(expectedStatus);
};

const getHistoryResponse = async (agent) => {
  const response = await agent.get(recentlyViewedUrl).expect(200);

  expect(response.body.success).toBe(true);

  return response.body.data.recentlyViewed;
};

const findStoredHistory = (user) => {
  return RecentlyViewed.findOne({
    user: user._id,
  }).lean();
};

const expectStoredHistoryUnchanged = async (user, originalHistory) => {
  expect(await findStoredHistory(user)).toEqual(originalHistory);
};

const createHistoryAtSize = ({
  user,
  itemCount = RECENTLY_VIEWED_LIMITS.MAX_ITEMS,
  productIds = [],
}) => {
  return RecentlyViewed.create({
    user: user._id,

    items: Array.from({ length: itemCount }, (_, index) => ({
      product: productIds[index] ?? new mongoose.Types.ObjectId(),

      // Increasing timestamps make index 0 the oldest entry.
      viewedAt: new Date(Date.UTC(2020, 0, 1) + index * 1000),
    })),
  });
};

/*
|--------------------------------------------------------------------------
| Customer Recently Viewed Integration Tests
|--------------------------------------------------------------------------
*/

describe("Customer Recently Viewed API", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication — 4 tests
  |--------------------------------------------------------------------------
  */

  it.each(recentlyViewedEndpoints)(
    "rejects unauthenticated requests: %s %s",
    async (method, url) => {
      const response = await request(app)[method](url).expect(401);

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("AUTHENTICATION_REQUIRED");

      expect(await RecentlyViewed.countDocuments()).toBe(0);
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Customer Role — 4 tests
  |--------------------------------------------------------------------------
  */

  it.each(recentlyViewedEndpoints)(
    "rejects authenticated admins: %s %s",
    async (method, url) => {
      const { agent } = await createAuthenticatedAgent({
        role: USER_ROLES.ADMIN,
      });

      const response = await agent[method](url).expect(403);

      expect(response.body.success).toBe(false);

      expect(response.body.errorCode).toBe("ACCESS_FORBIDDEN");

      expect(await RecentlyViewed.countDocuments()).toBe(0);
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Empty History — 3 tests
  |--------------------------------------------------------------------------
  */

  it("returns empty history without creating a document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent.get(recentlyViewedUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Recently viewed history retrieved successfully",
    );

    expect(response.body.data.recentlyViewed).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedHistory = await RecentlyViewed.findOne({
      user: user._id,
    });

    expect(storedHistory).toBeNull();
  });

  it("clears nonexistent history without creating a document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent.delete(recentlyViewedUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Recently viewed history cleared successfully",
    );

    expect(response.body.data.recentlyViewed).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedHistory = await RecentlyViewed.findOne({
      user: user._id,
    });

    expect(storedHistory).toBeNull();
  });

  it("removes an unrecorded Product without creating a history document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .delete(`${recentlyViewedUrl}/${sampleProductId}`)
      .expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Product removed from recently viewed history successfully",
    );

    expect(response.body.data.recentlyViewed).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });

    const storedHistory = await RecentlyViewed.findOne({
      user: user._id,
    });

    expect(storedHistory).toBeNull();
  });
});

/*
|--------------------------------------------------------------------------
| Remaining Recently Viewed Integration Tests
|--------------------------------------------------------------------------
*/

describe("Customer Recently Viewed API - remaining behavior", () => {
  /*
  |--------------------------------------------------------------------------
  | Recording and Reading — 4 tests
  |--------------------------------------------------------------------------
  */

  it("records a Product reference and returns current details without changing inventory", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const response = await recordProductView({ agent, product });

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Product view recorded successfully");

    const history = response.body.data.recentlyViewed;

    expect(history.id).toBeTruthy();
    expect(history.itemCount).toBe(1);
    expect(history.items).toHaveLength(1);

    const item = history.items[0];

    expect(item.productId).toBe(String(product._id));
    expect(Number.isFinite(Date.parse(item.viewedAt))).toBe(true);
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

    const stored = await findStoredHistory(user);

    expect(String(stored._id)).toBe(history.id);
    expect(String(stored.user)).toBe(String(user._id));
    expect(stored.items).toHaveLength(1);

    expect(Object.keys(stored.items[0]).sort()).toEqual([
      "product",
      "viewedAt",
    ]);

    expect(String(stored.items[0].product)).toBe(String(product._id));

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory).toEqual(
      product.variants[0].inventory,
    );

    const serialized = JSON.stringify(history);

    expect(serialized).not.toContain('"buyingPrice"');
    expect(serialized).not.toContain('"reservedStock"');
  });

  it("refreshes an existing view, moves it first, and keeps one entry per Product", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    const olderDate = new Date("2020-01-01T00:00:00.000Z");
    const newerDate = new Date("2020-01-02T00:00:00.000Z");

    const seeded = await RecentlyViewed.create({
      user: user._id,
      items: [
        { product: firstProduct._id, viewedAt: olderDate },
        { product: secondProduct._id, viewedAt: newerDate },
      ],
    });

    const before = await getHistoryResponse(agent);

    expect(before.items.map((item) => item.productId)).toEqual([
      String(secondProduct._id),
      String(firstProduct._id),
    ]);

    const response = await recordProductView({
      agent,
      product: firstProduct,
    });

    const history = response.body.data.recentlyViewed;

    expect(history.id).toBe(String(seeded._id));
    expect(history.itemCount).toBe(2);

    expect(history.items.map((item) => item.productId)).toEqual([
      String(firstProduct._id),
      String(secondProduct._id),
    ]);

    expect(Date.parse(history.items[0].viewedAt)).toBeGreaterThan(
      newerDate.getTime(),
    );

    expect(history.items[1].viewedAt).toBe(newerDate.toISOString());

    const stored = await findStoredHistory(user);

    expect(stored.items).toHaveLength(2);

    expect(
      stored.items.filter(
        (item) => String(item.product) === String(firstProduct._id),
      ),
    ).toHaveLength(1);
  });

  it("does not create history through public Product GET or refresh timestamps through history GET", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await agent.get(`/api/v1/products/${product.slug}`).expect(200);

    expect(await findStoredHistory(user)).toBeNull();

    await recordProductView({ agent, product });

    const originalHistory = await findStoredHistory(user);

    const firstGet = await getHistoryResponse(agent);
    const secondGet = await getHistoryResponse(agent);

    expect(secondGet).toEqual(firstGet);

    await agent.get(`/api/v1/products/${product.slug}`).expect(200);

    await expectStoredHistoryUnchanged(user, originalHistory);
  });

  it("records an out-of-stock Product without changing inventory", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 5,
      reservedStock: 5,
    });

    const response = await recordProductView({ agent, product });
    const item = response.body.data.recentlyViewed.items[0];

    expect(item.isAvailable).toBe(true);
    expect(item.product.availability.availableStock).toBe(0);
    expect(item.product.availability.isInStock).toBe(false);

    const refreshedProduct = await Product.findById(product._id).lean();

    expect(refreshedProduct.variants[0].inventory).toEqual(
      product.variants[0].inventory,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Product and Master Data Visibility — 9 tests
  |--------------------------------------------------------------------------
  */

  it("rejects a missing Product without creating history", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${recentlyViewedUrl}/${sampleProductId}`)
      .expect(404);

    expect(response.body.errorCode).toBe("RECENTLY_VIEWED_PRODUCT_NOT_FOUND");

    expect(await findStoredHistory(user)).toBeNull();
  });

  it.each([
    ["inactive", () => ({ status: "inactive" })],
    ["soft-deleted", () => ({ deletedAt: new Date() })],
    ["unpublished", () => ({ publishedAt: null })],
    [
      "scheduled for future publication",
      () => ({
        publishedAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    ],
  ])(
    "rejects a Product that is %s without creating history",
    async (_description, createChanges) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      const updateResult = await Product.updateOne(
        { _id: product._id },
        { $set: createChanges() },
      );

      expect(updateResult.modifiedCount).toBe(1);

      const response = await recordProductView({
        agent,
        product,
        expectedStatus: 404,
      });

      expect(response.body.errorCode).toBe("RECENTLY_VIEWED_PRODUCT_NOT_FOUND");

      expect(await findStoredHistory(user)).toBeNull();
    },
  );

  it.each([
    ["inactive Brand", Brand, "brand", () => ({ status: "inactive" })],
    ["deleted Brand", Brand, "brand", () => ({ deletedAt: new Date() })],
    ["inactive Category", Category, "category", () => ({ status: "inactive" })],
    [
      "deleted Category",
      Category,
      "category",
      () => ({ deletedAt: new Date() }),
    ],
  ])(
    "rejects a Product with an unavailable dependency: %s",
    async (_description, DependencyModel, field, createChanges) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      await agent.get(`/api/v1/products/${product.slug}`).expect(200);

      const updateResult = await DependencyModel.updateOne(
        { _id: product[field] },
        { $set: createChanges() },
      );

      expect(updateResult.modifiedCount).toBe(1);

      const response = await recordProductView({
        agent,
        product,
        expectedStatus: 404,
      });

      expect(response.body.errorCode).toBe("RECENTLY_VIEWED_PRODUCT_NOT_FOUND");

      expect(await findStoredHistory(user)).toBeNull();
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Stale Entries and Recovery — 5 tests
  |--------------------------------------------------------------------------
  */

  it.each([
    ["Product", Product, "_id"],
    ["Brand", Brand, "brand"],
    ["Category", Category, "category"],
  ])(
    "preserves history when its %s becomes inactive and restores details after reactivation",
    async (_description, TargetModel, field) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture();

      const recorded = await recordProductView({ agent, product });
      const originalItem = recorded.body.data.recentlyViewed.items[0];
      const originalHistory = await findStoredHistory(user);

      const deactivateResult = await TargetModel.updateOne(
        { _id: product[field] },
        { $set: { status: "inactive" } },
      );

      expect(deactivateResult.modifiedCount).toBe(1);

      const unavailable = await getHistoryResponse(agent);

      expect(unavailable.itemCount).toBe(1);

      expect(unavailable.items).toEqual([
        {
          productId: String(product._id),
          viewedAt: originalItem.viewedAt,
          isAvailable: false,
          product: null,
        },
      ]);

      await expectStoredHistoryUnchanged(user, originalHistory);

      const reactivateResult = await TargetModel.updateOne(
        { _id: product[field] },
        { $set: { status: "active" } },
      );

      expect(reactivateResult.modifiedCount).toBe(1);

      const recovered = await getHistoryResponse(agent);

      expect(recovered.items).toEqual([originalItem]);

      await expectStoredHistoryUnchanged(user, originalHistory);
    },
  );

  it("preserves a permanently deleted Product reference and allows removing it", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const recorded = await recordProductView({ agent, product });
    const originalItem = recorded.body.data.recentlyViewed.items[0];
    const originalHistory = await findStoredHistory(user);

    const deleteResult = await Product.collection.deleteOne({
      _id: product._id,
    });

    expect(deleteResult.deletedCount).toBe(1);

    const history = await getHistoryResponse(agent);

    expect(history.items).toEqual([
      {
        productId: String(product._id),
        viewedAt: originalItem.viewedAt,
        isAvailable: false,
        product: null,
      },
    ]);

    await expectStoredHistoryUnchanged(user, originalHistory);

    const removal = await agent
      .delete(`${recentlyViewedUrl}/${history.items[0].productId}`)
      .expect(200);

    expect(removal.body.data.recentlyViewed).toEqual({
      id: String(originalHistory._id),
      items: [],
      itemCount: 0,
    });

    const stored = await findStoredHistory(user);

    expect(stored).not.toBeNull();
    expect(String(stored._id)).toBe(String(originalHistory._id));
    expect(stored.items).toEqual([]);
  });

  it("rejects recording an already-viewed unavailable Product without refreshing its timestamp", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await recordProductView({ agent, product });

    const oldViewedAt = new Date("2020-01-01T00:00:00.000Z");

    await RecentlyViewed.updateOne(
      { user: user._id },
      { $set: { "items.0.viewedAt": oldViewedAt } },
    );

    await Product.updateOne(
      { _id: product._id },
      { $set: { status: "inactive" } },
    );

    const originalHistory = await findStoredHistory(user);

    const response = await recordProductView({
      agent,
      product,
      expectedStatus: 404,
    });

    expect(response.body.errorCode).toBe("RECENTLY_VIEWED_PRODUCT_NOT_FOUND");

    await expectStoredHistoryUnchanged(user, originalHistory);
  });

  /*
  |--------------------------------------------------------------------------
  | Removal and Clearing — 2 tests
  |--------------------------------------------------------------------------
  */

  it("removes only the requested entry, allows repeated removal, and keeps the empty history document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    await recordProductView({ agent, product: firstProduct });

    const recorded = await recordProductView({
      agent,
      product: secondProduct,
    });

    const original = recorded.body.data.recentlyViewed;

    const remainingItem = original.items.find(
      (item) => item.productId === String(secondProduct._id),
    );

    const firstRemoval = await agent
      .delete(`${recentlyViewedUrl}/${firstProduct._id}`)
      .expect(200);

    expect(firstRemoval.body.data.recentlyViewed).toEqual({
      id: original.id,
      items: [remainingItem],
      itemCount: 1,
    });

    const afterRemoval = await findStoredHistory(user);

    const repeated = await agent
      .delete(`${recentlyViewedUrl}/${firstProduct._id}`)
      .expect(200);

    expect(repeated.body.data.recentlyViewed).toEqual(
      firstRemoval.body.data.recentlyViewed,
    );

    await expectStoredHistoryUnchanged(user, afterRemoval);

    const finalRemoval = await agent
      .delete(`${recentlyViewedUrl}/${secondProduct._id}`)
      .expect(200);

    expect(finalRemoval.body.data.recentlyViewed).toEqual({
      id: original.id,
      items: [],
      itemCount: 0,
    });

    const emptyHistory = await findStoredHistory(user);

    expect(emptyHistory).not.toBeNull();
    expect(String(emptyHistory._id)).toBe(original.id);
    expect(emptyHistory.items).toEqual([]);

    for (const product of [firstProduct, secondProduct]) {
      const refreshed = await Product.findById(product._id).lean();

      expect(refreshed.variants[0].inventory).toEqual(
        product.variants[0].inventory,
      );
    }
  });

  it("clears available and stale entries, preserves inventory, and allows repeated clearing", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    const secondProduct = await createActiveProductFixture();

    await recordProductView({ agent, product: firstProduct });

    const recorded = await recordProductView({
      agent,
      product: secondProduct,
    });

    const historyId = recorded.body.data.recentlyViewed.id;

    await Product.collection.deleteOne({ _id: secondProduct._id });

    const response = await agent.delete(recentlyViewedUrl).expect(200);

    expect(response.body.data.recentlyViewed).toEqual({
      id: historyId,
      items: [],
      itemCount: 0,
    });

    const afterClear = await findStoredHistory(user);

    expect(afterClear).not.toBeNull();
    expect(String(afterClear._id)).toBe(historyId);
    expect(afterClear.items).toEqual([]);

    await agent.delete(recentlyViewedUrl).expect(200);

    await expectStoredHistoryUnchanged(user, afterClear);

    const refreshed = await Product.findById(firstProduct._id).lean();

    expect(refreshed.variants[0].inventory).toEqual(
      firstProduct.variants[0].inventory,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Customer Isolation — 3 tests
  |--------------------------------------------------------------------------
  */

  it("keeps shared and customer-specific Product views in separate histories", async () => {
    const first = await createAuthenticatedCustomerAgent();
    const second = await createAuthenticatedCustomerAgent();

    const sharedProduct = await createActiveProductFixture();
    const exclusiveProduct = await createActiveProductFixture();

    await recordProductView({
      agent: first.agent,
      product: sharedProduct,
    });

    await recordProductView({
      agent: second.agent,
      product: sharedProduct,
    });

    await recordProductView({
      agent: first.agent,
      product: exclusiveProduct,
    });

    const firstHistory = await getHistoryResponse(first.agent);
    const secondHistory = await getHistoryResponse(second.agent);

    expect(firstHistory.id).not.toBe(secondHistory.id);

    expect(firstHistory.itemCount).toBe(2);
    expect(secondHistory.itemCount).toBe(1);

    expect(firstHistory.items.map((item) => item.productId).sort()).toEqual(
      [String(sharedProduct._id), String(exclusiveProduct._id)].sort(),
    );

    expect(secondHistory.items.map((item) => item.productId)).toEqual([
      String(sharedProduct._id),
    ]);

    const firstStored = await findStoredHistory(first.user);
    const secondStored = await findStoredHistory(second.user);

    expect(String(firstStored.user)).toBe(String(first.user._id));
    expect(String(secondStored.user)).toBe(String(second.user._id));

    expect(await RecentlyViewed.countDocuments()).toBe(2);
  });

  it("cannot remove a Product recorded only by another customer", async () => {
    const first = await createAuthenticatedCustomerAgent();
    const second = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    const firstRecorded = await recordProductView({
      agent: first.agent,
      product: firstProduct,
    });

    await recordProductView({
      agent: second.agent,
      product: secondProduct,
    });

    const firstBefore = await findStoredHistory(first.user);
    const secondBefore = await findStoredHistory(second.user);

    const response = await first.agent
      .delete(`${recentlyViewedUrl}/${secondProduct._id}`)
      .expect(200);

    expect(response.body.data.recentlyViewed).toEqual(
      firstRecorded.body.data.recentlyViewed,
    );

    await expectStoredHistoryUnchanged(first.user, firstBefore);
    await expectStoredHistoryUnchanged(second.user, secondBefore);
  });

  it("clears only the authenticated customer's history", async () => {
    const first = await createAuthenticatedCustomerAgent();
    const second = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const firstRecorded = await recordProductView({
      agent: first.agent,
      product,
    });

    const secondRecorded = await recordProductView({
      agent: second.agent,
      product,
    });

    const secondBefore = await findStoredHistory(second.user);

    const response = await first.agent.delete(recentlyViewedUrl).expect(200);

    expect(response.body.data.recentlyViewed).toEqual({
      id: firstRecorded.body.data.recentlyViewed.id,
      items: [],
      itemCount: 0,
    });

    const firstStored = await findStoredHistory(first.user);

    expect(firstStored).not.toBeNull();
    expect(firstStored.items).toEqual([]);

    await expectStoredHistoryUnchanged(second.user, secondBefore);

    expect(await getHistoryResponse(second.agent)).toEqual(
      secondRecorded.body.data.recentlyViewed,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Request Validation — 11 tests
  |--------------------------------------------------------------------------
  */

  it.each([
    ["productId", sampleProductId],
    ["viewedAt", "2020-01-01T00:00:00.000Z"],
    ["userId", sampleProductId],
    ["variantId", sampleProductId],
    ["quantity", 1],
  ])(
    "rejects a client-supplied %s in the recording body",
    async (field, value) => {
      const { agent } = await createAuthenticatedCustomerAgent();

      const response = await agent
        .post(`${recentlyViewedUrl}/${sampleProductId}`)
        .send({ [field]: value })
        .expect(400);

      expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

      expect(await RecentlyViewed.countDocuments()).toBe(0);
    },
  );

  it.each(["post", "delete"])(
    "rejects a malformed Product ID for %s",
    async (method) => {
      const { agent } = await createAuthenticatedCustomerAgent();

      const response = await agent[method](
        `${recentlyViewedUrl}/invalid`,
      ).expect(400);

      expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

      expect(await RecentlyViewed.countDocuments()).toBe(0);
    },
  );

  it.each(recentlyViewedEndpoints)(
    "rejects unexpected query parameters: %s %s",
    async (method, url) => {
      const { agent } = await createAuthenticatedCustomerAgent();

      const response = await agent[method](url)
        .query({ userId: sampleProductId })
        .expect(400);

      expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

      expect(await RecentlyViewed.countDocuments()).toBe(0);
    },
  );

  /*
  |--------------------------------------------------------------------------
  | Capacity and Eviction — 4 tests
  |--------------------------------------------------------------------------
  */

  it("records a new Product when exactly one history slot remains", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await createHistoryAtSize({
      user,
      itemCount: RECENTLY_VIEWED_LIMITS.MAX_ITEMS - 1,
    });

    const response = await recordProductView({ agent, product });
    const history = response.body.data.recentlyViewed;

    expect(history.id).toBe(String(seeded._id));
    expect(history.itemCount).toBe(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);
    expect(history.items).toHaveLength(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);
    expect(history.items[0].productId).toBe(String(product._id));
    expect(history.items[0].isAvailable).toBe(true);

    const stored = await findStoredHistory(user);

    expect(stored.items).toHaveLength(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);

    const storedIds = stored.items.map((item) => String(item.product));

    for (const originalItem of seeded.items) {
      expect(storedIds).toContain(String(originalItem.product));
    }
  });

  it("evicts only the oldest entry when recording a new Product at capacity", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await createHistoryAtSize({ user });

    const oldestProductId = String(seeded.items[0].product);

    const expectedIds = [
      String(product._id),
      ...seeded.items.slice(1).map((item) => String(item.product)),
    ].sort();

    const response = await recordProductView({ agent, product });
    const history = response.body.data.recentlyViewed;

    expect(history.itemCount).toBe(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);
    expect(history.items[0].productId).toBe(String(product._id));

    expect(history.items.map((item) => item.productId).sort()).toEqual(
      expectedIds,
    );

    expect(
      history.items.some((item) => item.productId === oldestProductId),
    ).toBe(false);

    const stored = await findStoredHistory(user);

    expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
      expectedIds,
    );
  });

  it("refreshes an existing Product at capacity without evicting another entry", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await createHistoryAtSize({
      user,
      productIds: [product._id],
    });

    const originalIds = seeded.items.map((item) => String(item.product)).sort();

    const originalViewedAt = seeded.items[0].viewedAt.getTime();

    const response = await recordProductView({ agent, product });
    const history = response.body.data.recentlyViewed;

    expect(history.itemCount).toBe(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);

    expect(history.items.map((item) => item.productId).sort()).toEqual(
      originalIds,
    );

    expect(history.items[0].productId).toBe(String(product._id));

    expect(Date.parse(history.items[0].viewedAt)).toBeGreaterThan(
      originalViewedAt,
    );

    const stored = await findStoredHistory(user);

    expect(stored.items).toHaveLength(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);

    expect(
      stored.items.filter(
        (item) => String(item.product) === String(product._id),
      ),
    ).toHaveLength(1);

    for (const originalItem of seeded.items.slice(1)) {
      const preserved = stored.items.find(
        (item) => String(item.product) === String(originalItem.product),
      );

      expect(preserved).toBeDefined();
      expect(preserved.viewedAt).toEqual(originalItem.viewedAt);
    }
  });

  it("uses Product ID ascending to decide eviction among equally old entries", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await createHistoryAtSize({ user });
    const tiedDate = new Date("2020-01-01T00:00:00.000Z");

    for (const item of seeded.items) {
      item.viewedAt = tiedDate;
    }

    await seeded.save();

    const originalIds = seeded.items.map((item) => String(item.product)).sort();

    const expectedRetainedOldIds = originalIds.slice(
      0,
      RECENTLY_VIEWED_LIMITS.MAX_ITEMS - 1,
    );

    const response = await recordProductView({ agent, product });
    const history = response.body.data.recentlyViewed;

    expect(history.itemCount).toBe(RECENTLY_VIEWED_LIMITS.MAX_ITEMS);
    expect(history.items[0].productId).toBe(String(product._id));

    expect(history.items.slice(1).map((item) => item.productId)).toEqual(
      expectedRetainedOldIds,
    );

    const stored = await findStoredHistory(user);

    expect(
      stored.items.some((item) => String(item.product) === originalIds.at(-1)),
    ).toBe(false);
  });

  /*
  |--------------------------------------------------------------------------
  | Current Pricing, Stock, and Variants — 3 tests
  |--------------------------------------------------------------------------
  */

  it("reflects current prices and discount removal without changing stored history", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await recordProductView({ agent, product });

    const originalHistory = await findStoredHistory(user);

    for (const pricing of [
      { sellingPrice: 1299, discountPrice: 999, expectedPrice: 999 },
      { sellingPrice: 1299, discountPrice: null, expectedPrice: 1299 },
    ]) {
      const updateResult = await Product.updateOne(
        {
          _id: product._id,
          "variants._id": product.variants[0]._id,
        },
        {
          $set: {
            "variants.$.pricing.sellingPrice": pricing.sellingPrice,
            "variants.$.pricing.discountPrice": pricing.discountPrice,
          },
        },
      );

      expect(updateResult.modifiedCount).toBe(1);

      const history = await getHistoryResponse(agent);

      expect(history.items[0].product.priceRange).toEqual({
        minimum: pricing.expectedPrice,
        maximum: pricing.expectedPrice,
        currency: "INR",
      });

      await expectStoredHistoryUnchanged(user, originalHistory);
    }
  });

  it("reflects current stock and reservations without modifying Product data during GET", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
      reservedStock: 2,
    });

    await recordProductView({ agent, product });

    const originalHistory = await findStoredHistory(user);

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

      const productBefore = await Product.findById(product._id).lean();

      const history = await getHistoryResponse(agent);
      const item = history.items[0];

      expect(item.isAvailable).toBe(true);

      expect(item.product.availability.availableStock).toBe(
        state.availableStock,
      );

      expect(item.product.availability.isInStock).toBe(
        state.availableStock > 0,
      );

      expect(await Product.findById(product._id).lean()).toEqual(productBefore);
    }

    await expectStoredHistoryUnchanged(user, originalHistory);
  });

  it("excludes inactive variants from current pricing and stock summaries", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
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
      { $push: { variants: secondVariant } },
      { runValidators: true },
    );

    expect(addVariantResult.modifiedCount).toBe(1);

    const recorded = await recordProductView({ agent, product });
    const initialProduct = recorded.body.data.recentlyViewed.items[0].product;

    expect(initialProduct.priceRange).toEqual({
      minimum: 699,
      maximum: 1099,
      currency: "INR",
    });

    expect(initialProduct.availability.availableStock).toBe(23);

    const deactivateResult = await Product.updateOne(
      {
        _id: product._id,
        "variants._id": originalVariant._id,
      },
      { $set: { "variants.$.isActive": false } },
    );

    expect(deactivateResult.modifiedCount).toBe(1);

    const history = await getHistoryResponse(agent);
    const item = history.items[0];

    expect(item.isAvailable).toBe(true);

    expect(item.product.priceRange).toEqual({
      minimum: 1099,
      maximum: 1099,
      currency: "INR",
    });

    expect(item.product.availability.availableStock).toBe(15);

    const refreshed = await Product.findById(product._id).lean();

    const inactiveVariant = refreshed.variants.find(
      (variant) => String(variant._id) === String(originalVariant._id),
    );

    expect(inactiveVariant.inventory.stock).toBe(10);
    expect(inactiveVariant.inventory.reservedStock).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Tie Ordering, Database Uniqueness, Empty Body — 3 tests
  |--------------------------------------------------------------------------
  */

  it("returns equal viewing timestamps in Product ID ascending order without rewriting history", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const firstProduct = await createActiveProductFixture();
    const secondProduct = await createActiveProductFixture();

    const productsDescending = [firstProduct, secondProduct].sort(
      (first, second) => String(second._id).localeCompare(String(first._id)),
    );

    const tiedDate = new Date("2020-01-01T00:00:00.000Z");

    await RecentlyViewed.create({
      user: user._id,

      items: productsDescending.map((product) => ({
        product: product._id,
        viewedAt: tiedDate,
      })),
    });

    const originalHistory = await findStoredHistory(user);
    const history = await getHistoryResponse(agent);

    expect(history.items.map((item) => item.productId)).toEqual(
      [String(firstProduct._id), String(secondProduct._id)].sort(),
    );

    expect(history.items.map((item) => item.viewedAt)).toEqual([
      tiedDate.toISOString(),
      tiedDate.toISOString(),
    ]);

    await expectStoredHistoryUnchanged(user, originalHistory);
  });

  it("enforces one history document per customer through the database unique index", async () => {
    const { user } = await createAuthenticatedCustomerAgent();

    await RecentlyViewed.init();

    const original = await RecentlyViewed.create({
      user: user._id,
    });

    await expect(
      RecentlyViewed.create({
        user: user._id,
      }),
    ).rejects.toMatchObject({
      code: 11000,
      keyPattern: {
        user: 1,
      },
    });

    expect(
      await RecentlyViewed.countDocuments({
        user: user._id,
      }),
    ).toBe(1);

    const stored = await findStoredHistory(user);

    expect(String(stored._id)).toBe(String(original._id));
    expect(stored.items).toEqual([]);
  });

  it("accepts an explicitly empty recording body and generates viewedAt on the server", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const beforeRequest = Date.now();

    const response = await agent
      .post(`${recentlyViewedUrl}/${product._id}`)
      .send({})
      .expect(200);

    const afterRequest = Date.now();

    const history = response.body.data.recentlyViewed;

    expect(history.itemCount).toBe(1);

    const viewedAt = Date.parse(history.items[0].viewedAt);

    expect(viewedAt).toBeGreaterThanOrEqual(beforeRequest);
    expect(viewedAt).toBeLessThanOrEqual(afterRequest);

    const stored = await findStoredHistory(user);

    expect(stored.items[0].viewedAt.getTime()).toBe(viewedAt);
  });
});
