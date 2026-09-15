import mongoose from "mongoose";

import { describe, expect, it, vi } from "vitest";

import RecentlyViewed from "../../src/modules/recently-viewed/recently-viewed.model.js";
import Product from "../../src/modules/products/product.model.js";

import * as recentlyViewedRepository from "../../src/modules/recently-viewed/recently-viewed.repository.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

const recentlyViewedUrl = "/api/v1/recently-viewed";
const maxItems = 50;

let fixtureSequence = 0;

const createRecentlyViewedRaceFixture = async () => {
  const { agent, user } = await createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });

  const { agent: adminAgent } = await createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });

  fixtureSequence += 1;

  const suffix = fixtureSequence;

  const categoryResponse = await adminAgent
    .post("/api/v1/admin/categories")
    .send({
      name: `Recently Viewed Race Category ${suffix}`,
      slug: `recently-viewed-race-category-${suffix}`,
      description: "Category for Recently Viewed concurrency tests.",
      status: "active",
    })
    .expect(201);

  const brand = await createActiveBrandFixture();

  const createProduct = async (label) => {
    const name = `Recently Viewed Race Product ${suffix} ${label}`;
    const slug = `recently-viewed-race-product-${suffix}-${label}`;

    const response = await adminAgent
      .post("/api/v1/admin/products")
      .send({
        name,
        slug,
        shortDescription: "Recently Viewed concurrency test Product.",
        description: "An active Product for history concurrency tests.",

        category: categoryResponse.body.data.category.id,
        brand: resolveProductBrandRequestValue(brand),

        materials: ["100% Cotton"],
        careInstructions: ["Machine wash cold"],
        countryOfOrigin: "India",
        tags: ["recently-viewed-race-test"],

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
            sku: `RV-RACE-${suffix}-${label.toUpperCase()}`,
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
              reservedStock: 2,
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

  return {
    agent,
    user,
    createProduct,
  };
};

describe("Recently Viewed concurrency", () => {
  it.each([
    {
      label:
        "preserves the latest timestamp for overlapping views of one Product",
      fullHistory: false,
    },
    {
      label:
        "preserves both new Products when views overlap at the history limit",
      fullHistory: true,
    },
  ])("$label", async ({ fullHistory }) => {
    const { agent, user, createProduct } =
      await createRecentlyViewedRaceFixture();

    const firstProduct = await createProduct("first");

    const secondProduct = fullHistory
      ? await createProduct("second")
      : firstProduct;

    const baseTime = Date.now();

    // Ascending timestamps make entries 0 and 1 the oldest.
    const initialItems = fullHistory
      ? Array.from({ length: maxItems }, (_, index) => ({
          product: new mongoose.Types.ObjectId(),
          viewedAt: new Date(baseTime - (maxItems - index) * 60_000),
        }))
      : [];

    const seeded = await RecentlyViewed.create({
      user: user._id,
      items: initialItems,
    });

    const originalSave = recentlyViewedRepository.saveRecentlyViewedDocument;

    let preparedViewedAt;
    let competingResponse;
    let competingSnapshot;
    let interleavingCompleted = false;

    const saveSpy = vi
      .spyOn(recentlyViewedRepository, "saveRecentlyViewedDocument")
      .mockImplementationOnce(async (history) => {
        const preparedItem = history.items.find(
          (item) => String(item.product) === String(firstProduct._id),
        );

        preparedViewedAt = preparedItem?.viewedAt.getTime();

        // Give the competing view a strictly later timestamp.
        vi.setSystemTime(baseTime + 1_000);

        competingResponse = await agent
          .post(`${recentlyViewedUrl}/${secondProduct._id}`)
          .send({});

        competingSnapshot = await RecentlyViewed.findOne({
          user: user._id,
        }).lean();

        interleavingCompleted = true;

        // Save the first request's original, now-stale document.
        return originalSave(history);
      });

    try {
      // Control Date only; network and database timers stay real.
      vi.useFakeTimers({
        toFake: ["Date"],
      });

      vi.setSystemTime(baseTime);

      const resumedResponse = await agent
        .post(`${recentlyViewedUrl}/${firstProduct._id}`)
        .send({});

      expect(interleavingCompleted).toBe(true);
      expect(preparedViewedAt).toBe(baseTime);

      const histories = await RecentlyViewed.find({
        user: user._id,
      }).lean();

      const relevantIds = new Set([
        String(firstProduct._id),
        String(secondProduct._id),
      ]);

      expect({
        competingStatus: competingResponse?.status,
        competingError: competingResponse?.body.errorCode ?? null,

        resumedStatus: resumedResponse.status,
        resumedError: resumedResponse.body.errorCode ?? null,

        historyCount: histories.length,

        itemCount: histories.reduce(
          (total, history) => total + history.items.length,
          0,
        ),

        relevantEntries: histories
          .flatMap((history) =>
            history.items
              .filter((item) => relevantIds.has(String(item.product)))
              .map((item) => String(item.product)),
          )
          .sort(),
      }).toEqual({
        competingStatus: 200,
        competingError: null,

        resumedStatus: 200,
        resumedError: null,

        historyCount: 1,
        itemCount: fullHistory ? maxItems : 1,

        relevantEntries: [...relevantIds].sort(),
      });

      const stored = histories[0];

      expect(String(stored._id)).toBe(String(seeded._id));

      const winningItem = competingSnapshot.items.find(
        (item) => String(item.product) === String(secondProduct._id),
      );

      expect(winningItem.viewedAt.getTime()).toBe(baseTime + 1_000);

      const storedSecondItem = stored.items.find(
        (item) => String(item.product) === String(secondProduct._id),
      );

      if (fullHistory) {
        // Preserve the competing Product's saved timestamp.
        expect(storedSecondItem.viewedAt).toEqual(winningItem.viewedAt);

        // Two new Products should evict exactly the two oldest.
        const expectedIds = [
          ...initialItems.slice(2).map((item) => String(item.product)),
          String(firstProduct._id),
          String(secondProduct._id),
        ].sort();

        expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
          expectedIds,
        );

        // Retained older entries keep their original timestamps.
        for (const originalItem of initialItems.slice(2)) {
          const retainedItem = stored.items.find(
            (item) => String(item.product) === String(originalItem.product),
          );

          expect(retainedItem.viewedAt).toEqual(originalItem.viewedAt);
        }
      } else {
        // The resumed request must never restore an older view time.
        expect(storedSecondItem.viewedAt.getTime()).toBeGreaterThanOrEqual(
          winningItem.viewedAt.getTime(),
        );
      }

      const getResponse = await agent.get(recentlyViewedUrl).expect(200);

      const history = getResponse.body.data.recentlyViewed;

      expect(history.id).toBe(String(seeded._id));
      expect(history.itemCount).toBe(fullHistory ? maxItems : 1);

      // API history remains ordered from newest to oldest.
      const timestamps = history.items.map((item) =>
        new Date(item.viewedAt).getTime(),
      );

      expect(timestamps).toEqual(
        [...timestamps].sort((first, second) => second - first),
      );
    } finally {
      saveSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("Recently Viewed concurrency boundaries", () => {
  const recordProduct = (agent, product) => {
    return agent.post(`${recentlyViewedUrl}/${product._id}`).send({});
  };

  const deleteProduct = (agent, product) => {
    return agent.delete(`${recentlyViewedUrl}/${product._id}`);
  };

  /*
   * Start both requests together using the real repository.
   * Verify the database after both requests finish.
   */
  it.each([
    {
      label:
        "creates one history for concurrent first views of the same Product",
      sameProduct: true,
    },
    {
      label:
        "creates one history and preserves different concurrent first views",
      sameProduct: false,
    },
  ])("$label", async ({ sameProduct }) => {
    const { agent, user, createProduct } =
      await createRecentlyViewedRaceFixture();

    const firstProduct = await createProduct("first");

    const secondProduct = sameProduct
      ? firstProduct
      : await createProduct("second");

    expect(await RecentlyViewed.countDocuments({ user: user._id })).toBe(0);

    const responses = await Promise.all([
      recordProduct(agent, firstProduct),
      recordProduct(agent, secondProduct),
    ]);

    expect(
      responses.map((response) => ({
        status: response.status,
        errorCode: response.body.errorCode ?? null,
      })),
    ).toEqual([
      { status: 200, errorCode: null },
      { status: 200, errorCode: null },
    ]);

    const histories = await RecentlyViewed.find({
      user: user._id,
    }).lean();

    expect(histories).toHaveLength(1);

    const stored = histories[0];

    const expectedIds = [
      ...new Set([String(firstProduct._id), String(secondProduct._id)]),
    ].sort();

    expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
      expectedIds,
    );

    for (const response of responses) {
      expect(response.body.data.recentlyViewed.id).toBe(String(stored._id));
    }

    const getResponse = await agent.get(recentlyViewedUrl).expect(200);

    const history = getResponse.body.data.recentlyViewed;

    expect(history.itemCount).toBe(expectedIds.length);

    const timestamps = history.items.map((item) =>
      new Date(item.viewedAt).getTime(),
    );

    expect(timestamps).toEqual(
      [...timestamps].sort((first, second) => second - first),
    );
  });

  /*
   * Finish a competing mutation immediately before the first
   * request attempts to save its original history document.
   */
  it.each([
    {
      label: "preserves an unrelated Product viewed during deletion",
      scenario: "delete-during-record",
    },
    {
      label: "treats overlapping deletion of the same Product as successful",
      scenario: "delete-same",
    },
    {
      label: "preserves both removals when different Products are deleted",
      scenario: "delete-different",
    },
    {
      label: "retries clearing the latest history after an overlapping view",
      scenario: "clear-during-record",
    },
  ])("$label", async ({ scenario }) => {
    const { agent, user, createProduct } =
      await createRecentlyViewedRaceFixture();

    const firstProduct = await createProduct("first");

    const secondProduct =
      scenario === "delete-same" ? null : await createProduct("second");

    const seededProducts =
      scenario === "delete-different"
        ? [firstProduct, secondProduct]
        : [firstProduct];

    const seeded = await RecentlyViewed.create({
      user: user._id,

      items: seededProducts.map((product) => ({
        product: product._id,
        viewedAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    });

    const originalSave = recentlyViewedRepository.saveRecentlyViewedDocument;

    let interleavingCompleted = false;
    let competingSnapshot;

    const saveSpy = vi
      .spyOn(recentlyViewedRepository, "saveRecentlyViewedDocument")
      .mockImplementationOnce(async (history) => {
        if (
          scenario === "delete-during-record" ||
          scenario === "clear-during-record"
        ) {
          await recordProduct(agent, secondProduct).expect(200);
        } else if (scenario === "delete-same") {
          await deleteProduct(agent, firstProduct).expect(200);
        } else {
          await deleteProduct(agent, secondProduct).expect(200);
        }

        competingSnapshot = await RecentlyViewed.findOne({
          user: user._id,
        }).lean();

        interleavingCompleted = true;

        return originalSave(history);
      });

    try {
      const response =
        scenario === "clear-during-record"
          ? await agent.delete(recentlyViewedUrl)
          : await deleteProduct(agent, firstProduct);

      expect(interleavingCompleted).toBe(true);

      expect({
        status: response.status,
        errorCode: response.body.errorCode ?? null,
      }).toEqual({
        status: 200,
        errorCode: null,
      });

      const histories = await RecentlyViewed.find({
        user: user._id,
      }).lean();

      expect(histories).toHaveLength(1);

      const stored = histories[0];

      expect(String(stored._id)).toBe(String(seeded._id));

      const expectedIds =
        scenario === "delete-during-record" ? [String(secondProduct._id)] : [];

      expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
        expectedIds,
      );

      // Deletion must preserve the surviving view's timestamp.
      for (const item of stored.items) {
        const competingItem = competingSnapshot.items.find(
          (entry) => String(entry.product) === String(item.product),
        );

        expect(item).toEqual(competingItem);
      }

      expect(response.body.data.recentlyViewed.id).toBe(String(seeded._id));

      expect(response.body.data.recentlyViewed.itemCount).toBe(
        expectedIds.length,
      );
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("returns a controlled conflict after five conflicting save attempts", async () => {
    const { agent, user, createProduct } =
      await createRecentlyViewedRaceFixture();

    const product = await createProduct("first");

    const seeded = await RecentlyViewed.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(recentlyViewedRepository, "saveRecentlyViewedDocument")
      .mockImplementation(async (history) => {
        throw new mongoose.Error.VersionError(history, history.__v, ["items"]);
      });

    try {
      const response = await recordProduct(agent, product);

      expect(response.status).toBe(409);
      expect(response.body.errorCode).toBe("RECENTLY_VIEWED_WRITE_CONFLICT");

      expect(saveSpy).toHaveBeenCalledTimes(5);

      const stored = await RecentlyViewed.findOne({
        user: user._id,
      }).lean();

      expect(String(stored._id)).toBe(String(seeded._id));
      expect(stored.items).toEqual([]);
      expect(stored.__v).toBe(seeded.__v);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("does not retry an unrelated history save failure", async () => {
    const { agent, user, createProduct } =
      await createRecentlyViewedRaceFixture();

    const product = await createProduct("first");

    const seeded = await RecentlyViewed.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(recentlyViewedRepository, "saveRecentlyViewedDocument")
      .mockRejectedValue(
        new Error("Simulated Recently Viewed storage failure"),
      );

    try {
      const response = await recordProduct(agent, product);

      expect(response.status).toBe(500);
      expect(response.body.errorCode).toBe("INTERNAL_SERVER_ERROR");

      expect(saveSpy).toHaveBeenCalledTimes(1);

      const stored = await RecentlyViewed.findOne({
        user: user._id,
      }).lean();

      expect(String(stored._id)).toBe(String(seeded._id));
      expect(stored.items).toEqual([]);
      expect(stored.__v).toBe(seeded.__v);
    } finally {
      saveSpy.mockRestore();
    }
  });
});
