import mongoose from "mongoose";

import { describe, expect, it, vi } from "vitest";

import Wishlist from "../../src/modules/wishlist/wishlist.model.js";
import Product from "../../src/modules/products/product.model.js";

import * as wishlistRepository from "../../src/modules/wishlist/wishlist.repository.js";

import { WISHLIST_LIMITS } from "../../src/modules/wishlist/wishlist.constants.js";
import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

const wishlistUrl = "/api/v1/wishlist";

let fixtureSequence = 0;

const createWishlistRaceFixture = async () => {
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
      name: `Wishlist Race Category ${suffix}`,
      slug: `wishlist-race-category-${suffix}`,
      description: "Category for Wishlist concurrency tests.",
      status: "active",
    })
    .expect(201);

  const brand = await createActiveBrandFixture();

  const createProduct = async (label) => {
    const name = `Wishlist Race Product ${suffix} ${label}`;
    const slug = `wishlist-race-product-${suffix}-${label}`;

    const response = await adminAgent
      .post("/api/v1/admin/products")
      .send({
        name,
        slug,
        shortDescription: "Wishlist concurrency test Product.",
        description: "An active Product for Wishlist concurrency tests.",

        category: categoryResponse.body.data.category.id,
        brand: resolveProductBrandRequestValue(brand),

        materials: ["100% Cotton"],
        careInstructions: ["Machine wash cold"],
        countryOfOrigin: "India",
        tags: ["wishlist-race-test"],

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
            sku: `WISHLIST-RACE-${suffix}-${label.toUpperCase()}`,
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

describe("Wishlist concurrency", () => {
  it.each([
    {
      label: "keeps one entry when the same Product is added concurrently",
      competingForLastSlot: false,
      expectedStatus: 200,
      expectedError: null,
    },
    {
      label: "allows only one Product when requests compete for the last slot",
      competingForLastSlot: true,
      expectedStatus: 409,
      expectedError: "WISHLIST_ITEM_LIMIT_EXCEEDED",
    },
  ])(
    "$label",
    async ({ competingForLastSlot, expectedStatus, expectedError }) => {
      const { agent, user, createProduct } = await createWishlistRaceFixture();

      const requestedProduct = await createProduct("first");

      const competingProduct = competingForLastSlot
        ? await createProduct("second")
        : requestedProduct;

      const initialItems = competingForLastSlot
        ? Array.from({ length: WISHLIST_LIMITS.MAX_ITEMS - 1 }, () => ({
            product: new mongoose.Types.ObjectId(),
            addedAt: new Date("2026-01-01T00:00:00.000Z"),
          }))
        : [];

      // Unavailable entries still occupy Wishlist slots.
      const seededWishlist = await Wishlist.create({
        user: user._id,
        items: initialItems,
      });

      const originalFindWishlist = wishlistRepository.findWishlistByUserId;

      let observedItemCount;
      let competingResponse;
      let winningSnapshot;

      const readSpy = vi
        .spyOn(wishlistRepository, "findWishlistByUserId")
        .mockImplementationOnce(async (...args) => {
          const wishlist = await originalFindWishlist(...args);

          observedItemCount = wishlist?.items.length;

          // Complete the competing request after the first request
          // has loaded its existing Wishlist.
          competingResponse = await agent.post(`${wishlistUrl}/items`).send({
            productId: String(competingProduct._id),
          });

          winningSnapshot = await Wishlist.findOne({
            user: user._id,
          }).lean();

          // Resume the first request with its original snapshot.
          return wishlist;
        });

      try {
        const resumedResponse = await agent.post(`${wishlistUrl}/items`).send({
          productId: String(requestedProduct._id),
        });

        expect(observedItemCount).toBe(initialItems.length);

        const storedWishlists = await Wishlist.find({
          user: user._id,
        }).lean();

        const relevantProductIds = new Set([
          String(requestedProduct._id),
          String(competingProduct._id),
        ]);

        // Keep failure output focused on the competing additions.
        expect({
          competingStatus: competingResponse?.status,
          competingError: competingResponse?.body.errorCode ?? null,

          resumedStatus: resumedResponse.status,
          resumedError: resumedResponse.body.errorCode ?? null,

          wishlistCount: storedWishlists.length,

          itemCount: storedWishlists.reduce(
            (total, wishlist) => total + wishlist.items.length,
            0,
          ),

          relevantEntries: storedWishlists.flatMap((wishlist) =>
            wishlist.items
              .filter((item) => relevantProductIds.has(String(item.product)))
              .map((item) => String(item.product)),
          ),
        }).toEqual({
          competingStatus: 200,
          competingError: null,

          resumedStatus: expectedStatus,
          resumedError: expectedError,

          wishlistCount: 1,
          itemCount: initialItems.length + 1,

          relevantEntries: [String(competingProduct._id)],
        });

        const storedWishlist = storedWishlists[0];

        expect(String(storedWishlist._id)).toBe(String(seededWishlist._id));

        // Duplicate addition or rejected overflow must preserve
        // the winner's entries, order, and original addedAt values.
        expect(storedWishlist.items).toEqual(winningSnapshot.items);

        const getResponse = await agent.get(wishlistUrl).expect(200);

        expect(getResponse.body.data.wishlist.id).toBe(
          String(seededWishlist._id),
        );

        expect(getResponse.body.data.wishlist.itemCount).toBe(
          initialItems.length + 1,
        );
      } finally {
        readSpy.mockRestore();
      }
    },
  );
});

describe("Wishlist concurrency boundaries", () => {
  const addProduct = (agent, product) => {
    return agent.post(`${wishlistUrl}/items`).send({
      productId: String(product._id),
    });
  };

  const deleteProduct = (agent, product) => {
    return agent.delete(`${wishlistUrl}/items/${product._id}`);
  };

  /*
   * These requests start together without mocking repository calls.
   * Check the final database state after both requests complete.
   */
  it.each([
    {
      label:
        "creates one Wishlist for concurrent first adds of the same Product",
      sameProduct: true,
    },
    {
      label:
        "creates one Wishlist and preserves different concurrent first additions",
      sameProduct: false,
    },
  ])("$label", async ({ sameProduct }) => {
    const { agent, user, createProduct } = await createWishlistRaceFixture();

    const firstProduct = await createProduct("first");

    const secondProduct = sameProduct
      ? firstProduct
      : await createProduct("second");

    expect(await Wishlist.countDocuments({ user: user._id })).toBe(0);

    const responses = await Promise.all([
      addProduct(agent, firstProduct),
      addProduct(agent, secondProduct),
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

    const storedWishlists = await Wishlist.find({
      user: user._id,
    }).lean();

    expect(storedWishlists).toHaveLength(1);

    const stored = storedWishlists[0];

    const expectedProductIds = [
      ...new Set([String(firstProduct._id), String(secondProduct._id)]),
    ].sort();

    expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
      expectedProductIds,
    );

    for (const response of responses) {
      expect(response.body.data.wishlist.id).toBe(String(stored._id));
    }

    const getResponse = await agent.get(wishlistUrl).expect(200);

    expect(getResponse.body.data.wishlist.itemCount).toBe(
      expectedProductIds.length,
    );
  });

  /*
   * Force a competing mutation to finish after the first request
   * reads its Wishlist but before it saves.
   */
  it.each([
    {
      label: "preserves an unrelated Product added during deletion",
      scenario: "delete-during-add",
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
      label: "retries clearing the latest Wishlist after an overlapping add",
      scenario: "clear-during-add",
    },
  ])("$label", async ({ scenario }) => {
    const { agent, user, createProduct } = await createWishlistRaceFixture();

    const firstProduct = await createProduct("first");

    const secondProduct =
      scenario === "delete-same" ? null : await createProduct("second");

    const seededProducts =
      scenario === "delete-different"
        ? [firstProduct, secondProduct]
        : [firstProduct];

    const seeded = await Wishlist.create({
      user: user._id,

      items: seededProducts.map((product) => ({
        product: product._id,
        addedAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    });

    const originalRead = wishlistRepository.findWishlistByUserId;

    let interleavingCompleted = false;
    let competingSnapshot;

    const readSpy = vi
      .spyOn(wishlistRepository, "findWishlistByUserId")
      .mockImplementationOnce(async (...args) => {
        const wishlist = await originalRead(...args);

        expect(wishlist.items).toHaveLength(seededProducts.length);

        if (
          scenario === "delete-during-add" ||
          scenario === "clear-during-add"
        ) {
          await addProduct(agent, secondProduct).expect(200);
        } else if (scenario === "delete-same") {
          await deleteProduct(agent, firstProduct).expect(200);
        } else {
          await deleteProduct(agent, secondProduct).expect(200);
        }

        competingSnapshot = await Wishlist.findOne({
          user: user._id,
        }).lean();

        interleavingCompleted = true;

        return wishlist;
      });

    try {
      const response =
        scenario === "clear-during-add"
          ? await agent.delete(wishlistUrl)
          : await deleteProduct(agent, firstProduct);

      expect(interleavingCompleted).toBe(true);

      expect({
        status: response.status,
        errorCode: response.body.errorCode ?? null,
      }).toEqual({
        status: 200,
        errorCode: null,
      });

      const storedWishlists = await Wishlist.find({
        user: user._id,
      }).lean();

      expect(storedWishlists).toHaveLength(1);

      const stored = storedWishlists[0];

      expect(String(stored._id)).toBe(String(seeded._id));

      const expectedProductIds =
        scenario === "delete-during-add" ? [String(secondProduct._id)] : [];

      expect(stored.items.map((item) => String(item.product)).sort()).toEqual(
        expectedProductIds,
      );

      // Any surviving entry must preserve its saved addedAt value.
      for (const item of stored.items) {
        const competingItem = competingSnapshot.items.find(
          (entry) => String(entry.product) === String(item.product),
        );

        expect(item).toEqual(competingItem);
      }

      expect(response.body.data.wishlist.id).toBe(String(seeded._id));

      expect(response.body.data.wishlist.itemCount).toBe(
        expectedProductIds.length,
      );
    } finally {
      readSpy.mockRestore();
    }
  });

  it("returns a controlled conflict after five conflicting save attempts", async () => {
    const { agent, user, createProduct } = await createWishlistRaceFixture();

    const product = await createProduct("first");

    const seeded = await Wishlist.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(wishlistRepository, "saveWishlistDocument")
      .mockImplementation(async (wishlist) => {
        throw new mongoose.Error.VersionError(wishlist, wishlist.__v, [
          "items",
        ]);
      });

    try {
      const response = await addProduct(agent, product);

      expect(response.status).toBe(409);
      expect(response.body.errorCode).toBe("WISHLIST_WRITE_CONFLICT");

      expect(saveSpy).toHaveBeenCalledTimes(5);

      const stored = await Wishlist.findOne({
        user: user._id,
      }).lean();

      expect(String(stored._id)).toBe(String(seeded._id));
      expect(stored.items).toEqual([]);
      expect(stored.__v).toBe(seeded.__v);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("does not retry an unrelated Wishlist save failure", async () => {
    const { agent, user, createProduct } = await createWishlistRaceFixture();

    const product = await createProduct("first");

    const seeded = await Wishlist.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(wishlistRepository, "saveWishlistDocument")
      .mockRejectedValue(new Error("Simulated Wishlist storage failure"));

    try {
      const response = await addProduct(agent, product);

      expect(response.status).toBe(500);
      expect(response.body.errorCode).toBe("INTERNAL_SERVER_ERROR");

      expect(saveSpy).toHaveBeenCalledTimes(1);

      const stored = await Wishlist.findOne({
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
