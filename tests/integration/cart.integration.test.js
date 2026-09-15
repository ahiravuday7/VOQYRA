import mongoose from "mongoose";

import { describe, expect, it, vi } from "vitest";

import request from "supertest";

import app from "../../src/app.js";

import * as cartRepository from "../../src/modules/cart/cart.repository.js";

import Cart from "../../src/modules/cart/cart.model.js";

import Product from "../../src/modules/products/product.model.js";

import Category from "../../src/modules/categories/category.model.js";

import { CART_LIMITS } from "../../src/modules/cart/cart.constants.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import {
  createActiveBrandFixture,
  resolveProductBrandRequestValue,
} from "../helpers/product-brand-test.helper.js";

/*
|--------------------------------------------------------------------------
| URLs
|--------------------------------------------------------------------------
*/

const cartUrl = "/api/v1/cart";

const adminCategoryUrl = "/api/v1/admin/categories";

const adminProductUrl = "/api/v1/admin/products";

let fixtureSequence = 0;

/*
|--------------------------------------------------------------------------
| Authentication Helpers
|--------------------------------------------------------------------------
*/

const createAuthenticatedCustomerAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });
};

const createAuthenticatedAdminAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });
};

/*
|--------------------------------------------------------------------------
| Category Fixture
|--------------------------------------------------------------------------
*/

const createActiveCategoryFixture = async (options = {}) => {
  const { agent: suppliedAgent } = options;

  let agent = suppliedAgent;

  if (!agent) {
    const auth = await createAuthenticatedAdminAgent();

    agent = auth.agent;
  }

  fixtureSequence += 1;

  const suffix = fixtureSequence;

  const response = await agent
    .post(adminCategoryUrl)
    .send({
      name: `Cart Test Category ${suffix}`,

      slug: `cart-test-category-${suffix}`,

      description: "Category used by Cart integration tests.",

      status: "active",
    })
    .expect(201);

  return Category.findById(response.body.data.category.id).lean();
};

/*
|--------------------------------------------------------------------------
| Product Fixture
|--------------------------------------------------------------------------
*/

const createActiveProductFixture = async (overrides = {}) => {
  const {
    agent: suppliedAgent,

    category: suppliedCategory,

    brand: suppliedBrand,

    name: suppliedName,

    slug: suppliedSlug,

    images: suppliedImages,

    variants: suppliedVariants,

    variantCount = 1,

    stock = 10,

    reservedStock = 0,

    sellingPrice = 799,

    discountPrice = 699,

    ...remainingOverrides
  } = overrides;

  let agent = suppliedAgent;

  if (!agent) {
    const auth = await createAuthenticatedAdminAgent();

    agent = auth.agent;
  }

  const category =
    suppliedCategory ??
    (await createActiveCategoryFixture({
      agent,
    }));

  const brand = suppliedBrand ?? (await createActiveBrandFixture());

  const productBrandValue = resolveProductBrandRequestValue(brand);

  fixtureSequence += 1;

  const suffix = fixtureSequence;

  const name = suppliedName ?? `Cart Test Product ${suffix}`;

  const slug = suppliedSlug ?? `cart-test-product-${suffix}`;

  const images = suppliedImages ?? [
    {
      url: `https://example.com/${slug}.jpg`,

      altText: name,

      sortOrder: 1,

      isPrimary: true,
    },
  ];

  const defaultSizes = ["M", "L", "XL", "XXL"];

  const variants =
    suppliedVariants ??
    Array.from(
      {
        length: variantCount,
      },
      (_, index) => {
        return {
          sku: `CART-TEST-${suffix}-${index + 1}`,

          size: defaultSizes[index % defaultSizes.length],

          color: {
            name: `Color ${index + 1}`,

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
        };
      },
    );

  const response = await agent
    .post(adminProductUrl)
    .send({
      shortDescription: "Cart integration test Product.",

      description: "An active Product used by Cart integration tests.",

      brand: productBrandValue,

      materials: ["100% Cotton"],

      careInstructions: ["Machine wash cold"],

      countryOfOrigin: "India",

      tags: ["cart-test"],

      ...remainingOverrides,

      name,

      slug,

      category: String(category._id),

      images,

      variants,

      status: "active",
    })
    .expect(201);

  return Product.findById(response.body.data.product.id).lean();
};

/*
|--------------------------------------------------------------------------
| Cart Request Helper
|--------------------------------------------------------------------------
*/

const addProductToCart = async ({
  agent,

  product,

  variant = product.variants[0],

  quantity = 1,

  expectedStatus = 201,
}) => {
  return agent
    .post(`${cartUrl}/items`)
    .send({
      productId: String(product._id),

      variantId: String(variant._id),

      quantity,
    })
    .expect(expectedStatus);
};

/*
|--------------------------------------------------------------------------
| Customer Cart Integration Tests
|--------------------------------------------------------------------------
*/

describe("Customer Cart API", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("rejects unauthenticated customers", async () => {
    await request(app).get(cartUrl).expect(401);
  });

  it("rejects authenticated non-customer users", async () => {
    const { agent } = await createAuthenticatedAdminAgent();

    await agent.get(cartUrl).expect(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Empty Cart
    |--------------------------------------------------------------------------
    */

  it("returns an empty cart without creating a Cart document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const response = await agent.get(cartUrl).expect(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Cart retrieved successfully");

    expect(response.body.data.cart).toEqual({
      id: null,

      items: [],

      itemCount: 0,

      totalQuantity: 0,

      summary: {
        subtotal: 0,

        currency: "INR",
      },
    });

    const storedCart = await Cart.findOne({
      user: user._id,
    });

    expect(storedCart).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Add Item
    |--------------------------------------------------------------------------
    */

  it("adds an active Product variant to the customer cart", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const variant = product.variants[0];

    const response = await addProductToCart({
      agent,

      product,

      variant,

      quantity: 2,
    });

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Cart item added successfully");

    const cart = response.body.data.cart;

    expect(cart.id).toBeTruthy();

    expect(cart.itemCount).toBe(1);

    expect(cart.totalQuantity).toBe(2);

    expect(cart.items).toHaveLength(1);

    const item = cart.items[0];

    expect(item.product.id).toBe(String(product._id));

    expect(item.product.name).toBe(product.name);

    expect(item.variant.id).toBe(String(variant._id));

    expect(item.variant.sku).toBe(variant.sku);

    expect(item.quantity).toBe(2);

    expect(item.pricing.unitPrice).toBe(699);

    expect(item.pricing.subtotal).toBe(1398);

    expect(item.inventory.availableStock).toBe(10);

    expect(item.availability).toEqual({
      isAvailable: true,

      reason: null,
    });

    expect(cart.summary.subtotal).toBe(1398);

    expect(cart.summary.currency).toBe("INR");
  });

  it("increases quantity when the same Product variant is added again", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToCart({
      agent,

      product,

      quantity: 2,
    });

    const response = await addProductToCart({
      agent,

      product,

      quantity: 3,
    });

    const cart = response.body.data.cart;

    expect(cart.itemCount).toBe(1);

    expect(cart.totalQuantity).toBe(5);

    expect(cart.items).toHaveLength(1);

    expect(cart.items[0].quantity).toBe(5);

    expect(cart.items[0].pricing.subtotal).toBe(3495);

    expect(cart.summary.subtotal).toBe(3495);
  });

  it("keeps different variants of the same Product as separate cart items", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    await addProductToCart({
      agent,

      product,

      variant: product.variants[0],

      quantity: 1,
    });

    const response = await addProductToCart({
      agent,

      product,

      variant: product.variants[1],

      quantity: 2,
    });

    const cart = response.body.data.cart;

    expect(cart.itemCount).toBe(2);

    expect(cart.totalQuantity).toBe(3);

    expect(cart.items).toHaveLength(2);

    expect(cart.summary.subtotal).toBe(699 * 3);
  });

  /*
    |--------------------------------------------------------------------------
    | Inventory Reservation Rule
    |--------------------------------------------------------------------------
    */

  it("does not reserve Product inventory when an item is added to Cart", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,

      reservedStock: 2,
    });

    const variant = product.variants[0];

    await addProductToCart({
      agent,

      product,

      variant,

      quantity: 3,
    });

    const refreshedProduct = await Product.findById(product._id);

    const refreshedVariant = refreshedProduct.variants.id(variant._id);

    expect(refreshedVariant.inventory.stock).toBe(10);

    expect(refreshedVariant.inventory.reservedStock).toBe(2);

    expect(
      refreshedVariant.inventory.stock -
        refreshedVariant.inventory.reservedStock,
    ).toBe(8);
  });

  /*
    |--------------------------------------------------------------------------
    | Stock Validation
    |--------------------------------------------------------------------------
    */

  it("rejects adding quantity greater than available stock", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,

      reservedStock: 2,
    });

    const response = await addProductToCart({
      agent,

      product,

      quantity: 9,

      expectedStatus: 409,
    });

    expect(response.body.errorCode).toBe("CART_INSUFFICIENT_STOCK");

    const cart = await Cart.findOne({
      user: user._id,
    });

    expect(cart.items).toHaveLength(0);
  });

  it("rejects merged quantity when final quantity exceeds available stock", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
    });

    await addProductToCart({
      agent,

      product,

      quantity: 6,
    });

    const response = await addProductToCart({
      agent,

      product,

      quantity: 5,

      expectedStatus: 409,
    });

    expect(response.body.errorCode).toBe("CART_INSUFFICIENT_STOCK");

    const getResponse = await agent.get(cartUrl).expect(200);

    expect(getResponse.body.data.cart.items[0].quantity).toBe(6);
  });

  /*
    |--------------------------------------------------------------------------
    | Product Validation
    |--------------------------------------------------------------------------
    */

  it("rejects a missing Product", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${cartUrl}/items`)
      .send({
        productId: new mongoose.Types.ObjectId().toString(),

        variantId: new mongoose.Types.ObjectId().toString(),

        quantity: 1,
      })
      .expect(404);

    expect(response.body.errorCode).toBe("CART_PRODUCT_NOT_FOUND");
  });

  it("rejects an inactive Product", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await Product.updateOne(
      {
        _id: product._id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    const response = await addProductToCart({
      agent,

      product,

      expectedStatus: 409,
    });

    expect(response.body.errorCode).toBe("CART_PRODUCT_UNAVAILABLE");
  });

  /*
    |--------------------------------------------------------------------------
    | Variant Validation
    |--------------------------------------------------------------------------
    */

  it("rejects a missing Product variant", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const response = await agent
      .post(`${cartUrl}/items`)
      .send({
        productId: String(product._id),

        variantId: new mongoose.Types.ObjectId().toString(),

        quantity: 1,
      })
      .expect(404);

    expect(response.body.errorCode).toBe("CART_VARIANT_NOT_FOUND");
  });

  it("rejects an inactive Product variant", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const variant = product.variants[0];

    await Product.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },
      {
        $set: {
          "variants.$.isActive": false,
        },
      },
    );

    const response = await addProductToCart({
      agent,

      product,

      variant,

      expectedStatus: 409,
    });

    expect(response.body.errorCode).toBe("CART_VARIANT_UNAVAILABLE");
  });

  /*
    |--------------------------------------------------------------------------
    | Maximum Quantity
    |--------------------------------------------------------------------------
    */

  it("rejects merged quantity above the Cart per-item maximum", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: CART_LIMITS.MAX_QUANTITY_PER_ITEM + 50,
    });

    await addProductToCart({
      agent,

      product,

      quantity: CART_LIMITS.MAX_QUANTITY_PER_ITEM,
    });

    const response = await addProductToCart({
      agent,

      product,

      quantity: 1,

      expectedStatus: 400,
    });

    expect(response.body.errorCode).toBe("CART_QUANTITY_INVALID");

    const getResponse = await agent.get(cartUrl).expect(200);

    expect(getResponse.body.data.cart.items[0].quantity).toBe(
      CART_LIMITS.MAX_QUANTITY_PER_ITEM,
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Update Item Quantity
    |--------------------------------------------------------------------------
    */

  it("updates the final quantity of an existing Cart item", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const addResponse = await addProductToCart({
      agent,

      product,

      quantity: 2,
    });

    const itemId = addResponse.body.data.cart.items[0].id;

    const response = await agent
      .patch(`${cartUrl}/items/${itemId}`)
      .send({
        quantity: 4,
      })
      .expect(200);

    expect(response.body.message).toBe("Cart item updated successfully");

    const cart = response.body.data.cart;

    expect(cart.itemCount).toBe(1);

    expect(cart.totalQuantity).toBe(4);

    expect(cart.items[0].quantity).toBe(4);

    expect(cart.items[0].pricing.subtotal).toBe(699 * 4);
  });

  it("rejects updating an item above available stock and preserves the old quantity", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
    });

    const addResponse = await addProductToCart({
      agent,

      product,

      quantity: 2,
    });

    const itemId = addResponse.body.data.cart.items[0].id;

    const response = await agent
      .patch(`${cartUrl}/items/${itemId}`)
      .send({
        quantity: 11,
      })
      .expect(409);

    expect(response.body.errorCode).toBe("CART_INSUFFICIENT_STOCK");

    const getResponse = await agent.get(cartUrl).expect(200);

    expect(getResponse.body.data.cart.items[0].quantity).toBe(2);
  });

  it("returns not found when updating a missing Cart item", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const itemId = new mongoose.Types.ObjectId().toString();

    const response = await agent
      .patch(`${cartUrl}/items/${itemId}`)
      .send({
        quantity: 1,
      })
      .expect(404);

    expect(response.body.errorCode).toBe("CART_ITEM_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Delete Item
    |--------------------------------------------------------------------------
    */

  it("deletes a single Cart item", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const addResponse = await addProductToCart({
      agent,

      product,
    });

    const itemId = addResponse.body.data.cart.items[0].id;

    const response = await agent
      .delete(`${cartUrl}/items/${itemId}`)
      .expect(200);

    expect(response.body.message).toBe("Cart item deleted successfully");

    expect(response.body.data.cart.items).toHaveLength(0);

    expect(response.body.data.cart.itemCount).toBe(0);

    expect(response.body.data.cart.totalQuantity).toBe(0);
  });

  it("returns not found when deleting a missing Cart item", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const itemId = new mongoose.Types.ObjectId().toString();

    const response = await agent
      .delete(`${cartUrl}/items/${itemId}`)
      .expect(404);

    expect(response.body.errorCode).toBe("CART_ITEM_NOT_FOUND");
  });

  it("allows deleting a stale Cart item whose Product no longer exists", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const addResponse = await addProductToCart({
      agent,

      product,
    });

    const itemId = addResponse.body.data.cart.items[0].id;

    await Product.collection.deleteOne({
      _id: product._id,
    });

    const response = await agent
      .delete(`${cartUrl}/items/${itemId}`)
      .expect(200);

    expect(response.body.data.cart.items).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Clear Cart
    |--------------------------------------------------------------------------
    */

  it("clears all items while keeping the Cart document", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    await addProductToCart({
      agent,

      product,

      variant: product.variants[0],
    });

    await addProductToCart({
      agent,

      product,

      variant: product.variants[1],
    });

    const response = await agent.delete(cartUrl).expect(200);

    expect(response.body.message).toBe("Cart cleared successfully");

    expect(response.body.data.cart.items).toHaveLength(0);

    expect(response.body.data.cart.itemCount).toBe(0);

    expect(response.body.data.cart.totalQuantity).toBe(0);

    const storedCart = await Cart.findOne({
      user: user._id,
    });

    expect(storedCart).not.toBeNull();

    expect(storedCart.items).toHaveLength(0);
  });

  it("treats clearing a non-existing Cart as an idempotent success", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent.delete(cartUrl).expect(200);

    expect(response.body.data.cart).toEqual({
      id: null,

      items: [],

      itemCount: 0,

      totalQuantity: 0,

      summary: {
        subtotal: 0,

        currency: "INR",
      },
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Customer Isolation
    |--------------------------------------------------------------------------
    */

  it("keeps each customer's Cart isolated", async () => {
    const { agent: firstCustomer } = await createAuthenticatedCustomerAgent();

    const { agent: secondCustomer } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToCart({
      agent: firstCustomer,

      product,

      quantity: 2,
    });

    const firstResponse = await firstCustomer.get(cartUrl).expect(200);

    const secondResponse = await secondCustomer.get(cartUrl).expect(200);

    expect(firstResponse.body.data.cart.itemCount).toBe(1);

    expect(secondResponse.body.data.cart.itemCount).toBe(0);

    expect(secondResponse.body.data.cart.items).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Current Product Price + Stock
    |--------------------------------------------------------------------------
    */

  it("uses current Product pricing and inventory when Cart is read", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,

      discountPrice: 699,
    });

    const variant = product.variants[0];

    await addProductToCart({
      agent,

      product,

      variant,

      quantity: 2,
    });

    await Product.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },
      {
        $set: {
          "variants.$.pricing.discountPrice": 599,

          "variants.$.inventory.stock": 8,

          "variants.$.inventory.reservedStock": 3,
        },
      },
    );

    const response = await agent.get(cartUrl).expect(200);

    const item = response.body.data.cart.items[0];

    expect(item.pricing.unitPrice).toBe(599);

    expect(item.pricing.subtotal).toBe(599 * 2);

    expect(item.inventory.availableStock).toBe(5);

    expect(item.availability.isAvailable).toBe(true);

    expect(response.body.data.cart.summary.subtotal).toBe(599 * 2);
  });

  /*
    |--------------------------------------------------------------------------
    | Stale Cart Availability
    |--------------------------------------------------------------------------
    */

  it("marks an item unavailable when its Product becomes inactive", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToCart({
      agent,

      product,

      quantity: 2,
    });

    await Product.updateOne(
      {
        _id: product._id,
      },
      {
        $set: {
          status: "inactive",
        },
      },
    );

    const response = await agent.get(cartUrl).expect(200);

    const item = response.body.data.cart.items[0];

    expect(item.availability).toEqual({
      isAvailable: false,

      reason: "PRODUCT_UNAVAILABLE",
    });

    expect(item.pricing.subtotal).toBe(0);

    expect(response.body.data.cart.summary.subtotal).toBe(0);
  });

  it("marks an item unavailable when its variant becomes inactive", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const variant = product.variants[0];

    await addProductToCart({
      agent,

      product,

      variant,
    });

    await Product.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },
      {
        $set: {
          "variants.$.isActive": false,
        },
      },
    );

    const response = await agent.get(cartUrl).expect(200);

    expect(response.body.data.cart.items[0].availability).toEqual({
      isAvailable: false,

      reason: "VARIANT_UNAVAILABLE",
    });

    expect(response.body.data.cart.items[0].pricing.subtotal).toBe(0);
  });

  it("marks an item unavailable when current stock falls below Cart quantity", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 10,
    });

    const variant = product.variants[0];

    await addProductToCart({
      agent,

      product,

      variant,

      quantity: 4,
    });

    await Product.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },
      {
        $set: {
          "variants.$.inventory.stock": 3,

          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await agent.get(cartUrl).expect(200);

    const item = response.body.data.cart.items[0];

    expect(item.inventory.availableStock).toBe(3);

    expect(item.availability).toEqual({
      isAvailable: false,

      reason: "INSUFFICIENT_STOCK",
    });

    expect(item.pricing.subtotal).toBe(0);
  });

  it("keeps a stale Cart item readable when the Product no longer exists", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    await addProductToCart({
      agent,

      product,
    });

    await Product.collection.deleteOne({
      _id: product._id,
    });

    const response = await agent.get(cartUrl).expect(200);

    const item = response.body.data.cart.items[0];

    expect(item.product).toBeNull();

    expect(item.availability).toEqual({
      isAvailable: false,

      reason: "PRODUCT_NOT_FOUND",
    });

    expect(item.pricing.subtotal).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects malformed Cart item identifiers", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${cartUrl}/items`)
      .send({
        productId: "invalid-product-id",

        variantId: "invalid-variant-id",

        quantity: 1,
      })
      .expect(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("rejects zero Cart quantity", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${cartUrl}/items`)
      .send({
        productId: new mongoose.Types.ObjectId().toString(),

        variantId: new mongoose.Types.ObjectId().toString(),

        quantity: 0,
      })
      .expect(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("rejects quantity above the request maximum", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    const response = await agent
      .post(`${cartUrl}/items`)
      .send({
        productId: new mongoose.Types.ObjectId().toString(),

        variantId: new mongoose.Types.ObjectId().toString(),

        quantity: CART_LIMITS.MAX_QUANTITY_PER_ITEM + 1,
      })
      .expect(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("rejects invalid Cart item IDs on update", async () => {
    const { agent } = await createAuthenticatedCustomerAgent();

    await agent
      .patch(`${cartUrl}/items/not-a-valid-id`)
      .send({
        quantity: 1,
      })
      .expect(400);
  });

  /*
    |--------------------------------------------------------------------------
    | Cart Item Limit
    |--------------------------------------------------------------------------
    */

  it("rejects adding more than the maximum number of unique Cart items", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const category = await createActiveCategoryFixture({
      agent: adminAgent,
    });

    const brand = await createActiveBrandFixture();

    for (let index = 0; index < CART_LIMITS.MAX_ITEMS; index += 1) {
      const product = await createActiveProductFixture({
        agent: adminAgent,

        category,

        brand,
      });

      await addProductToCart({
        agent: customerAgent,

        product,

        quantity: 1,
      });
    }

    const overflowProduct = await createActiveProductFixture({
      agent: adminAgent,

      category,

      brand,
    });

    const response = await addProductToCart({
      agent: customerAgent,

      product: overflowProduct,

      quantity: 1,

      expectedStatus: 409,
    });

    expect(response.body.errorCode).toBe("CART_ITEM_LIMIT_EXCEEDED");

    const getResponse = await customerAgent.get(cartUrl).expect(200);

    expect(getResponse.body.data.cart.itemCount).toBe(CART_LIMITS.MAX_ITEMS);

    expect(getResponse.body.data.cart.totalQuantity).toBe(
      CART_LIMITS.MAX_ITEMS,
    );
  });
});

describe("Cart concurrency", () => {
  it.each([
    {
      label: "merges overlapping first additions into one Cart item",
      initialQuantity: 0,
    },
    {
      label: "preserves both overlapping increases to an existing Cart item",
      initialQuantity: 2,
    },
  ])("$label", async ({ initialQuantity }) => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      stock: 20,
      reservedStock: 2,
    });

    const variant = product.variants[0];

    if (initialQuantity > 0) {
      await addProductToCart({
        agent,
        product,
        quantity: initialQuantity,
      });
    }

    const originalCart = await Cart.findOne({
      user: user._id,
    }).lean();

    const originalFindOrCreate = cartRepository.findOrCreateCartByUserId;

    let competingResponse;
    let observedQuantity;
    let observedCartId;

    const findOrCreateSpy = vi
      .spyOn(cartRepository, "findOrCreateCartByUserId")
      .mockImplementationOnce(async (...args) => {
        // Capture the first request's real database snapshot.
        const cart = await originalFindOrCreate(...args);

        observedCartId = String(cart._id);

        const item = cart.items.find(
          (entry) =>
            String(entry.product) === String(product._id) &&
            String(entry.variantId) === String(variant._id),
        );

        observedQuantity = item?.quantity ?? 0;

        // Complete another real API request before returning
        // the first request's now-stale Cart document.
        competingResponse = await agent.post(`${cartUrl}/items`).send({
          productId: String(product._id),
          variantId: String(variant._id),
          quantity: 3,
        });

        return cart;
      });

    try {
      const resumedResponse = await agent.post(`${cartUrl}/items`).send({
        productId: String(product._id),
        variantId: String(variant._id),
        quantity: 2,
      });

      const storedCarts = await Cart.find({
        user: user._id,
      }).lean();

      // Confirm that the intended stale read actually occurred.
      expect(observedQuantity).toBe(initialQuantity);

      // Include response errors and stored quantities in failure output.
      expect({
        competingStatus: competingResponse?.status,
        competingError: competingResponse?.body.errorCode ?? null,
        resumedStatus: resumedResponse.status,
        resumedError: resumedResponse.body.errorCode ?? null,
        cartCount: storedCarts.length,
        storedItems: storedCarts.flatMap((cart) =>
          cart.items.map((item) => ({
            productId: String(item.product),
            variantId: String(item.variantId),
            quantity: item.quantity,
          })),
        ),
      }).toEqual({
        competingStatus: 201,
        competingError: null,
        resumedStatus: 201,
        resumedError: null,
        cartCount: 1,
        storedItems: [
          {
            productId: String(product._id),
            variantId: String(variant._id),
            quantity: initialQuantity + 5,
          },
        ],
      });

      const storedCart = storedCarts[0];

      expect(String(storedCart._id)).toBe(observedCartId);

      if (originalCart) {
        expect(String(storedCart._id)).toBe(String(originalCart._id));

        expect(String(storedCart.items[0]._id)).toBe(
          String(originalCart.items[0]._id),
        );
      }

      const getResponse = await agent.get(cartUrl).expect(200);

      expect(getResponse.body.data.cart.itemCount).toBe(1);
      expect(getResponse.body.data.cart.totalQuantity).toBe(
        initialQuantity + 5,
      );

      // Adding to Cart must never reserve or consume inventory.
      const refreshedProduct = await Product.findById(product._id).lean();

      const refreshedVariant = refreshedProduct.variants.find(
        (entry) => String(entry._id) === String(variant._id),
      );

      expect(refreshedVariant.inventory).toEqual(variant.inventory);
    } finally {
      findOrCreateSpy.mockRestore();
    }
  });
});

describe("Cart concurrency boundaries", () => {
  /*
   * Complete another request after the first request reads its Cart.
   * The first request then resumes with its original document.
   */
  const withInterleavedCartRead = async ({
    method,
    competingRequest,
    resumedRequest,
  }) => {
    const originalRead = cartRepository[method];
    let interleavingCompleted = false;

    const readSpy = vi
      .spyOn(cartRepository, method)
      .mockImplementationOnce(async (...args) => {
        const cart = await originalRead(...args);

        await competingRequest();

        interleavingCompleted = true;

        return cart;
      });

    try {
      const response = await resumedRequest();

      expect(interleavingCompleted).toBe(true);

      return response;
    } finally {
      readSpy.mockRestore();
    }
  };

  const postCartItem = (
    agent,
    product,
    quantity,
    variant = product.variants[0],
  ) => {
    return agent.post(`${cartUrl}/items`).send({
      productId: String(product._id),
      variantId: String(variant._id),
      quantity,
    });
  };

  const expectInventoryUnchanged = async (product) => {
    const refreshed = await Product.findById(product._id).lean();

    expect(
      refreshed.variants.map((variant) => ({
        id: String(variant._id),
        inventory: variant.inventory,
      })),
    ).toEqual(
      product.variants.map((variant) => ({
        id: String(variant._id),
        inventory: variant.inventory,
      })),
    );
  };

  /*
   * Both requests fit the original quantity.
   * After the competing request succeeds, the resumed request
   * must reload and reject its now-invalid merged quantity.
   */
  it.each([
    {
      label: "rechecks available stock after a conflicting add",
      stock: 10,
      reservedStock: 2,
      initialQuantity: 6,
      expectedStatus: 409,
      expectedError: "CART_INSUFFICIENT_STOCK",
    },
    {
      label: "rechecks the per-item maximum after a conflicting add",
      stock: CART_LIMITS.MAX_QUANTITY_PER_ITEM + 20,
      reservedStock: 0,
      initialQuantity: CART_LIMITS.MAX_QUANTITY_PER_ITEM - 2,
      expectedStatus: 400,
      expectedError: "CART_QUANTITY_INVALID",
    },
  ])(
    "$label",
    async ({
      stock,
      reservedStock,
      initialQuantity,
      expectedStatus,
      expectedError,
    }) => {
      const { agent, user } = await createAuthenticatedCustomerAgent();

      const product = await createActiveProductFixture({
        stock,
        reservedStock,
      });

      await addProductToCart({
        agent,
        product,
        quantity: initialQuantity,
      });

      const before = await Cart.findOne({ user: user._id }).lean();

      const response = await withInterleavedCartRead({
        method: "findOrCreateCartByUserId",

        competingRequest: () => postCartItem(agent, product, 1).expect(201),

        resumedRequest: () => postCartItem(agent, product, 2),
      });

      expect(response.status).toBe(expectedStatus);
      expect(response.body.errorCode).toBe(expectedError);

      const stored = await Cart.findOne({ user: user._id }).lean();

      expect(String(stored._id)).toBe(String(before._id));
      expect(stored.items).toHaveLength(1);
      expect(String(stored.items[0]._id)).toBe(String(before.items[0]._id));
      expect(stored.items[0].quantity).toBe(initialQuantity + 1);

      await expectInventoryUnchanged(product);
    },
  );

  it("allows only one new item when requests compete for the last slot", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    // Stale entries still count toward the Cart item limit.
    const seeded = await Cart.create({
      user: user._id,
      items: Array.from({ length: CART_LIMITS.MAX_ITEMS - 1 }, () => ({
        product: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        quantity: 1,
      })),
    });

    const originalItemIds = seeded.items.map((item) => String(item._id));

    const response = await withInterleavedCartRead({
      method: "findOrCreateCartByUserId",

      competingRequest: () =>
        postCartItem(agent, product, 1, product.variants[1]).expect(201),

      resumedRequest: () =>
        postCartItem(agent, product, 1, product.variants[0]),
    });

    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe("CART_ITEM_LIMIT_EXCEEDED");

    const stored = await Cart.findOne({ user: user._id }).lean();

    expect(String(stored._id)).toBe(String(seeded._id));
    expect(stored.items).toHaveLength(CART_LIMITS.MAX_ITEMS);

    expect(
      stored.items
        .filter((item) => originalItemIds.includes(String(item._id)))
        .map((item) => String(item._id))
        .sort(),
    ).toEqual([...originalItemIds].sort());

    const newItems = stored.items.filter(
      (item) => String(item.product) === String(product._id),
    );

    expect(newItems).toHaveLength(1);
    expect(String(newItems[0].variantId)).toBe(String(product.variants[1]._id));
    expect(newItems[0].quantity).toBe(1);

    await expectInventoryUnchanged(product);
  });

  it("creates one Cart and preserves different variants during concurrent first adds", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    expect(await Cart.countDocuments({ user: user._id })).toBe(0);

    const responses = await Promise.all([
      postCartItem(agent, product, 2, product.variants[0]),
      postCartItem(agent, product, 3, product.variants[1]),
    ]);

    expect(
      responses.map((response) => ({
        status: response.status,
        errorCode: response.body.errorCode ?? null,
      })),
    ).toEqual([
      { status: 201, errorCode: null },
      { status: 201, errorCode: null },
    ]);

    const carts = await Cart.find({ user: user._id }).lean();

    expect(carts).toHaveLength(1);
    expect(carts[0].items).toHaveLength(2);

    const quantities = Object.fromEntries(
      carts[0].items.map((item) => [String(item.variantId), item.quantity]),
    );

    expect(quantities).toEqual({
      [String(product.variants[0]._id)]: 2,
      [String(product.variants[1]._id)]: 3,
    });

    for (const response of responses) {
      expect(response.body.data.cart.id).toBe(String(carts[0]._id));
    }

    await expectInventoryUnchanged(product);
  });

  it.each([
    {
      label: "does not restore an item deleted during a quantity update",
      competingAction: "delete",
    },
    {
      label: "does not restore an item cleared during a quantity update",
      competingAction: "clear",
    },
  ])("$label", async ({ competingAction }) => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const added = await addProductToCart({
      agent,
      product,
      quantity: 2,
    });

    const cartId = added.body.data.cart.id;
    const itemId = added.body.data.cart.items[0].id;

    const response = await withInterleavedCartRead({
      method: "findCartByUserId",

      competingRequest: () =>
        agent
          .delete(
            competingAction === "delete"
              ? `${cartUrl}/items/${itemId}`
              : cartUrl,
          )
          .expect(200),

      resumedRequest: () =>
        agent.patch(`${cartUrl}/items/${itemId}`).send({
          quantity: 4,
        }),
    });

    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe("CART_ITEM_NOT_FOUND");

    const stored = await Cart.findOne({ user: user._id }).lean();

    expect(String(stored._id)).toBe(cartId);
    expect(stored.items).toHaveLength(0);

    await expectInventoryUnchanged(product);
  });

  it("preserves an unrelated item added while deleting an existing item", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    const added = await addProductToCart({
      agent,
      product,
      variant: product.variants[0],
      quantity: 2,
    });

    const cartId = added.body.data.cart.id;
    const itemId = added.body.data.cart.items[0].id;

    const response = await withInterleavedCartRead({
      method: "findCartByUserId",

      competingRequest: () =>
        postCartItem(agent, product, 3, product.variants[1]).expect(201),

      resumedRequest: () => agent.delete(`${cartUrl}/items/${itemId}`),
    });

    expect(response.status).toBe(200);

    const stored = await Cart.findOne({ user: user._id }).lean();

    expect(String(stored._id)).toBe(cartId);
    expect(stored.items).toHaveLength(1);
    expect(String(stored.items[0].variantId)).toBe(
      String(product.variants[1]._id),
    );
    expect(stored.items[0].quantity).toBe(3);
    expect(stored.items.some((item) => String(item._id) === itemId)).toBe(
      false,
    );

    await expectInventoryUnchanged(product);
  });

  it("retries clearing the latest Cart after an overlapping add", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture({
      variantCount: 2,
    });

    const added = await addProductToCart({
      agent,
      product,
      variant: product.variants[0],
      quantity: 2,
    });

    const response = await withInterleavedCartRead({
      method: "findCartByUserId",

      competingRequest: () =>
        postCartItem(agent, product, 3, product.variants[1]).expect(201),

      resumedRequest: () => agent.delete(cartUrl),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.cart.items).toEqual([]);

    const stored = await Cart.findOne({ user: user._id }).lean();

    expect(String(stored._id)).toBe(added.body.data.cart.id);
    expect(stored.items).toHaveLength(0);

    await expectInventoryUnchanged(product);
  });

  it("returns a controlled conflict when all five save attempts conflict", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await Cart.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(cartRepository, "saveCartDocument")
      .mockImplementation(async (cart) => {
        throw new mongoose.Error.VersionError(cart, cart.__v, ["items"]);
      });

    try {
      const response = await postCartItem(agent, product, 2);

      expect(response.status).toBe(409);
      expect(response.body.errorCode).toBe("CART_WRITE_CONFLICT");
      expect(saveSpy).toHaveBeenCalledTimes(5);

      const stored = await Cart.findOne({ user: user._id }).lean();

      expect(String(stored._id)).toBe(String(seeded._id));
      expect(stored.items).toHaveLength(0);
      expect(stored.__v).toBe(seeded.__v);

      await expectInventoryUnchanged(product);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("does not retry an unrelated save failure", async () => {
    const { agent, user } = await createAuthenticatedCustomerAgent();

    const product = await createActiveProductFixture();

    const seeded = await Cart.create({
      user: user._id,
      items: [],
    });

    const saveSpy = vi
      .spyOn(cartRepository, "saveCartDocument")
      .mockRejectedValue(new Error("Simulated Cart storage failure"));

    try {
      const response = await postCartItem(agent, product, 2);

      expect(response.status).toBe(500);
      expect(response.body.errorCode).toBe("INTERNAL_SERVER_ERROR");
      expect(saveSpy).toHaveBeenCalledTimes(1);

      const stored = await Cart.findOne({ user: user._id }).lean();

      expect(String(stored._id)).toBe(String(seeded._id));
      expect(stored.items).toHaveLength(0);
      expect(stored.__v).toBe(seeded.__v);

      await expectInventoryUnchanged(product);
    } finally {
      saveSpy.mockRestore();
    }
  });
});
