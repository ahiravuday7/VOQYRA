import { beforeEach, describe, expect, it } from "vitest";

import request from "supertest";

import app from "../../src/app.js";

import Order from "../../src/modules/orders/order.model.js";

import Product from "../../src/modules/products/product.model.js";

import Category from "../../src/modules/categories/category.model.js";

import ProductInventoryLedger from "../../src/modules/products/product-inventory-ledger.model.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

const adminCategoryUrl = "/api/v1/admin/categories";
const adminProductUrl = "/api/v1/admin/products";

let fixtureSequence = 0;

/*
|--------------------------------------------------------------------------
| Authentication Test Wrappers
|--------------------------------------------------------------------------
*/

const createAuthenticatedAdminAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.ADMIN,
  });
};

const createAuthenticatedCustomerAgent = () => {
  return createAuthenticatedAgent({
    role: USER_ROLES.CUSTOMER,
  });
};

/*
|--------------------------------------------------------------------------
| Active Category Fixture
|--------------------------------------------------------------------------
*/

const createActiveCategoryFixture = async (overrides = {}) => {
  const { agent } = await createAuthenticatedAdminAgent();

  fixtureSequence += 1;

  const response = await agent
    .post(adminCategoryUrl)
    .send({
      name: `Order Category ${fixtureSequence}`,
      slug: `order-category-${fixtureSequence}`,
      status: "active",
      ...overrides,
    })
    .expect(201);

  return Category.findById(response.body.data.category.id).lean();
};

/*
|--------------------------------------------------------------------------
| Active Product Fixture
|--------------------------------------------------------------------------
*/

const createActiveProductFixture = async (overrides = {}) => {
  const {
    category,
    name: suppliedName,
    slug: suppliedSlug,
    images: suppliedImages,
    variants: suppliedVariants,
    ...remainingOverrides
  } = overrides;

  if (!category) {
    throw new Error("Active Product fixture requires a Category ID");
  }

  const { agent } = await createAuthenticatedAdminAgent();

  fixtureSequence += 1;

  const name = suppliedName ?? `Order Test Product ${fixtureSequence}`;
  const slug = suppliedSlug ?? `order-test-product-${fixtureSequence}`;

  const images = suppliedImages ?? [
    {
      url: `https://example.com/${slug}.jpg`,
      altText: name,
      sortOrder: 1,
      isPrimary: true,
    },
  ];

  const variants = suppliedVariants ?? [
    {
      sku: `ORDER-TEST-${fixtureSequence}-M`,
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
  ];

  const response = await agent
    .post(adminProductUrl)
    .send({
      shortDescription: "Order integration test Product.",
      description: "An active Product used by Order integration tests.",
      brand: "Aayu & Aura",
      materials: ["100% Cotton"],
      careInstructions: ["Machine wash cold"],
      countryOfOrigin: "India",
      tags: ["order-test"],
      ...remainingOverrides,
      name,
      slug,
      category: String(category),
      images,
      variants,
      status: "active",
    })
    .expect(201);

  return Product.findById(response.body.data.product.id).lean();
};

/*
|--------------------------------------------------------------------------
| Create Order Request Factory
|--------------------------------------------------------------------------
*/

const createOrderRequestBody = ({ productId, variantId, quantity = 2 }) => {
  return {
    items: [
      {
        productId: String(productId),

        variantId: String(variantId),

        quantity,
      },
    ],

    shippingAddress: {
      fullName: "Dipak Ahirav",

      phone: "+91 98765-43210",

      email: "dipak@example.com",

      addressLine1: "Flat 101, Example Residency",

      addressLine2: "Baner Road",

      landmark: "Near Example Mall",

      city: "Pune",

      state: "Maharashtra",

      postalCode: "411045",

      country: "India",
    },

    paymentMethod: "cash-on-delivery",

    customerNote: "Please call before delivery",
  };
};

/*
|--------------------------------------------------------------------------
| Find Product Variant
|--------------------------------------------------------------------------
*/

const findProductVariant = (product, variantId) => {
  return product.variants.find((variant) => {
    return String(variant._id) === String(variantId);
  });
};

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),

    ProductInventoryLedger.deleteMany({}),

    Product.deleteMany({}),
  ]);
});

describe("POST /api/v1/orders", () => {
  /*
    |--------------------------------------------------------------------------
    | Unauthenticated Request
    |--------------------------------------------------------------------------
    */

  it("returns 401 when the user is not authenticated", async () => {
    const response = await request(app).post("/api/v1/orders").send({});

    expect(response.status).toBe(401);

    expect(await Order.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Cannot Use Customer Checkout
    |--------------------------------------------------------------------------
    */

  it("returns 403 when an admin attempts to create a customer Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.post("/api/v1/orders").send({});

    expect(response.status).toBe(403);

    expect(await Order.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Backend-Controlled Fields
    |--------------------------------------------------------------------------
    */

  it("rejects customer-provided pricing and Order status fields", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const requestBody = createOrderRequestBody({
      productId: product._id,

      variantId: variant._id,
    });

    /*
     * These fields must be rejected by strict Zod
     * request validation.
     */
    requestBody.status = "delivered";

    requestBody.totals = {
      grandTotal: 1,
    };

    requestBody.items[0].unitFinalPrice = 1;

    const response = await customerAgent
      .post("/api/v1/orders")
      .send(requestBody);

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(await Order.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Atomic Order Creation
    |--------------------------------------------------------------------------
    */

  it("creates an Order using trusted Product pricing and reserves inventory", async () => {
    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "TSHIRT-BLK-M",

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
    });

    const variant = product.variants[0];

    const response = await customerAgent.post("/api/v1/orders").send(
      createOrderRequestBody({
        productId: product._id,

        variantId: variant._id,

        quantity: 2,
      }),
    );

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    const responseOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Order Reference
        |--------------------------------------------------------------------------
        */

    expect(responseOrder.orderNumber).toMatch(/^ORD-\d{8}-[A-F0-9]{6}$/);

    expect(responseOrder.status).toBe("pending");

    expect(responseOrder.inventoryStatus).toBe("reserved");

    /*
        |--------------------------------------------------------------------------
        | Trusted Pricing
        |--------------------------------------------------------------------------
        */

    expect(responseOrder.items[0].pricing).toEqual({
      currency: "INR",

      unitSellingPrice: 799,

      unitDiscountPrice: 699,

      unitFinalPrice: 699,

      discountPerUnit: 100,

      lineSubtotal: 1398,
    });

    expect(responseOrder.totals).toEqual({
      currency: "INR",

      itemsSubtotal: 1398,

      discountAmount: 0,

      shippingAmount: 0,

      taxAmount: 0,

      grandTotal: 1398,
    });

    /*
        |--------------------------------------------------------------------------
        | Database Order
        |--------------------------------------------------------------------------
        */

    const storedOrder = await Order.findOne({
      orderNumber: responseOrder.orderNumber,
    }).lean();

    expect(storedOrder).not.toBeNull();

    expect(String(storedOrder.customer)).toBe(String(customer._id));

    expect(storedOrder.items[0].inventory.status).toBe("reserved");

    expect(storedOrder.items[0].inventory.reservedQuantity).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Product Inventory
        |--------------------------------------------------------------------------
        */

    const updatedProduct = await Product.findById(product._id).lean();

    const updatedVariant = findProductVariant(updatedProduct, variant._id);

    expect(updatedVariant.inventory.stock).toBe(10);

    expect(updatedVariant.inventory.reservedStock).toBe(4);

    expect(
      updatedVariant.inventory.stock - updatedVariant.inventory.reservedStock,
    ).toBe(6);

    /*
        |--------------------------------------------------------------------------
        | Inventory Ledger
        |--------------------------------------------------------------------------
        */

    const ledgerEntries = await ProductInventoryLedger.find({
      product: product._id,

      variantId: variant._id,
    }).lean();

    expect(ledgerEntries).toHaveLength(1);

    const ledger = ledgerEntries[0];

    expect(ledger.operation).toBe("reserve");

    expect(ledger.quantity).toBe(2);

    expect(ledger.stockDelta).toBe(0);

    expect(ledger.reservedStockDelta).toBe(2);

    expect(ledger.before).toMatchObject({
      stock: 10,

      reservedStock: 2,

      availableStock: 8,
    });

    expect(ledger.after).toMatchObject({
      stock: 10,

      reservedStock: 4,

      availableStock: 6,
    });

    expect(ledger.referenceId).toBe(responseOrder.orderNumber);

    expect(String(ledger.actor)).toBe(String(customer._id));
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Variant Request
    |--------------------------------------------------------------------------
    */

  it("rejects duplicate Product variant items before changing inventory", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const requestBody = createOrderRequestBody({
      productId: product._id,

      variantId: variant._id,

      quantity: 1,
    });

    requestBody.items.push({
      productId: String(product._id),

      variantId: String(variant._id),

      quantity: 1,
    });

    const response = await customerAgent
      .post("/api/v1/orders")
      .send(requestBody);

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.reservedStock).toBe(
      variant.inventory.reservedStock,
    );

    expect(await Order.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Insufficient Available Stock
    |--------------------------------------------------------------------------
    */

  it("returns 409 when available stock is insufficient", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "TSHIRT-BLK-L",

          size: "L",

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
            stock: 5,

            reservedStock: 4,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 260,
          },

          isActive: true,
        },
      ],
    });

    const variant = product.variants[0];

    const response = await customerAgent.post("/api/v1/orders").send(
      createOrderRequestBody({
        productId: product._id,

        variantId: variant._id,

        quantity: 2,
      }),
    );

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_INSUFFICIENT_AVAILABLE_STOCK");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(5);

    expect(unchangedVariant.inventory.reservedStock).toBe(4);

    expect(await Order.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Complete Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back earlier reservations when a later Order item fails", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    /*
     * First Product has enough stock.
     */
    const firstProduct = await createActiveProductFixture({
      category: category._id,

      name: "Available T-Shirt",

      slug: "available-tshirt",

      variants: [
        {
          sku: "AVAILABLE-BLK-M",

          size: "M",

          color: {
            name: "Black",

            code: "#000000",
          },

          pricing: {
            buyingPrice: 300,

            sellingPrice: 700,

            discountPrice: 600,

            currency: "INR",
          },

          inventory: {
            stock: 10,

            reservedStock: 1,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    /*
     * Second Product does not have enough stock.
     */
    const secondProduct = await createActiveProductFixture({
      category: category._id,

      name: "Unavailable T-Shirt",

      slug: "unavailable-tshirt",

      variants: [
        {
          sku: "UNAVAILABLE-BLU-L",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 300,

            sellingPrice: 800,

            discountPrice: 700,

            currency: "INR",
          },

          inventory: {
            stock: 2,

            reservedStock: 1,

            lowStockThreshold: 1,
          },

          shipping: {
            weightInGrams: 270,
          },

          isActive: true,
        },
      ],
    });

    const firstVariant = firstProduct.variants[0];

    const secondVariant = secondProduct.variants[0];

    const requestBody = createOrderRequestBody({
      productId: firstProduct._id,

      variantId: firstVariant._id,

      quantity: 2,
    });

    requestBody.items.push({
      productId: String(secondProduct._id),

      variantId: String(secondVariant._id),

      quantity: 2,
    });

    const response = await customerAgent
      .post("/api/v1/orders")
      .send(requestBody);

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_INSUFFICIENT_AVAILABLE_STOCK");

    /*
        |--------------------------------------------------------------------------
        | First Reservation Must Be Rolled Back
        |--------------------------------------------------------------------------
        */

    const updatedFirstProduct = await Product.findById(firstProduct._id).lean();

    const updatedFirstVariant = findProductVariant(
      updatedFirstProduct,
      firstVariant._id,
    );

    expect(updatedFirstVariant.inventory.stock).toBe(10);

    expect(updatedFirstVariant.inventory.reservedStock).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Second Product Must Remain Unchanged
        |--------------------------------------------------------------------------
        */

    const updatedSecondProduct = await Product.findById(
      secondProduct._id,
    ).lean();

    const updatedSecondVariant = findProductVariant(
      updatedSecondProduct,
      secondVariant._id,
    );

    expect(updatedSecondVariant.inventory.stock).toBe(2);

    expect(updatedSecondVariant.inventory.reservedStock).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | No Transaction Documents Remain
        |--------------------------------------------------------------------------
        */

    expect(await Order.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });
});
