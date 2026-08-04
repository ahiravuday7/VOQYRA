import mongoose from "mongoose";

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
| Create Customer Order Through API
|--------------------------------------------------------------------------
|
| Creates a real Order using the public customer endpoint.
|--------------------------------------------------------------------------
*/

const createCustomerOrderFixture = async ({
  customerAgent,
  product,
  variant = product.variants[0],
  quantity = 1,
  customerNote = "Order history test",
}) => {
  const requestBody = createOrderRequestBody({
    productId: product._id,

    variantId: variant._id,

    quantity,
  });

  requestBody.customerNote = customerNote;

  const response = await customerAgent
    .post("/api/v1/orders")
    .send(requestBody)
    .expect(201);

  return response.body.data.order;
};

/*
|--------------------------------------------------------------------------
| Create Multi-Item Customer Order
|--------------------------------------------------------------------------
*/

const createCustomerOrderWithItemsFixture = async ({
  customerAgent,
  items,
  customerNote = "Multi-item Order integration test",
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Multi-item Order fixture requires at least one item");
  }

  const firstItem = items[0];

  const requestBody = createOrderRequestBody({
    productId: firstItem.product._id,

    variantId: firstItem.variant._id,

    quantity: firstItem.quantity,
  });

  requestBody.items = items.map(({ product, variant, quantity }) => {
    return {
      productId: String(product._id),

      variantId: String(variant._id),

      quantity,
    };
  });

  requestBody.customerNote = customerNote;

  const response = await customerAgent
    .post("/api/v1/orders")
    .send(requestBody)
    .expect(201);

  return response.body.data.order;
};

/*
|--------------------------------------------------------------------------
| Move Order to Processing
|--------------------------------------------------------------------------
*/

const moveOrderToProcessing = async ({ adminAgent, orderId }) => {
  await adminAgent
    .patch(`/api/v1/admin/orders/${orderId}/status`)
    .send({
      status: "confirmed",

      note: "Order confirmed for shipment test.",
    })
    .expect(200);

  await adminAgent
    .patch(`/api/v1/admin/orders/${orderId}/status`)
    .send({
      status: "processing",

      note: "Order processing started for shipment test.",
    })
    .expect(200);
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

/*
|--------------------------------------------------------------------------
| Customer Order History
|--------------------------------------------------------------------------
*/

describe("Customer Order history endpoints", () => {
  /*
    |--------------------------------------------------------------------------
    | List Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when listing Orders without authentication", async () => {
    const response = await request(app).get("/api/v1/orders");

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | List Only Customer-Owned Orders
    |--------------------------------------------------------------------------
    */

  it("returns only Orders owned by the authenticated customer", async () => {
    const {
      agent: firstCustomerAgent,

      user: firstCustomer,
    } = await createAuthenticatedCustomerAgent();

    const { agent: secondCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "ORDER-HISTORY-BLK-M",

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
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const firstCustomerOrder = await createCustomerOrderFixture({
      customerAgent: firstCustomerAgent,

      product,

      customerNote: "First customer Order",
    });

    await createCustomerOrderFixture({
      customerAgent: secondCustomerAgent,

      product,

      customerNote: "Second customer Order",
    });

    const response = await firstCustomerAgent.get("/api/v1/orders");

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.data.orders).toHaveLength(1);

    expect(response.body.data.orders[0].id).toBe(firstCustomerOrder.id);

    expect(response.body.data.orders[0].orderNumber).toBe(
      firstCustomerOrder.orderNumber,
    );

    expect(response.body.data.pagination.totalItems).toBe(1);

    /*
     * Double-check database ownership.
     */
    const storedOrder = await Order.findById(firstCustomerOrder.id).lean();

    expect(String(storedOrder.customer)).toBe(String(firstCustomer._id));
  });

  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  it("paginates customer Orders", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "ORDER-PAGINATION-BLU-L",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 899,

            discountPrice: 799,

            currency: "INR",
          },

          inventory: {
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 270,
          },

          isActive: true,
        },
      ],
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Pagination Order 1",
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Pagination Order 2",
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Pagination Order 3",
    });

    const firstPageResponse = await customerAgent.get("/api/v1/orders").query({
      page: 1,

      limit: 2,
    });

    expect(firstPageResponse.status).toBe(200);

    expect(firstPageResponse.body.data.orders).toHaveLength(2);

    expect(firstPageResponse.body.data.pagination).toEqual({
      page: 1,

      limit: 2,

      totalItems: 3,

      totalPages: 2,

      hasPreviousPage: false,

      hasNextPage: true,
    });

    const secondPageResponse = await customerAgent.get("/api/v1/orders").query({
      page: 2,

      limit: 2,
    });

    expect(secondPageResponse.status).toBe(200);

    expect(secondPageResponse.body.data.orders).toHaveLength(1);

    expect(secondPageResponse.body.data.pagination).toEqual({
      page: 2,

      limit: 2,

      totalItems: 3,

      totalPages: 2,

      hasPreviousPage: true,

      hasNextPage: false,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Status Filtering
    |--------------------------------------------------------------------------
    */

  it("filters customer Orders by status", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    const pendingResponse = await customerAgent.get("/api/v1/orders").query({
      status: "pending",
    });

    expect(pendingResponse.status).toBe(200);

    expect(pendingResponse.body.data.orders).toHaveLength(1);

    expect(pendingResponse.body.data.orders[0].status).toBe("pending");

    expect(pendingResponse.body.data.filters.status).toBe("pending");

    const deliveredResponse = await customerAgent.get("/api/v1/orders").query({
      status: "delivered",
    });

    expect(deliveredResponse.status).toBe(200);

    expect(deliveredResponse.body.data.orders).toHaveLength(0);

    expect(deliveredResponse.body.data.pagination.totalItems).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid List Query
    |--------------------------------------------------------------------------
    */

  it("rejects invalid Order list query parameters", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get("/api/v1/orders").query({
      page: 0,

      limit: 1000,

      status: "unknown-status",

      sortBy: "unknown-field",

      sortDirection: "newest",
    });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "query",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Customer-Owned Order Details
    |--------------------------------------------------------------------------
    */

  it("returns full Order details to the owning customer", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 2,

      customerNote: "Details test Order",
    });

    const response = await customerAgent.get(
      `/api/v1/orders/${createdOrder.id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    const responseOrder = response.body.data.order;

    expect(responseOrder.id).toBe(createdOrder.id);

    expect(responseOrder.orderNumber).toBe(createdOrder.orderNumber);

    expect(responseOrder.status).toBe("pending");

    expect(responseOrder.inventoryStatus).toBe("reserved");

    expect(responseOrder.items).toHaveLength(1);

    expect(responseOrder.items[0].quantity).toBe(2);

    expect(responseOrder.customerNote).toBe("Details test Order");

    /*
     * Internal audit information must remain hidden.
     */
    expect(responseOrder).not.toHaveProperty("createdBy");

    expect(responseOrder).not.toHaveProperty("updatedBy");

    expect(responseOrder).not.toHaveProperty("adminNote");

    expect(responseOrder.statusHistory[0]).not.toHaveProperty("changedBy");
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 for an invalid Order ID", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get(
      "/api/v1/orders/not-a-valid-object-id",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "orderId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Order
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Order does not exist", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent.get(
      `/api/v1/orders/${missingOrderId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Cross-Customer Ownership Protection
    |--------------------------------------------------------------------------
    */

  it("returns 404 when a customer requests another customer's Order", async () => {
    const { agent: ownerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: otherCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const ownerOrder = await createCustomerOrderFixture({
      customerAgent: ownerAgent,

      product,
    });

    const response = await otherCustomerAgent.get(
      `/api/v1/orders/${ownerOrder.id}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    /*
     * The response must not reveal that the
     * Order belongs to another customer.
     */
    expect(response.body.message).toBe("Order was not found");
  });
});

/*
|--------------------------------------------------------------------------
| Customer Order Cancellation
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/orders/:orderId/cancel", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when cancelling without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .send({
        reason: "I selected the wrong size.",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Customer-Only Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when an admin attempts to use the customer cancellation endpoint", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/orders/${orderId}/cancel`)
      .send({
        reason: "Admin should not use this endpoint.",
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects an invalid cancellation reason", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/orders/${orderId}/cancel`)
      .send({
        reason: "No",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "body",

          field: "reason",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Atomic Cancellation
    |--------------------------------------------------------------------------
    */

  it("cancels an Order, releases reserved inventory and creates a release Ledger entry", async () => {
    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "CANCEL-BLK-M",

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
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 2,
    });

    /*
     * Order creation must reserve two units.
     */
    const productAfterCreation = await Product.findById(product._id).lean();

    const variantAfterCreation = findProductVariant(
      productAfterCreation,
      variant._id,
    );

    expect(variantAfterCreation.inventory.stock).toBe(10);

    expect(variantAfterCreation.inventory.reservedStock).toBe(2);

    const cancellationReason =
      "I selected the wrong size while placing the Order.";

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: cancellationReason,
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Order cancelled successfully");

    const cancelledOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Customer Response
        |--------------------------------------------------------------------------
        */

    expect(cancelledOrder.status).toBe("cancelled");

    expect(cancelledOrder.inventoryStatus).toBe("released");

    expect(cancelledOrder.cancellation.reason).toBe(cancellationReason);

    expect(cancelledOrder.cancellation.cancelledAt).toBeTruthy();

    expect(cancelledOrder.cancellation).not.toHaveProperty("cancelledBy");

    expect(cancelledOrder.items[0].inventory).toEqual({
      status: "released",

      reservedQuantity: 0,

      committedQuantity: 0,

      releasedQuantity: 2,
    });

    /*
        |--------------------------------------------------------------------------
        | Stored Order
        |--------------------------------------------------------------------------
        */

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("cancelled");

    expect(storedOrder.inventoryStatus).toBe("released");

    expect(storedOrder.items[0].inventory.reservedQuantity).toBe(0);

    expect(storedOrder.items[0].inventory.releasedQuantity).toBe(2);

    expect(storedOrder.cancellation.reason).toBe(cancellationReason);

    expect(String(storedOrder.cancellation.cancelledBy)).toBe(
      String(customer._id),
    );

    expect(storedOrder.statusHistory.at(-1).status).toBe("cancelled");

    /*
        |--------------------------------------------------------------------------
        | Product Inventory
        |--------------------------------------------------------------------------
        */

    const productAfterCancellation = await Product.findById(product._id).lean();

    const variantAfterCancellation = findProductVariant(
      productAfterCancellation,
      variant._id,
    );

    expect(variantAfterCancellation.inventory.stock).toBe(10);

    expect(variantAfterCancellation.inventory.reservedStock).toBe(0);

    /*
        |--------------------------------------------------------------------------
        | Ledger Audit Trail
        |--------------------------------------------------------------------------
        */

    const ledgerEntries = await ProductInventoryLedger.find({
      product: product._id,

      variantId: variant._id,

      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    const reserveLedger = ledgerEntries.find((ledger) => {
      return ledger.operation === "reserve";
    });

    const releaseLedger = ledgerEntries.find((ledger) => {
      return ledger.operation === "release";
    });

    expect(reserveLedger).toBeTruthy();

    expect(releaseLedger).toBeTruthy();

    expect(releaseLedger.quantity).toBe(2);

    expect(releaseLedger.stockDelta).toBe(0);

    expect(releaseLedger.reservedStockDelta).toBe(-2);

    expect(releaseLedger.before).toMatchObject({
      stock: 10,

      reservedStock: 2,

      availableStock: 8,
    });

    expect(releaseLedger.after).toMatchObject({
      stock: 10,

      reservedStock: 0,

      availableStock: 10,
    });

    expect(String(releaseLedger.actor)).toBe(String(customer._id));
  });

  /*
    |--------------------------------------------------------------------------
    | Cross-Customer Ownership
    |--------------------------------------------------------------------------
    */

  it("returns 404 when a customer tries to cancel another customer's Order", async () => {
    const { agent: ownerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: otherCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent: ownerAgent,

      product,
      variant,

      quantity: 1,
    });

    const response = await otherCustomerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "Trying to cancel someone else's Order.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("pending");

    expect(unchangedOrder.inventoryStatus).toBe("reserved");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Cancellation
    |--------------------------------------------------------------------------
    */

  it("rejects a second cancellation attempt without releasing inventory twice", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "First valid cancellation request.",
      })
      .expect(200);

    const secondResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "Second cancellation request should fail.",
      });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_CANCELLATION_NOT_ALLOWED",
    );

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Processing Order
    |--------------------------------------------------------------------------
    */

  it("rejects customer cancellation after Order processing has started", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          status: "processing",
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "Cancellation should be blocked now.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_CANCELLATION_NOT_ALLOWED");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Paid Order
    |--------------------------------------------------------------------------
    */

  it("requires a refund workflow before cancelling a paid Order", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    /*
     * Direct database update prepares the required
     * paid-state test condition.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.status": "paid",

          "payment.paidAt": new Date(),
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "Paid Order cancellation should require a refund.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_CANCELLATION_REQUIRES_REFUND");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Complete Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back earlier reservation releases when a later Order item cannot be released", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const firstProduct = await createActiveProductFixture({
      category: category._id,

      name: "Cancellation Rollback Product One",

      slug: "cancellation-rollback-product-one",

      variants: [
        {
          sku: "CANCEL-ROLLBACK-ONE",

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

            reservedStock: 0,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const secondProduct = await createActiveProductFixture({
      category: category._id,

      name: "Cancellation Rollback Product Two",

      slug: "cancellation-rollback-product-two",

      variants: [
        {
          sku: "CANCEL-ROLLBACK-TWO",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 800,

            discountPrice: 700,

            currency: "INR",
          },

          inventory: {
            stock: 10,

            reservedStock: 0,

            lowStockThreshold: 2,
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

    const createdOrder = await createCustomerOrderWithItemsFixture({
      customerAgent,

      items: [
        {
          product: firstProduct,

          variant: firstVariant,

          quantity: 2,
        },
        {
          product: secondProduct,

          variant: secondVariant,

          quantity: 1,
        },
      ],
    });

    /*
     * Simulate corrupted inventory after Order creation.
     *
     * The Order still owns one reserved unit for Product Two,
     * but the Product no longer contains that reservation.
     */
    await Product.updateOne(
      {
        _id: secondProduct._id,

        "variants._id": secondVariant._id,
      },
      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: "Cancellation rollback integration test.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_INVENTORY_RELEASE_STATE_INVALID",
    );

    /*
        |--------------------------------------------------------------------------
        | First Product Release Must Be Rolled Back
        |--------------------------------------------------------------------------
        */

    const finalFirstProduct = await Product.findById(firstProduct._id).lean();

    const finalFirstVariant = findProductVariant(
      finalFirstProduct,
      firstVariant._id,
    );

    expect(finalFirstVariant.inventory.stock).toBe(10);

    expect(finalFirstVariant.inventory.reservedStock).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Pre-existing Corruption Remains Unchanged
        |--------------------------------------------------------------------------
        */

    const finalSecondProduct = await Product.findById(secondProduct._id).lean();

    const finalSecondVariant = findProductVariant(
      finalSecondProduct,
      secondVariant._id,
    );

    expect(finalSecondVariant.inventory.reservedStock).toBe(0);

    /*
        |--------------------------------------------------------------------------
        | Order Must Remain Active and Reserved
        |--------------------------------------------------------------------------
        */

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("pending");

    expect(unchangedOrder.inventoryStatus).toBe("reserved");

    expect(unchangedOrder.cancellation?.cancelledAt ?? null).toBeNull();

    expect(unchangedOrder.items[0].inventory.status).toBe("reserved");

    expect(unchangedOrder.items[0].inventory.reservedQuantity).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Release Ledger from First Item Must Be Rolled Back
        |--------------------------------------------------------------------------
        */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(0);

    /*
     * Only the two original reservation entries remain.
     */
    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,
      }),
    ).toBe(2);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order List
|--------------------------------------------------------------------------
*/

describe("GET /api/v1/admin/orders", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when the request is unauthenticated", async () => {
    const response = await request(app).get("/api/v1/admin/orders");

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer requests the admin Order list", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get("/api/v1/admin/orders");

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Order Results
    |--------------------------------------------------------------------------
    */

  it("returns Orders with admin-only fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "ADMIN-LIST-BLK-M",

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
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 2,

      customerNote: "Admin list integration test",
    });

    const response = await adminAgent.get("/api/v1/admin/orders");

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Admin Orders retrieved successfully");

    expect(response.body.data.orders).toHaveLength(1);

    const order = response.body.data.orders[0];

    expect(order.id).toBe(createdOrder.id);

    expect(order.orderNumber).toBe(createdOrder.orderNumber);

    expect(order.customerId).toBe(String(customer._id));

    expect(order.items[0].sku).toBe("ADMIN-LIST-BLK-M");

    expect(order.customerNote).toBe("Admin list integration test");

    /*
     * These fields are intentionally available
     * to admins.
     */
    expect(order).toHaveProperty("adminNote");

    expect(order).toHaveProperty("createdBy");

    expect(order).toHaveProperty("updatedBy");

    expect(order.cancellation).toHaveProperty("cancelledBy");

    expect(order.createdBy).toBe(String(customer._id));

    expect(order.updatedBy).toBe(String(customer._id));

    expect(response.body.data.pagination).toEqual({
      page: 1,

      limit: 20,

      totalItems: 1,

      totalPages: 1,

      hasPreviousPage: false,

      hasNextPage: false,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

  it("searches Orders by Order number, SKU and shipping customer name", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Premium Search Shirt",

      slug: "premium-search-shirt",

      variants: [
        {
          sku: "SEARCH-SHIRT-BLU-L",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 400,

            sellingPrice: 999,

            discountPrice: 899,

            currency: "INR",
          },

          inventory: {
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 280,
          },

          isActive: true,
        },
      ],
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    /*
        |--------------------------------------------------------------------------
        | Search by Exact Order Number
        |--------------------------------------------------------------------------
        */

    const orderNumberResponse = await adminAgent
      .get("/api/v1/admin/orders")
      .query({
        search: createdOrder.orderNumber,
      });

    expect(orderNumberResponse.status).toBe(200);

    expect(orderNumberResponse.body.data.orders).toHaveLength(1);

    expect(orderNumberResponse.body.data.orders[0].id).toBe(createdOrder.id);

    /*
        |--------------------------------------------------------------------------
        | Search by SKU
        |--------------------------------------------------------------------------
        */

    const skuResponse = await adminAgent.get("/api/v1/admin/orders").query({
      search: "SEARCH-SHIRT-BLU-L",
    });

    expect(skuResponse.status).toBe(200);

    expect(skuResponse.body.data.orders).toHaveLength(1);

    /*
        |--------------------------------------------------------------------------
        | Search by Shipping Name
        |--------------------------------------------------------------------------
        */

    const customerNameResponse = await adminAgent
      .get("/api/v1/admin/orders")
      .query({
        search: "Dipak",
      });

    expect(customerNameResponse.status).toBe(200);

    expect(customerNameResponse.body.data.orders).toHaveLength(1);

    /*
        |--------------------------------------------------------------------------
        | Missing Search
        |--------------------------------------------------------------------------
        */

    const missingResponse = await adminAgent.get("/api/v1/admin/orders").query({
      search: "DOES-NOT-EXIST",
    });

    expect(missingResponse.status).toBe(200);

    expect(missingResponse.body.data.orders).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Customer ID Filter
    |--------------------------------------------------------------------------
    */

  it("filters Orders by customer ID", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: firstCustomerAgent,

      user: firstCustomer,
    } = await createAuthenticatedCustomerAgent();

    const { agent: secondCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "CUSTOMER-FILTER-M",

          size: "M",

          color: {
            name: "White",

            code: "#FFFFFF",
          },

          pricing: {
            buyingPrice: 300,

            sellingPrice: 799,

            discountPrice: 699,

            currency: "INR",
          },

          inventory: {
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const firstOrder = await createCustomerOrderFixture({
      customerAgent: firstCustomerAgent,

      product,

      customerNote: "First customer admin filter",
    });

    await createCustomerOrderFixture({
      customerAgent: secondCustomerAgent,

      product,

      customerNote: "Second customer admin filter",
    });

    const response = await adminAgent.get("/api/v1/admin/orders").query({
      customerId: String(firstCustomer._id),
    });

    expect(response.status).toBe(200);

    expect(response.body.data.orders).toHaveLength(1);

    expect(response.body.data.orders[0].id).toBe(firstOrder.id);

    expect(response.body.data.orders[0].customerId).toBe(
      String(firstCustomer._id),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Status and Inventory Filters
    |--------------------------------------------------------------------------
    */

  it("filters Orders by status, payment status and inventory status", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "STATUS-FILTER-BLK-M",

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
            stock: 30,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const activeOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Active pending Order",
    });

    const cancelledOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Order to cancel",
    });

    await customerAgent
      .post(`/api/v1/orders/${cancelledOrder.id}/cancel`)
      .send({
        reason: "Cancelling this Order for admin filtering.",
      })
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Pending Orders
        |--------------------------------------------------------------------------
        */

    const pendingResponse = await adminAgent.get("/api/v1/admin/orders").query({
      status: "pending",

      paymentStatus: "pending",

      inventoryStatus: "reserved",
    });

    expect(pendingResponse.status).toBe(200);

    expect(pendingResponse.body.data.orders).toHaveLength(1);

    expect(pendingResponse.body.data.orders[0].id).toBe(activeOrder.id);

    /*
        |--------------------------------------------------------------------------
        | Cancelled Orders
        |--------------------------------------------------------------------------
        */

    const cancelledResponse = await adminAgent
      .get("/api/v1/admin/orders")
      .query({
        status: "cancelled",

        inventoryStatus: "released",
      });

    expect(cancelledResponse.status).toBe(200);

    expect(cancelledResponse.body.data.orders).toHaveLength(1);

    expect(cancelledResponse.body.data.orders[0].id).toBe(cancelledOrder.id);
  });

  /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

  it("paginates admin Orders", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "ADMIN-PAGINATION-M",

          size: "M",

          color: {
            name: "Green",

            code: "#008000",
          },

          pricing: {
            buyingPrice: 300,

            sellingPrice: 700,

            discountPrice: 600,

            currency: "INR",
          },

          inventory: {
            stock: 30,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Admin pagination 1",
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Admin pagination 2",
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      customerNote: "Admin pagination 3",
    });

    const firstPage = await adminAgent.get("/api/v1/admin/orders").query({
      page: 1,

      limit: 2,
    });

    expect(firstPage.status).toBe(200);

    expect(firstPage.body.data.orders).toHaveLength(2);

    expect(firstPage.body.data.pagination).toEqual({
      page: 1,

      limit: 2,

      totalItems: 3,

      totalPages: 2,

      hasPreviousPage: false,

      hasNextPage: true,
    });

    const secondPage = await adminAgent.get("/api/v1/admin/orders").query({
      page: 2,

      limit: 2,
    });

    expect(secondPage.status).toBe(200);

    expect(secondPage.body.data.orders).toHaveLength(1);

    expect(secondPage.body.data.pagination.hasPreviousPage).toBe(true);

    expect(secondPage.body.data.pagination.hasNextPage).toBe(false);
  });

  /*
    |--------------------------------------------------------------------------
    | Grand Total Sorting
    |--------------------------------------------------------------------------
    */

  it("sorts admin Orders by grand total", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "TOTAL-SORT-BLK-M",

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
            stock: 50,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const quantityOneOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 1,
    });

    const quantityThreeOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 3,
    });

    const quantityTwoOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 2,
    });

    const response = await adminAgent.get("/api/v1/admin/orders").query({
      sortBy: "grandTotal",

      sortDirection: "desc",
    });

    expect(response.status).toBe(200);

    const returnedOrderIds = response.body.data.orders.map((order) => {
      return order.id;
    });

    expect(returnedOrderIds).toEqual([
      quantityThreeOrder.id,
      quantityTwoOrder.id,
      quantityOneOrder.id,
    ]);

    const grandTotals = response.body.data.orders.map((order) => {
      return order.totals.grandTotal;
    });

    expect(grandTotals).toEqual([1800, 1200, 600]);
  });

  /*
    |--------------------------------------------------------------------------
    | Total Range Filtering
    |--------------------------------------------------------------------------
    */

  it("filters admin Orders by grand-total range", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "TOTAL-RANGE-BLK-M",

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
            stock: 50,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 1,
    });

    const matchingOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 2,
    });

    await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 3,
    });

    const response = await adminAgent.get("/api/v1/admin/orders").query({
      minTotal: 1000,

      maxTotal: 1500,
    });

    expect(response.status).toBe(200);

    expect(response.body.data.orders).toHaveLength(1);

    expect(response.body.data.orders[0].id).toBe(matchingOrder.id);

    expect(response.body.data.orders[0].totals.grandTotal).toBe(1200);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Admin Query
    |--------------------------------------------------------------------------
    */

  it("rejects invalid admin Order filters and ranges", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get("/api/v1/admin/orders").query({
      page: 0,

      limit: 500,

      status: "invalid-status",

      dateFrom: "2026-08-10",

      dateTo: "2026-08-01",

      minTotal: 5000,

      maxTotal: 500,

      sortBy: "invalid-sort-field",

      sortDirection: "newest",
    });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "query",
        }),
      ]),
    );
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Details
|--------------------------------------------------------------------------
*/

describe("GET /api/v1/admin/orders/:orderId", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when admin Order details are requested without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app).get(`/api/v1/admin/orders/${orderId}`);

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer requests admin Order details", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent.get(`/api/v1/admin/orders/${orderId}`);

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the admin Order ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get(
      "/api/v1/admin/orders/not-a-valid-object-id",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "orderId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Order
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the admin Order does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent.get(
      `/api/v1/admin/orders/${missingOrderId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(response.body.message).toBe("Order was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Complete Admin Order Details
    |--------------------------------------------------------------------------
    */

  it("returns complete Order details including internal admin audit fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Admin Details Cotton Shirt",

      slug: "admin-details-cotton-shirt",

      variants: [
        {
          sku: "ADMIN-DETAILS-BLK-M",

          size: "M",

          color: {
            name: "Black",

            code: "#000000",
          },

          pricing: {
            buyingPrice: 300,

            sellingPrice: 899,

            discountPrice: 749,

            currency: "INR",
          },

          inventory: {
            stock: 20,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 260,
          },

          isActive: true,
        },
      ],
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 2,

      customerNote: "Admin details integration test",
    });

    const response = await adminAgent.get(
      `/api/v1/admin/orders/${createdOrder.id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Admin Order retrieved successfully");

    const order = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Order Identity and Ownership
        |--------------------------------------------------------------------------
        */

    expect(order.id).toBe(createdOrder.id);

    expect(order.orderNumber).toBe(createdOrder.orderNumber);

    expect(order.customerId).toBe(String(customer._id));

    expect(order.createdBy).toBe(String(customer._id));

    expect(order.updatedBy).toBe(String(customer._id));

    /*
        |--------------------------------------------------------------------------
        | Product Snapshot
        |--------------------------------------------------------------------------
        */

    expect(order.items).toHaveLength(1);

    expect(order.items[0].sku).toBe("ADMIN-DETAILS-BLK-M");

    expect(order.items[0].productName).toBe("Admin Details Cotton Shirt");

    expect(order.items[0].size).toBe("M");

    expect(order.items[0].color).toEqual({
      name: "Black",

      code: "#000000",
    });

    expect(order.items[0].quantity).toBe(2);

    expect(order.items[0].pricing).toEqual({
      currency: "INR",

      unitSellingPrice: 899,

      unitDiscountPrice: 749,

      unitFinalPrice: 749,

      discountPerUnit: 150,

      lineSubtotal: 1498,
    });

    expect(order.items[0].inventory).toEqual({
      status: "reserved",

      reservedQuantity: 2,

      committedQuantity: 0,

      releasedQuantity: 0,
    });

    /*
        |--------------------------------------------------------------------------
        | Totals and State
        |--------------------------------------------------------------------------
        */

    expect(order.distinctItemCount).toBe(1);

    expect(order.totalQuantity).toBe(2);

    expect(order.totals).toEqual({
      currency: "INR",

      itemsSubtotal: 1498,

      discountAmount: 0,

      shippingAmount: 0,

      taxAmount: 0,

      grandTotal: 1498,
    });

    expect(order.status).toBe("pending");

    expect(order.inventoryStatus).toBe("reserved");

    expect(order.payment.status).toBe("pending");

    /*
        |--------------------------------------------------------------------------
        | Customer and Admin Information
        |--------------------------------------------------------------------------
        */

    expect(order.customerNote).toBe("Admin details integration test");

    expect(order.adminNote).toBeNull();

    expect(order.shippingAddress.fullName).toBe("Dipak Ahirav");

    /*
        |--------------------------------------------------------------------------
        | Internal Status Audit
        |--------------------------------------------------------------------------
        */

    expect(order.statusHistory).toHaveLength(1);

    expect(order.statusHistory[0].status).toBe("pending");

    expect(order.statusHistory[0].note).toBe("Order created");

    expect(order.statusHistory[0].changedBy).toBe(String(customer._id));

    expect(order.statusHistory[0].changedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Cancellation Audit
        |--------------------------------------------------------------------------
        */

    expect(order.cancellation).toEqual({
      reason: null,

      cancelledBy: null,

      cancelledAt: null,
    });

    expect(order.createdAt).toBeTruthy();

    expect(order.updatedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Cancelled Order Audit Details
    |--------------------------------------------------------------------------
    */

  it("returns cancellation and status-history audit details for a cancelled Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Cancelled Admin Details Product",

      slug: "cancelled-admin-details-product",

      variants: [
        {
          sku: "ADMIN-CANCELLED-BLU-L",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 999,

            discountPrice: 849,

            currency: "INR",
          },

          inventory: {
            stock: 10,

            reservedStock: 0,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 275,
          },

          isActive: true,
        },
      ],
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      quantity: 1,
    });

    const cancellationReason = "I ordered the wrong colour by mistake.";

    await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/cancel`)
      .send({
        reason: cancellationReason,
      })
      .expect(200);

    const response = await adminAgent.get(
      `/api/v1/admin/orders/${createdOrder.id}`,
    );

    expect(response.status).toBe(200);

    const order = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Cancelled Order State
        |--------------------------------------------------------------------------
        */

    expect(order.status).toBe("cancelled");

    expect(order.inventoryStatus).toBe("released");

    expect(order.items[0].inventory).toEqual({
      status: "released",

      reservedQuantity: 0,

      committedQuantity: 0,

      releasedQuantity: 1,
    });

    /*
        |--------------------------------------------------------------------------
        | Cancellation Audit
        |--------------------------------------------------------------------------
        */

    expect(order.cancellation.reason).toBe(cancellationReason);

    expect(order.cancellation.cancelledBy).toBe(String(customer._id));

    expect(order.cancellation.cancelledAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Status History Audit
        |--------------------------------------------------------------------------
        */

    expect(order.statusHistory).toHaveLength(2);

    expect(
      order.statusHistory.map((historyEntry) => {
        return historyEntry.status;
      }),
    ).toEqual(["pending", "cancelled"]);

    expect(order.statusHistory[0].changedBy).toBe(String(customer._id));

    expect(order.statusHistory[1].changedBy).toBe(String(customer._id));

    expect(order.statusHistory[1].note).toBe("Order cancelled by customer");

    expect(order.updatedBy).toBe(String(customer._id));
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Status Transitions
|--------------------------------------------------------------------------
*/

describe("PATCH /api/v1/admin/orders/:orderId/status", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when updating an Order status without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer uses the admin status endpoint", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the Order ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .patch("/api/v1/admin/orders/not-a-valid-object-id/status")
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "orderId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Order
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Order does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Order Confirmation
    |--------------------------------------------------------------------------
    */

  it("confirms a pending Order, commits inventory and creates commit Ledger entries", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Confirmation Test Shirt",

      slug: "confirmation-test-shirt",

      variants: [
        {
          sku: "CONFIRM-BLK-M",

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
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 2,
    });

    /*
     * Order creation reserves two units.
     */
    const productAfterOrder = await Product.findById(product._id).lean();

    const variantAfterOrder = findProductVariant(
      productAfterOrder,
      variant._id,
    );

    expect(variantAfterOrder.inventory.stock).toBe(10);

    expect(variantAfterOrder.inventory.reservedStock).toBe(2);

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",

        note: "Order verified and confirmed.",

        adminNote: "Inventory and address verified.",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Order status updated successfully");

    const confirmedOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Response Order State
        |--------------------------------------------------------------------------
        */

    expect(confirmedOrder.status).toBe("confirmed");

    expect(confirmedOrder.inventoryStatus).toBe("committed");

    expect(confirmedOrder.adminNote).toBe("Inventory and address verified.");

    expect(confirmedOrder.items[0].inventory).toEqual({
      status: "committed",

      reservedQuantity: 0,

      committedQuantity: 2,

      releasedQuantity: 0,
    });

    /*
        |--------------------------------------------------------------------------
        | Stored Order Audit
        |--------------------------------------------------------------------------
        */

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("confirmed");

    expect(storedOrder.inventoryStatus).toBe("committed");

    expect(storedOrder.items[0].inventory.reservedQuantity).toBe(0);

    expect(storedOrder.items[0].inventory.committedQuantity).toBe(2);

    const latestHistoryEntry = storedOrder.statusHistory.at(-1);

    expect(latestHistoryEntry.status).toBe("confirmed");

    expect(latestHistoryEntry.note).toBe("Order verified and confirmed.");

    expect(String(latestHistoryEntry.changedBy)).toBe(String(admin._id));

    expect(String(storedOrder.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Commit
        |--------------------------------------------------------------------------
        */

    const productAfterConfirmation = await Product.findById(product._id).lean();

    const variantAfterConfirmation = findProductVariant(
      productAfterConfirmation,
      variant._id,
    );

    expect(variantAfterConfirmation.inventory.stock).toBe(8);

    expect(variantAfterConfirmation.inventory.reservedStock).toBe(0);

    expect(
      variantAfterConfirmation.inventory.stock -
        variantAfterConfirmation.inventory.reservedStock,
    ).toBe(8);

    /*
        |--------------------------------------------------------------------------
        | Inventory Ledger Audit
        |--------------------------------------------------------------------------
        */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,

      product: product._id,

      variantId: variant._id,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    const reserveLedger = ledgerEntries.find((ledger) => {
      return ledger.operation === "reserve";
    });

    const commitLedger = ledgerEntries.find((ledger) => {
      return ledger.operation === "commit";
    });

    expect(reserveLedger).toBeTruthy();

    expect(commitLedger).toBeTruthy();

    expect(commitLedger.quantity).toBe(2);

    expect(commitLedger.stockDelta).toBe(-2);

    expect(commitLedger.reservedStockDelta).toBe(-2);

    expect(commitLedger.before).toMatchObject({
      stock: 10,

      reservedStock: 2,

      availableStock: 8,
    });

    expect(commitLedger.after).toMatchObject({
      stock: 8,

      reservedStock: 0,

      availableStock: 8,
    });

    expect(String(commitLedger.actor)).toBe(String(admin._id));
  });

  /*
    |--------------------------------------------------------------------------
    | Confirmed to Processing
    |--------------------------------------------------------------------------
    */

  it("moves a confirmed Order to processing without changing Product inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "PROCESSING-BLU-L",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 899,

            discountPrice: 799,

            currency: "INR",
          },

          inventory: {
            stock: 10,

            reservedStock: 0,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 270,
          },

          isActive: true,
        },
      ],
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 2,
    });

    await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      })
      .expect(200);

    const inventoryBeforeProcessing = await Product.findById(
      product._id,
    ).lean();

    const variantBeforeProcessing = findProductVariant(
      inventoryBeforeProcessing,
      variant._id,
    );

    expect(variantBeforeProcessing.inventory.stock).toBe(8);

    expect(variantBeforeProcessing.inventory.reservedStock).toBe(0);

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments({
      referenceId: createdOrder.orderNumber,
    });

    expect(ledgerCountBefore).toBe(2);

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "processing",

        note: "Warehouse processing started.",
      });

    expect(response.status).toBe(200);

    const processingOrder = response.body.data.order;

    expect(processingOrder.status).toBe("processing");

    expect(processingOrder.inventoryStatus).toBe("committed");

    expect(processingOrder.items[0].inventory.committedQuantity).toBe(2);

    const productAfterProcessing = await Product.findById(product._id).lean();

    const variantAfterProcessing = findProductVariant(
      productAfterProcessing,
      variant._id,
    );

    expect(variantAfterProcessing.inventory.stock).toBe(8);

    expect(variantAfterProcessing.inventory.reservedStock).toBe(0);

    /*
     * Processing does not create another inventory Ledger entry.
     */
    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,
      }),
    ).toBe(2);

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.statusHistory.at(-1).status).toBe("processing");

    expect(String(storedOrder.statusHistory.at(-1).changedBy)).toBe(
      String(admin._id),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Same Status
    |--------------------------------------------------------------------------
    */

  it("rejects setting the same Order status twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      })
      .expect(200);

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_STATUS_ALREADY_SET");

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "commit",
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Status Transition
    |--------------------------------------------------------------------------
    */

  it("rejects skipping directly from pending to processing", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "processing",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_STATUS_TRANSITION_NOT_ALLOWED");

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("pending");

    expect(unchangedOrder.inventoryStatus).toBe("reserved");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(variant.inventory.stock);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Dedicated Cancellation Workflow
    |--------------------------------------------------------------------------
    */

  it("requires the dedicated cancellation workflow for pending to cancelled", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "cancelled",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_CANCELLATION_WORKFLOW_REQUIRED",
    );

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Dedicated Shipment Workflow
    |--------------------------------------------------------------------------
    */

  it("requires the shipment workflow when moving processing to shipped", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      })
      .expect(200);

    await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "processing",
      })
      .expect(200);

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "shipped",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_SHIPMENT_WORKFLOW_REQUIRED");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("processing");
  });

  /*
    |--------------------------------------------------------------------------
    | Online Payment Confirmation
    |--------------------------------------------------------------------------
    */

  it("rejects confirmation when an online Order payment is still pending", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    /*
     * Prepare an unpaid online-payment Order.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.method": "online",

          "payment.status": "pending",

          "payment.paidAt": null,
        },
      },
    );

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_CONFIRMATION_PAYMENT_STATE_INVALID",
    );

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("pending");

    expect(unchangedOrder.inventoryStatus).toBe("reserved");

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(variant.inventory.stock);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "commit",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Complete Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back earlier inventory commits when a later Order item cannot be committed", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const firstProduct = await createActiveProductFixture({
      category: category._id,

      name: "Commit Rollback Product One",

      slug: "commit-rollback-product-one",

      variants: [
        {
          sku: "COMMIT-ROLLBACK-ONE",

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

            reservedStock: 0,

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const secondProduct = await createActiveProductFixture({
      category: category._id,

      name: "Commit Rollback Product Two",

      slug: "commit-rollback-product-two",

      variants: [
        {
          sku: "COMMIT-ROLLBACK-TWO",

          size: "L",

          color: {
            name: "Blue",

            code: "#0000FF",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 800,

            discountPrice: 700,

            currency: "INR",
          },

          inventory: {
            stock: 10,

            reservedStock: 0,

            lowStockThreshold: 2,
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

    const createdOrder = await createCustomerOrderWithItemsFixture({
      customerAgent,

      items: [
        {
          product: firstProduct,

          variant: firstVariant,

          quantity: 2,
        },
        {
          product: secondProduct,

          variant: secondVariant,

          quantity: 1,
        },
      ],
    });

    /*
     * Order creation produced:
     *
     * Product One:
     * stock = 10, reservedStock = 2
     *
     * Product Two:
     * stock = 10, reservedStock = 1
     */

    /*
     * Simulate corrupted inventory for the second Product.
     *
     * The Order still says one unit is reserved,
     * but the Product reservation no longer exists.
     */
    await Product.updateOne(
      {
        _id: secondProduct._id,

        "variants._id": secondVariant._id,
      },
      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",

        note: "Commit rollback integration test.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_INVENTORY_COMMIT_STATE_INVALID",
    );

    /*
        |--------------------------------------------------------------------------
        | First Product Commit Must Be Rolled Back
        |--------------------------------------------------------------------------
        */

    const finalFirstProduct = await Product.findById(firstProduct._id).lean();

    const finalFirstVariant = findProductVariant(
      finalFirstProduct,
      firstVariant._id,
    );

    expect(finalFirstVariant.inventory.stock).toBe(10);

    expect(finalFirstVariant.inventory.reservedStock).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Existing Second-Product Corruption Remains
        |--------------------------------------------------------------------------
        */

    const finalSecondProduct = await Product.findById(secondProduct._id).lean();

    const finalSecondVariant = findProductVariant(
      finalSecondProduct,
      secondVariant._id,
    );

    expect(finalSecondVariant.inventory.stock).toBe(10);

    expect(finalSecondVariant.inventory.reservedStock).toBe(0);

    /*
        |--------------------------------------------------------------------------
        | Order Must Remain Pending and Reserved
        |--------------------------------------------------------------------------
        */

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("pending");

    expect(unchangedOrder.inventoryStatus).toBe("reserved");

    expect(unchangedOrder.items[0].inventory.status).toBe("reserved");

    expect(unchangedOrder.items[0].inventory.reservedQuantity).toBe(2);

    expect(unchangedOrder.statusHistory).toHaveLength(1);

    /*
        |--------------------------------------------------------------------------
        | No Commit Ledger Entry May Remain
        |--------------------------------------------------------------------------
        */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,

        operation: "commit",
      }),
    ).toBe(0);

    /*
     * The two original reserve entries remain.
     */
    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,
      }),
    ).toBe(2);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Shipment
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/admin/orders/:orderId/ship", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when shipping an Order without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD123456789IN",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer uses the admin shipment endpoint", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/orders/${orderId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD123456789IN",
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the shipment Order ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post("/api/v1/admin/orders/not-a-valid-object-id/ship")
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD123456789IN",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "orderId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Shipment Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid shipment request data", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${orderId}/ship`)
      .send({
        carrier: "A",

        trackingNumber: "X",

        trackingUrl: "not-a-valid-url",

        status: "shipped",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details.length).toBeGreaterThan(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Order
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the shipment Order does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${missingOrderId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-MISSING-ORDER",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(response.body.message).toBe("Order was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Shipment
    |--------------------------------------------------------------------------
    */

  it("ships a processing Order without changing Product inventory or creating another inventory Ledger entry", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Shipment Integration Shirt",

      slug: "shipment-integration-shirt",

      variants: [
        {
          sku: "SHIPMENT-BLK-M",

          size: "M",

          color: {
            name: "Black",

            code: "#000000",
          },

          pricing: {
            buyingPrice: 350,

            sellingPrice: 899,

            discountPrice: 749,

            currency: "INR",
          },

          inventory: {
            stock: 12,

            reservedStock: 0,

            lowStockThreshold: 3,
          },

          shipping: {
            weightInGrams: 260,
          },

          isActive: true,
        },
      ],
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 2,
    });

    await moveOrderToProcessing({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Order creation:
     * stock = 12, reservedStock = 2
     *
     * Confirmation:
     * stock = 10, reservedStock = 0
     */

    const productBeforeShipment = await Product.findById(product._id).lean();

    const variantBeforeShipment = findProductVariant(
      productBeforeShipment,
      variant._id,
    );

    expect(variantBeforeShipment.inventory.stock).toBe(10);

    expect(variantBeforeShipment.inventory.reservedStock).toBe(0);

    const ledgerCountBeforeShipment =
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,
      });

    expect(ledgerCountBeforeShipment).toBe(2);

    const shipmentData = {
      carrier: "Blue Dart",

      trackingNumber: "BD123456789IN",

      trackingUrl: "https://tracking.example.com/BD123456789IN",

      note: "Order handed over to the delivery partner.",

      adminNote: "Package verified before dispatch.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send(shipmentData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Order shipped successfully");

    const shippedOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Shipment Response
        |--------------------------------------------------------------------------
        */

    expect(shippedOrder.id).toBe(createdOrder.id);

    expect(shippedOrder.status).toBe("shipped");

    expect(shippedOrder.inventoryStatus).toBe("committed");

    expect(shippedOrder.shipment).toMatchObject({
      carrier: "Blue Dart",

      trackingNumber: "BD123456789IN",

      trackingUrl: "https://tracking.example.com/BD123456789IN",

      deliveredAt: null,
    });

    expect(shippedOrder.shipment.shippedAt).toBeTruthy();

    expect(shippedOrder.adminNote).toBe("Package verified before dispatch.");

    expect(shippedOrder.items[0].inventory).toEqual({
      status: "committed",

      reservedQuantity: 0,

      committedQuantity: 2,

      releasedQuantity: 0,
    });

    /*
        |--------------------------------------------------------------------------
        | Stored Order
        |--------------------------------------------------------------------------
        */

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("shipped");

    expect(storedOrder.shipment.carrier).toBe("Blue Dart");

    expect(storedOrder.shipment.trackingNumber).toBe("BD123456789IN");

    expect(storedOrder.shipment.trackingUrl).toBe(
      "https://tracking.example.com/BD123456789IN",
    );

    expect(storedOrder.shipment.shippedAt).toBeTruthy();

    expect(storedOrder.shipment.deliveredAt).toBeNull();

    expect(String(storedOrder.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Status History
        |--------------------------------------------------------------------------
        */

    expect(
      storedOrder.statusHistory.map((entry) => {
        return entry.status;
      }),
    ).toEqual(["pending", "confirmed", "processing", "shipped"]);

    const shipmentHistory = storedOrder.statusHistory.at(-1);

    expect(shipmentHistory.note).toBe(
      "Order handed over to the delivery partner.",
    );

    expect(String(shipmentHistory.changedBy)).toBe(String(admin._id));

    expect(shipmentHistory.changedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterShipment = await Product.findById(product._id).lean();

    const variantAfterShipment = findProductVariant(
      productAfterShipment,
      variant._id,
    );

    expect(variantAfterShipment.inventory.stock).toBe(
      variantBeforeShipment.inventory.stock,
    );

    expect(variantAfterShipment.inventory.reservedStock).toBe(
      variantBeforeShipment.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No Shipment Inventory Ledger
        |--------------------------------------------------------------------------
        */

    const ledgerEntriesAfterShipment = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesAfterShipment).toHaveLength(2);

    expect(
      ledgerEntriesAfterShipment.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order State
    |--------------------------------------------------------------------------
    */

  it("rejects shipping an Order that has not entered processing", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    /*
     * Move only to confirmed.
     */
    await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "confirmed",
      })
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-CONFIRMED-ORDER",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_SHIPMENT_STATUS_INVALID");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("confirmed");

    expect(storedOrder.shipment?.shippedAt ?? null).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Shipment
    |--------------------------------------------------------------------------
    */

  it("rejects creating shipment information twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    await moveOrderToProcessing({
      adminAgent,

      orderId: createdOrder.id,
    });

    const shipmentData = {
      carrier: "Delhivery",

      trackingNumber: "DLV123456789",

      trackingUrl: "https://tracking.example.com/DLV123456789",
    };

    await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send(shipmentData)
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send(shipmentData);

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_SHIPMENT_ALREADY_CREATED");

    expect(response.body.details.trackingNumber).toBe("DLV123456789");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.statusHistory).toHaveLength(4);

    expect(
      storedOrder.statusHistory.filter((entry) => {
        return entry.status === "shipped";
      }),
    ).toHaveLength(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Online Payment Rule
    |--------------------------------------------------------------------------
    */

  it("rejects shipping an online-payment Order when payment is still pending", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    await moveOrderToProcessing({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Simulate an unpaid online-payment state after
     * the Order entered processing.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.method": "online",

          "payment.status": "pending",

          "payment.paidAt": null,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-ONLINE-PENDING",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_SHIPMENT_PAYMENT_STATE_INVALID",
    );

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("processing");

    expect(unchangedOrder.shipment?.shippedAt ?? null).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Inventory State
    |--------------------------------------------------------------------------
    */

  it("rejects shipment when Order item inventory is not fully committed", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "SHIP-INVENTORY-INVALID-M",

          size: "M",

          color: {
            name: "White",

            code: "#FFFFFF",
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

            lowStockThreshold: 2,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const variant = product.variants[0];

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
      variant,

      quantity: 1,
    });

    await moveOrderToProcessing({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Corrupt only the Order inventory state.
     * Product inventory remains committed.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          inventoryStatus: "reserved",

          "items.0.inventory.status": "reserved",

          "items.0.inventory.reservedQuantity": 1,

          "items.0.inventory.committedQuantity": 0,

          "items.0.inventory.releasedQuantity": 0,
        },
      },
    );

    const productBeforeRequest = await Product.findById(product._id).lean();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-INVENTORY-INVALID",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_SHIPMENT_INVENTORY_STATE_INVALID",
    );

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("processing");

    expect(unchangedOrder.shipment?.shippedAt ?? null).toBeNull();

    const productAfterRequest = await Product.findById(product._id).lean();

    const variantBeforeRequest = findProductVariant(
      productBeforeRequest,
      variant._id,
    );

    const variantAfterRequest = findProductVariant(
      productAfterRequest,
      variant._id,
    );

    expect(variantAfterRequest.inventory.stock).toBe(
      variantBeforeRequest.inventory.stock,
    );

    expect(variantAfterRequest.inventory.reservedStock).toBe(
      variantBeforeRequest.inventory.reservedStock,
    );
  });
});
