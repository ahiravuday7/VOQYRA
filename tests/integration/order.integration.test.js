import mongoose from "mongoose";

import { beforeEach, describe, expect, it } from "vitest";

import request from "supertest";

import app from "../../src/app.js";

import Order from "../../src/modules/orders/order.model.js";

import OrderRefundAudit from "../../src/modules/orders/order-refund-audit.model.js";

import Product from "../../src/modules/products/product.model.js";

import Category from "../../src/modules/categories/category.model.js";

import ProductInventoryLedger from "../../src/modules/products/product-inventory-ledger.model.js";

import { createAuthenticatedAgent } from "../helpers/auth-test.helper.js";

import { USER_ROLES } from "../../src/shared/constants/user.constants.js";

import OrderReturnRequest from "../../src/modules/orders/order-return.model.js";

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
| Create Unique Refund Reference
|--------------------------------------------------------------------------
*/

const createRefundReference = (prefix = "RFND") => {
  return (
    `${prefix}-` +
    new mongoose.Types.ObjectId().toString().slice(-12).toUpperCase()
  );
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
| Move Order to Shipped
|--------------------------------------------------------------------------
*/

const moveOrderToShipped = async ({
  adminAgent,
  orderId,
  shipmentData = {},
}) => {
  await moveOrderToProcessing({
    adminAgent,
    orderId,
  });

  return adminAgent
    .post(`/api/v1/admin/orders/${orderId}/ship`)
    .send({
      carrier: shipmentData.carrier ?? "Blue Dart",

      trackingNumber:
        shipmentData.trackingNumber ??
        `BD-${new mongoose.Types.ObjectId()
          .toString()
          .slice(-12)
          .toUpperCase()}`,

      trackingUrl:
        shipmentData.trackingUrl ?? "https://tracking.example.com/order",

      note: shipmentData.note ?? "Order shipped for delivery integration test.",
    })
    .expect(200);
};

/*
|--------------------------------------------------------------------------
| Move Order to Delivered
|--------------------------------------------------------------------------
*/

const moveOrderToDelivered = async ({
  adminAgent,
  orderId,
  shipmentData = {},
  deliveryData = {},
}) => {
  await moveOrderToShipped({
    adminAgent,
    orderId,
    shipmentData,
  });

  return adminAgent
    .post(`/api/v1/admin/orders/${orderId}/deliver`)
    .send({
      note: deliveryData.note ?? "Order delivered for refund integration test.",

      ...(deliveryData.adminNote !== undefined
        ? {
            adminNote: deliveryData.adminNote,
          }
        : {}),
    })
    .expect(200);
};

/*
|--------------------------------------------------------------------------
| Create Delivered Order for Return Tests
|--------------------------------------------------------------------------
*/

const createDeliveredOrderReturnFixture = async ({
  adminAgent,
  customerAgent,
  quantity = 1,
  productOverrides = {},
  shipmentData = {},
}) => {
  const uniqueSuffix = new mongoose.Types.ObjectId().toString().slice(-10);

  const category = await createActiveCategoryFixture();

  const product = await createActiveProductFixture({
    category: category._id,

    name: `Return Test Product ${uniqueSuffix}`,

    slug: `return-test-product-${uniqueSuffix}`,

    ...productOverrides,
  });

  const variant = product.variants[0];

  const createdOrder = await createCustomerOrderFixture({
    customerAgent,
    product,
    variant,
    quantity,
  });

  await moveOrderToDelivered({
    adminAgent,

    orderId: createdOrder.id,

    shipmentData: {
      carrier: "Blue Dart",

      trackingNumber: `RET-${uniqueSuffix.toUpperCase()}`,

      trackingUrl: `https://tracking.example.com/${uniqueSuffix}`,

      ...shipmentData,
    },
  });

  const storedOrder = await Order.findById(createdOrder.id).lean();

  return {
    category,
    product,
    variant,
    createdOrder,
    storedOrder,

    orderItem: storedOrder.items[0],
  };
};

/*
|--------------------------------------------------------------------------
| Create Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  orderedQuantity = 1,

  returnQuantity = 1,

  requestedResolution = "refund",

  reason = "defective",

  details = "The product contains a manufacturing defect.",

  customerNote,

  productOverrides = {},
}) => {
  const deliveryFixture = await createDeliveredOrderReturnFixture({
    adminAgent,
    customerAgent,

    quantity: orderedQuantity,

    productOverrides,
  });

  const { createdOrder, orderItem } = deliveryFixture;

  const requestBody = {
    requestedResolution,

    items: [
      {
        orderItemId: String(orderItem._id),

        quantity: returnQuantity,

        reason,

        details,
      },
    ],

    ...(customerNote !== undefined
      ? {
          customerNote,
        }
      : {}),
  };

  const response = await customerAgent
    .post(`/api/v1/orders/${createdOrder.id}/returns`)
    .send(requestBody)
    .expect(201);

  const returnRequest = response.body.data.returnRequest;

  const storedReturnRequest = await OrderReturnRequest.findById(
    returnRequest.id,
  ).lean();

  return {
    ...deliveryFixture,

    requestBody,
    returnRequest,
    storedReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create Approved Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createApprovedCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  approvalData = {
    adminNote: "Return Request approved for shipment.",
  },

  ...returnFixtureOptions
}) => {
  const fixture = await createCustomerReturnRequestFixture({
    adminAgent,
    customerAgent,
    ...returnFixtureOptions,
  });

  const approvalResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${fixture.returnRequest.id}/approve`)
    .send(approvalData)
    .expect(200);

  const approvedReturnRequest = approvalResponse.body.data.returnRequest;

  const storedApprovedReturnRequest = await OrderReturnRequest.findById(
    fixture.returnRequest.id,
  ).lean();

  return {
    ...fixture,

    approvalData,
    approvedReturnRequest,
    storedApprovedReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create In-Transit Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createInTransitCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  shipmentData = {
    carrier: "Blue Dart",

    trackingNumber: `RETURN-${new mongoose.Types.ObjectId()
      .toString()
      .slice(-12)
      .toUpperCase()}`,

    trackingUrl: "https://tracking.example.com/return-shipment",

    note: "Customer pickup completed successfully.",
  },

  ...returnFixtureOptions
}) => {
  const fixture = await createApprovedCustomerReturnRequestFixture({
    adminAgent,
    customerAgent,
    ...returnFixtureOptions,
  });

  const shipmentResponse = await adminAgent
    .post(
      `/api/v1/admin/order-returns/${fixture.returnRequest.id}/mark-in-transit`,
    )
    .send(shipmentData)
    .expect(200);

  const inTransitReturnRequest = shipmentResponse.body.data.returnRequest;

  const storedInTransitReturnRequest = await OrderReturnRequest.findById(
    fixture.returnRequest.id,
  ).lean();

  return {
    ...fixture,

    shipmentData,
    inTransitReturnRequest,
    storedInTransitReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create Received Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createReceivedCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  receiptData = {
    note: "Return parcel received at the warehouse.",
  },

  ...returnFixtureOptions
}) => {
  const fixture = await createInTransitCustomerReturnRequestFixture({
    adminAgent,
    customerAgent,
    ...returnFixtureOptions,
  });

  const receiptResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${fixture.returnRequest.id}/receive`)
    .send(receiptData)
    .expect(200);

  const receivedReturnRequest = receiptResponse.body.data.returnRequest;

  const storedReceivedReturnRequest = await OrderReturnRequest.findById(
    fixture.returnRequest.id,
  ).lean();

  return {
    ...fixture,

    receiptData,
    receivedReturnRequest,
    storedReceivedReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create Inspected Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createInspectedCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  inspectionData = null,

  ...returnFixtureOptions
}) => {
  const fixture = await createReceivedCustomerReturnRequestFixture({
    adminAgent,
    customerAgent,

    ...returnFixtureOptions,
  });

  /*
  |--------------------------------------------------------------------------
  | Build Default Inspection From Trusted Return Item
  |--------------------------------------------------------------------------
  */

  const storedReturnItem = fixture.storedReceivedReturnRequest.items[0];

  const resolvedInspectionData = inspectionData ?? {
    items: [
      {
        orderItemId: String(storedReturnItem.orderItemId),

        /*
         * By default the complete returned quantity is resellable.
         */
        resellableQuantity: Number(storedReturnItem.quantity),

        damagedQuantity: 0,

        rejectedQuantity: 0,

        note: "Returned item passed warehouse inspection.",
      },
    ],
  };

  /*
  |--------------------------------------------------------------------------
  | Inspect Return Request
  |--------------------------------------------------------------------------
  */

  const inspectionResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${fixture.returnRequest.id}/inspect`)
    .send(resolvedInspectionData)
    .expect(200);

  const inspectedReturnRequest = inspectionResponse.body.data.returnRequest;

  const storedInspectedReturnRequest = await OrderReturnRequest.findById(
    fixture.returnRequest.id,
  ).lean();

  return {
    ...fixture,

    inspectionData: resolvedInspectionData,

    inspectedReturnRequest,

    storedInspectedReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create Admin Return Read Fixture
|--------------------------------------------------------------------------
|
| Admin list and details APIs only read Return Request documents.
|
| Creating the document directly keeps these tests fast and avoids running
| the complete Order confirmation, shipment, and delivery lifecycle.
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnReadFixture = async ({
  customerId,

  updatedBy = customerId,

  orderId = new mongoose.Types.ObjectId(),

  returnRequestNumber,

  orderNumber,

  status = "requested",

  requestedResolution = "refund",

  productName,

  sku,

  quantity = 1,

  customerNote = "Customer requested a product return.",

  adminNote = null,

  approval = {},

  rejection = {},

  receipt = {},

  completion = {},

  cancellation = {},

  inspection = {},
}) => {
  const suffix = new mongoose.Types.ObjectId()
    .toString()
    .slice(-12)
    .toUpperCase();

  return OrderReturnRequest.create({
    returnRequestNumber: returnRequestNumber ?? `RET-20260805-${suffix}`,

    order: orderId,

    orderNumber: orderNumber ?? `ORD-20260805-${suffix}`,

    customer: customerId,

    items: [
      {
        orderItemId: new mongoose.Types.ObjectId(),

        product: new mongoose.Types.ObjectId(),

        variantId: new mongoose.Types.ObjectId(),

        sku: sku ?? `ADMIN-RETURN-${suffix}`,

        productName: productName ?? `Admin Return Product ${suffix}`,

        size: "M",

        color: {
          name: "Black",

          code: "#000000",
        },

        quantity,

        reason: "defective",

        details: "The product contains a manufacturing defect.",

        inspection: {
          status: "pending",

          resellableQuantity: 0,

          damagedQuantity: 0,

          rejectedQuantity: 0,

          note: null,

          inspectedBy: null,

          inspectedAt: null,

          ...inspection,
        },
      },
    ],

    requestedResolution,

    status,

    customerNote,

    adminNote,

    approval: {
      approvedBy: null,

      approvedAt: null,

      ...approval,
    },

    rejection: {
      reason: null,

      rejectedBy: null,

      rejectedAt: null,

      ...rejection,
    },

    receipt: {
      receivedBy: null,

      receivedAt: null,

      ...receipt,
    },

    completion: {
      completedBy: null,

      completedAt: null,

      ...completion,
    },

    cancellation: {
      reason: null,

      cancelledBy: null,

      cancelledAt: null,

      ...cancellation,
    },

    createdBy: customerId,

    updatedBy,
  });
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

/*
|--------------------------------------------------------------------------
| Admin Order Delivery
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/admin/orders/:orderId/deliver", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when completing delivery without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/deliver`)
      .send({});

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer uses the admin delivery endpoint", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/orders/${orderId}/deliver`)
      .send({});

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the delivery Order ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post("/api/v1/admin/orders/not-a-valid-object-id/deliver")
      .send({});

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
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects backend-controlled delivery fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${orderId}/deliver`)
      .send({
        note: "OK",

        status: "delivered",

        deliveredAt: new Date().toISOString(),

        paymentStatus: "paid",
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

  it("returns 404 when the delivery Order does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${missingOrderId}/deliver`)
      .send({
        note: "Delivery confirmation test.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(response.body.message).toBe("Order was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful COD Delivery
    |--------------------------------------------------------------------------
    */

  it("delivers a shipped cash-on-delivery Order and marks its payment as paid", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Delivery Integration Shirt",

      slug: "delivery-integration-shirt",

      variants: [
        {
          sku: "DELIVERY-BLK-M",

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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,

      shipmentData: {
        carrier: "Blue Dart",

        trackingNumber: "BD-DELIVERY-123456",

        trackingUrl: "https://tracking.example.com/BD-DELIVERY-123456",
      },
    });

    /*
     * After confirmation:
     *
     * stock         = 10
     * reservedStock = 0
     *
     * Shipment must not change inventory.
     */
    const productBeforeDelivery = await Product.findById(product._id).lean();

    const variantBeforeDelivery = findProductVariant(
      productBeforeDelivery,
      variant._id,
    );

    expect(variantBeforeDelivery.inventory.stock).toBe(10);

    expect(variantBeforeDelivery.inventory.reservedStock).toBe(0);

    const ledgerCountBeforeDelivery =
      await ProductInventoryLedger.countDocuments({
        referenceId: createdOrder.orderNumber,
      });

    expect(ledgerCountBeforeDelivery).toBe(2);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Delivery confirmed by the courier partner.",

        adminNote: "Customer received the package successfully.",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Order delivered successfully");

    const deliveredOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Delivered Order State
        |--------------------------------------------------------------------------
        */

    expect(deliveredOrder.id).toBe(createdOrder.id);

    expect(deliveredOrder.status).toBe("delivered");

    expect(deliveredOrder.inventoryStatus).toBe("committed");

    expect(deliveredOrder.shipment.carrier).toBe("Blue Dart");

    expect(deliveredOrder.shipment.trackingNumber).toBe("BD-DELIVERY-123456");

    expect(deliveredOrder.shipment.shippedAt).toBeTruthy();

    expect(deliveredOrder.shipment.deliveredAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | COD Payment Completion
        |--------------------------------------------------------------------------
        */

    expect(deliveredOrder.payment.method).toBe("cash-on-delivery");

    expect(deliveredOrder.payment.status).toBe("paid");

    expect(deliveredOrder.payment.paidAt).toBeTruthy();

    expect(deliveredOrder.payment.paidAt).toBe(
      deliveredOrder.shipment.deliveredAt,
    );

    expect(deliveredOrder.payment.failedAt).toBeNull();

    expect(deliveredOrder.adminNote).toBe(
      "Customer received the package successfully.",
    );

    /*
        |--------------------------------------------------------------------------
        | Order Item Inventory Remains Committed
        |--------------------------------------------------------------------------
        */

    expect(deliveredOrder.items[0].inventory).toEqual({
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

    expect(storedOrder.status).toBe("delivered");

    expect(storedOrder.payment.status).toBe("paid");

    expect(storedOrder.payment.paidAt).toBeTruthy();

    expect(storedOrder.shipment.deliveredAt).toBeTruthy();

    expect(storedOrder.payment.paidAt.getTime()).toBe(
      storedOrder.shipment.deliveredAt.getTime(),
    );

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
    ).toEqual(["pending", "confirmed", "processing", "shipped", "delivered"]);

    const deliveryHistory = storedOrder.statusHistory.at(-1);

    expect(deliveryHistory.note).toBe(
      "Delivery confirmed by the courier partner.",
    );

    expect(String(deliveryHistory.changedBy)).toBe(String(admin._id));

    expect(deliveryHistory.changedAt.getTime()).toBe(
      storedOrder.shipment.deliveredAt.getTime(),
    );

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterDelivery = await Product.findById(product._id).lean();

    const variantAfterDelivery = findProductVariant(
      productAfterDelivery,
      variant._id,
    );

    expect(variantAfterDelivery.inventory.stock).toBe(
      variantBeforeDelivery.inventory.stock,
    );

    expect(variantAfterDelivery.inventory.reservedStock).toBe(
      variantBeforeDelivery.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No Delivery Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerEntriesAfterDelivery = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesAfterDelivery).toHaveLength(2);

    expect(
      ledgerEntriesAfterDelivery.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Online Payment Timestamp Preservation
    |--------------------------------------------------------------------------
    */

  it("preserves the original paidAt timestamp for a paid online Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Online Payment Delivery Product",

      slug: "online-payment-delivery-product",
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    const originalPaidAt = new Date("2026-08-01T08:30:00.000Z");

    /*
     * Convert the pending COD fixture into
     * a successfully paid online Order.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.method": "online",

          "payment.status": "paid",

          "payment.paidAt": originalPaidAt,

          "payment.failedAt": null,
        },
      },
    );

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Paid online Order delivered successfully.",
      });

    expect(response.status).toBe(200);

    const deliveredOrder = response.body.data.order;

    expect(deliveredOrder.status).toBe("delivered");

    expect(deliveredOrder.payment.method).toBe("online");

    expect(deliveredOrder.payment.status).toBe("paid");

    expect(deliveredOrder.payment.paidAt).toBe(originalPaidAt.toISOString());

    expect(deliveredOrder.shipment.deliveredAt).toBeTruthy();

    expect(deliveredOrder.payment.paidAt).not.toBe(
      deliveredOrder.shipment.deliveredAt,
    );

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.payment.paidAt.getTime()).toBe(originalPaidAt.getTime());
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Delivery
    |--------------------------------------------------------------------------
    */

  it("rejects completing delivery twice", async () => {
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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "First delivery confirmation.",
      })
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Second delivery confirmation.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_ALREADY_DELIVERED");

    expect(response.body.details.status).toBe("delivered");

    expect(response.body.details.deliveredAt).toBeTruthy();

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(
      storedOrder.statusHistory.filter((entry) => {
        return entry.status === "delivered";
      }),
    ).toHaveLength(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Generic Status Endpoint Protection
    |--------------------------------------------------------------------------
    */

  it("requires the dedicated delivery workflow instead of the generic status endpoint", async () => {
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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "delivered",

        note: "Attempt generic delivery.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_DELIVERY_WORKFLOW_REQUIRED");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("shipped");

    expect(storedOrder.shipment.deliveredAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Shipment State
    |--------------------------------------------------------------------------
    */

  it("rejects delivery when required shipment information is missing", async () => {
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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Keep the Order status shipped, but corrupt
     * required shipment information.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "shipment.shippedAt": null,

          "shipment.trackingNumber": null,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Attempt delivery with invalid shipment state.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_DELIVERY_SHIPMENT_STATE_INVALID",
    );

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("shipped");

    expect(storedOrder.shipment.deliveredAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Inventory State
    |--------------------------------------------------------------------------
    */

  it("rejects delivery when the Order inventory snapshot is not fully committed", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "DELIVERY-INVENTORY-M",

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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    const productBeforeRequest = await Product.findById(product._id).lean();

    /*
     * Corrupt only the Order inventory snapshot.
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

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Attempt delivery with invalid inventory state.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_DELIVERY_INVENTORY_STATE_INVALID",
    );

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("shipped");

    expect(unchangedOrder.payment.status).toBe("pending");

    expect(unchangedOrder.shipment.deliveredAt).toBeNull();

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

  /*
    |--------------------------------------------------------------------------
    | Invalid Payment State
    |--------------------------------------------------------------------------
    */

  it("rejects delivery when an online Order payment is pending", async () => {
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

    await moveOrderToShipped({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Simulate an invalid unpaid online state after shipment.
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
      .post(`/api/v1/admin/orders/${createdOrder.id}/deliver`)
      .send({
        note: "Attempt delivery with unpaid online payment.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_DELIVERY_PAYMENT_STATE_INVALID",
    );

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("shipped");

    expect(unchangedOrder.payment.status).toBe("pending");

    expect(unchangedOrder.shipment.deliveredAt).toBeNull();
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Refund
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/admin/orders/:orderId/refund", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when refunding an Order without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/refund`)
      .send({
        reason: "Customer returned a defective product.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer uses the admin refund endpoint", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/orders/${orderId}/refund`)
      .send({
        reason: "Customer returned a defective product.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the refund Order ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post("/api/v1/admin/orders/not-a-valid-object-id/refund")
      .send({
        reason: "Customer returned a defective product.",

        referenceId: createRefundReference(),
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
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid and backend-controlled refund fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${orderId}/refund`)
      .send({
        reason: "Bad",

        referenceId: "X",

        refundAmount: 500,

        currency: "INR",

        status: "refunded",

        paymentStatus: "refunded",

        refundedAt: new Date().toISOString(),
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

  it("returns 404 when the refund Order does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${missingOrderId}/refund`)
      .send({
        reason: "Customer returned a defective product.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(response.body.message).toBe("Order was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful COD Refund
    |--------------------------------------------------------------------------
    */

  it("fully refunds a delivered COD Order and creates an immutable refund audit", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "COD Refund Integration Shirt",

      slug: "cod-refund-integration-shirt",

      variants: [
        {
          sku: "REFUND-COD-BLK-M",

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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,

      shipmentData: {
        carrier: "Blue Dart",

        trackingNumber: "BD-REFUND-COD-12345",
      },
    });

    const deliveredOrderBeforeRefund = await Order.findById(
      createdOrder.id,
    ).lean();

    expect(deliveredOrderBeforeRefund.status).toBe("delivered");

    expect(deliveredOrderBeforeRefund.payment.method).toBe("cash-on-delivery");

    expect(deliveredOrderBeforeRefund.payment.status).toBe("paid");

    const originalPaidAt = deliveredOrderBeforeRefund.payment.paidAt;

    const productBeforeRefund = await Product.findById(product._id).lean();

    const variantBeforeRefund = findProductVariant(
      productBeforeRefund,
      variant._id,
    );

    expect(variantBeforeRefund.inventory.stock).toBe(10);

    expect(variantBeforeRefund.inventory.reservedStock).toBe(0);

    const ledgerCountBeforeRefund = await ProductInventoryLedger.countDocuments(
      {
        referenceId: createdOrder.orderNumber,
      },
    );

    expect(ledgerCountBeforeRefund).toBe(2);

    const refundReference = createRefundReference("RFND-COD");

    const refundReason =
      "Customer returned the delivered product because it was defective.";

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: refundReason,

        referenceId: refundReference,

        note: "Full COD refund completed after return verification.",

        adminNote: "Returned product requires warehouse inspection.",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Order refunded successfully");

    const refundedOrder = response.body.data.order;

    /*
        |--------------------------------------------------------------------------
        | Refunded Order State
        |--------------------------------------------------------------------------
        */

    expect(refundedOrder.id).toBe(createdOrder.id);

    expect(refundedOrder.status).toBe("refunded");

    expect(refundedOrder.inventoryStatus).toBe("committed");

    expect(refundedOrder.payment.method).toBe("cash-on-delivery");

    expect(refundedOrder.payment.status).toBe("refunded");

    expect(refundedOrder.payment.paidAt).toBe(originalPaidAt.toISOString());

    expect(refundedOrder.payment.refundedAt).toBeTruthy();

    expect(refundedOrder.payment.failedAt).toBeNull();

    /*
        |--------------------------------------------------------------------------
        | Embedded Refund Snapshot
        |--------------------------------------------------------------------------
        */

    expect(refundedOrder.refund).toMatchObject({
      reason: refundReason,

      referenceId: refundReference,

      amount: 1498,

      currency: "INR",

      refundedBy: String(admin._id),
    });

    expect(refundedOrder.refund.refundedAt).toBeTruthy();

    expect(refundedOrder.refund.refundedAt).toBe(
      refundedOrder.payment.refundedAt,
    );

    expect(refundedOrder.adminNote).toBe(
      "Returned product requires warehouse inspection.",
    );

    /*
        |--------------------------------------------------------------------------
        | Order Item Inventory Remains Committed
        |--------------------------------------------------------------------------
        */

    expect(refundedOrder.items[0].inventory).toEqual({
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

    expect(storedOrder.status).toBe("refunded");

    expect(storedOrder.payment.status).toBe("refunded");

    expect(storedOrder.refund.amount).toBe(storedOrder.totals.grandTotal);

    expect(storedOrder.refund.currency).toBe(storedOrder.totals.currency);

    expect(storedOrder.payment.refundedAt.getTime()).toBe(
      storedOrder.refund.refundedAt.getTime(),
    );

    expect(storedOrder.payment.paidAt.getTime()).toBe(originalPaidAt.getTime());

    expect(String(storedOrder.refund.refundedBy)).toBe(String(admin._id));

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
    ).toEqual([
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "refunded",
    ]);

    const refundHistory = storedOrder.statusHistory.at(-1);

    expect(refundHistory.note).toBe(
      "Full COD refund completed after return verification.",
    );

    expect(String(refundHistory.changedBy)).toBe(String(admin._id));

    expect(refundHistory.changedAt.getTime()).toBe(
      storedOrder.refund.refundedAt.getTime(),
    );

    /*
        |--------------------------------------------------------------------------
        | Immutable Refund Audit
        |--------------------------------------------------------------------------
        */

    const refundAudit = await OrderRefundAudit.findOne({
      order: createdOrder.id,
    }).lean();

    expect(refundAudit).toBeTruthy();

    expect(String(refundAudit.order)).toBe(createdOrder.id);

    expect(refundAudit.orderNumber).toBe(createdOrder.orderNumber);

    expect(String(refundAudit.customer)).toBe(String(customer._id));

    expect(refundAudit.paymentMethod).toBe("cash-on-delivery");

    expect(refundAudit.previousPaymentStatus).toBe("paid");

    expect(refundAudit.paymentStatus).toBe("refunded");

    expect(refundAudit.amount).toBe(1498);

    expect(refundAudit.currency).toBe("INR");

    expect(refundAudit.reason).toBe(refundReason);

    expect(refundAudit.referenceId).toBe(refundReference);

    expect(String(refundAudit.refundedBy)).toBe(String(admin._id));

    expect(refundAudit.refundedAt.getTime()).toBe(
      storedOrder.refund.refundedAt.getTime(),
    );

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterRefund = await Product.findById(product._id).lean();

    const variantAfterRefund = findProductVariant(
      productAfterRefund,
      variant._id,
    );

    expect(variantAfterRefund.inventory.stock).toBe(
      variantBeforeRefund.inventory.stock,
    );

    expect(variantAfterRefund.inventory.reservedStock).toBe(
      variantBeforeRefund.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No Refund Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerEntriesAfterRefund = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesAfterRefund).toHaveLength(2);

    expect(
      ledgerEntriesAfterRefund.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Online Refund
    |--------------------------------------------------------------------------
    */

  it("refunds a delivered online Order while preserving its original paidAt timestamp", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      name: "Online Refund Integration Product",

      slug: "online-refund-integration-product",
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    const originalPaidAt = new Date("2026-08-01T08:30:00.000Z");

    /*
     * Online payment must be paid before confirmation.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.method": "online",

          "payment.status": "paid",

          "payment.paidAt": originalPaidAt,

          "payment.failedAt": null,

          "payment.refundedAt": null,
        },
      },
    );

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    const refundReference = createRefundReference("RFND-ONLINE");

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Customer returned the online-paid Order.",

        referenceId: refundReference,

        note: "Online payment refund completed.",
      });

    expect(response.status).toBe(200);

    const refundedOrder = response.body.data.order;

    expect(refundedOrder.status).toBe("refunded");

    expect(refundedOrder.payment.method).toBe("online");

    expect(refundedOrder.payment.status).toBe("refunded");

    expect(refundedOrder.payment.paidAt).toBe(originalPaidAt.toISOString());

    expect(refundedOrder.payment.refundedAt).toBeTruthy();

    expect(refundedOrder.payment.refundedAt).not.toBe(
      refundedOrder.payment.paidAt,
    );

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.payment.paidAt.getTime()).toBe(originalPaidAt.getTime());

    const refundAudit = await OrderRefundAudit.findOne({
      order: createdOrder.id,
    }).lean();

    expect(refundAudit.paymentMethod).toBe("online");

    expect(refundAudit.previousPaymentStatus).toBe("paid");

    expect(refundAudit.paymentStatus).toBe("refunded");

    expect(refundAudit.referenceId).toBe(refundReference);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Refund
    |--------------------------------------------------------------------------
    */

  it("rejects refunding the same Order twice", async () => {
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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "First completed refund request.",

        referenceId: createRefundReference("RFND-FIRST"),
      })
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Second duplicate refund request.",

        referenceId: createRefundReference("RFND-SECOND"),
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_ALREADY_REFUNDED");

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(1);

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(
      storedOrder.statusHistory.filter((entry) => {
        return entry.status === "refunded";
      }),
    ).toHaveLength(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Refund Reference
    |--------------------------------------------------------------------------
    */

  it("rejects reusing the same refund reference for another Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "REFUND-REFERENCE-M",

          size: "M",

          color: {
            name: "Green",

            code: "#008000",
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
      customerAgent,
      product,
    });

    const secondOrder = await createCustomerOrderFixture({
      customerAgent,
      product,
    });

    await moveOrderToDelivered({
      adminAgent,

      orderId: firstOrder.id,
    });

    await moveOrderToDelivered({
      adminAgent,

      orderId: secondOrder.id,
    });

    const sharedReference = createRefundReference("RFND-SHARED");

    await adminAgent
      .post(`/api/v1/admin/orders/${firstOrder.id}/refund`)
      .send({
        reason: "Refund completed for first Order.",

        referenceId: sharedReference,
      })
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${secondOrder.id}/refund`)
      .send({
        reason: "Refund attempted for second Order.",

        referenceId: sharedReference,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_REFUND_REFERENCE_CONFLICT");

    expect(response.body.details.referenceId).toBe(sharedReference);

    /*
     * The second Order update must roll back.
     */
    const secondStoredOrder = await Order.findById(secondOrder.id).lean();

    expect(secondStoredOrder.status).toBe("delivered");

    expect(secondStoredOrder.payment.status).toBe("paid");

    expect(secondStoredOrder.payment.refundedAt).toBeNull();

    expect(secondStoredOrder.refund).toBeUndefined();

    expect(
      await OrderRefundAudit.countDocuments({
        referenceId: sharedReference,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Generic Status Endpoint Protection
    |--------------------------------------------------------------------------
    */

  it("requires the dedicated refund workflow instead of the generic status endpoint", async () => {
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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    const response = await adminAgent
      .patch(`/api/v1/admin/orders/${createdOrder.id}/status`)
      .send({
        status: "refunded",

        note: "Attempt generic refund.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_REFUND_WORKFLOW_REQUIRED");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("delivered");

    expect(storedOrder.payment.status).toBe("paid");

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Delivery State
    |--------------------------------------------------------------------------
    */

  it("rejects refund when completed delivery information is missing", async () => {
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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Keep status delivered, but remove delivery evidence.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "shipment.deliveredAt": null,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Refund attempted without completed delivery data.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_REFUND_DELIVERY_STATE_INVALID");

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Payment State
    |--------------------------------------------------------------------------
    */

  it("rejects refund when the delivered Order payment is not paid", async () => {
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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "payment.status": "pending",

          "payment.paidAt": null,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Refund attempted while payment was pending.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_REFUND_PAYMENT_STATE_INVALID");

    const storedOrder = await Order.findById(createdOrder.id).lean();

    expect(storedOrder.status).toBe("delivered");

    expect(storedOrder.payment.status).toBe("pending");

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Inventory State
    |--------------------------------------------------------------------------
    */

  it("rejects refund when the Order inventory snapshot is not committed", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "REFUND-INVENTORY-M",

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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    const productBeforeRequest = await Product.findById(product._id).lean();

    /*
     * Corrupt only the Order snapshot.
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

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Refund attempted with inconsistent inventory state.",

        referenceId: createRefundReference(),
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_REFUND_INVENTORY_STATE_INVALID",
    );

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

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back the refund audit when saving the refunded Order fails", async () => {
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

    await moveOrderToDelivered({
      adminAgent,

      orderId: createdOrder.id,
    });

    /*
     * Introduce an unrelated invalid Order field.
     *
     * updateOne bypasses document validation, but the refund
     * workflow later loads and saves the complete document.
     * The save must fail after the audit insert is attempted.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "shippingAddress.fullName": "",
        },
      },
    );

    const refundReference = createRefundReference("RFND-ROLLBACK");

    const response = await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Refund transaction rollback integration test.",

        referenceId: refundReference,
      });

    expect(response.status).toBe(400);

    /*
        |--------------------------------------------------------------------------
        | Refund Audit Must Roll Back
        |--------------------------------------------------------------------------
        */

    expect(
      await OrderRefundAudit.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);

    expect(
      await OrderRefundAudit.countDocuments({
        referenceId: refundReference,
      }),
    ).toBe(0);

    /*
        |--------------------------------------------------------------------------
        | Order Refund State Must Roll Back
        |--------------------------------------------------------------------------
        */

    const unchangedOrder = await Order.findById(createdOrder.id).lean();

    expect(unchangedOrder.status).toBe("delivered");

    expect(unchangedOrder.payment.status).toBe("paid");

    expect(unchangedOrder.payment.refundedAt).toBeNull();

    expect(unchangedOrder.refund).toBeUndefined();

    expect(unchangedOrder.statusHistory.at(-1).status).toBe("delivered");

    expect(
      unchangedOrder.statusHistory.filter((entry) => {
        return entry.status === "refunded";
      }),
    ).toHaveLength(0);
  });
});

/*
|--------------------------------------------------------------------------
| Customer Order Return Requests
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/orders/:orderId/returns", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when creating a return request without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId().toString();

    const orderItemId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/orders/${orderId}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId,

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the return Order ID is invalid", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent
      .post("/api/v1/orders/not-a-valid-object-id/returns")
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
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
    | Strict Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects customer-controlled Product snapshot fields", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const orderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/orders/${orderId}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",

            productId: new mongoose.Types.ObjectId().toString(),

            variantId: new mongoose.Types.ObjectId().toString(),

            sku: "FAKE-CUSTOMER-SKU",

            productName: "Customer Modified Product",
          },
        ],
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details.length).toBeGreaterThan(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Ownership Protection
    |--------------------------------------------------------------------------
    */

  it("returns 404 when a customer creates a return request for another customer's Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: ownerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: otherCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,

        customerAgent: ownerAgent,
      },
    );

    const response = await otherCustomerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Order
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Order does not exist", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const missingOrderId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/orders/${missingOrderId}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Order Status
    |--------------------------------------------------------------------------
    */

  it("rejects a return request before the Order is delivered", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const createdOrder = await createCustomerOrderFixture({
      customerAgent,
      product,

      variant: product.variants[0],

      quantity: 1,
    });

    const pendingOrder = await Order.findById(createdOrder.id).lean();

    expect(pendingOrder.status).toBe("pending");

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(pendingOrder.items[0]._id),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_STATUS_INVALID");

    expect(response.body.details.currentStatus).toBe("pending");

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Delivery State
    |--------------------------------------------------------------------------
    */

  it("rejects a return request when delivery evidence is missing", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    /*
     * Keep status delivered, but remove
     * the trusted delivery timestamp.
     */
    await Order.updateOne(
      {
        _id: createdOrder.id,
      },
      {
        $set: {
          "shipment.deliveredAt": null,
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "The product contains a manufacturing defect.",
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_DELIVERY_STATE_INVALID");

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Return Request
    |--------------------------------------------------------------------------
    */

  it("creates a return request using trusted Order-item snapshots without changing inventory", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, storedOrder, orderItem } =
      await createDeliveredOrderReturnFixture({
        adminAgent,
        customerAgent,

        quantity: 2,

        productOverrides: {
          name: "Trusted Return Snapshot Shirt",

          slug: "trusted-return-snapshot-shirt",

          variants: [
            {
              sku: "RETURN-SNAPSHOT-BLK-M",

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
        },
      });

    const productBeforeReturn = await Product.findById(product._id).lean();

    const variantBeforeReturn = findProductVariant(
      productBeforeReturn,
      variant._id,
    );

    expect(variantBeforeReturn.inventory.stock).toBe(10);

    expect(variantBeforeReturn.inventory.reservedStock).toBe(0);

    const ledgerEntriesBeforeReturn = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesBeforeReturn).toHaveLength(2);

    expect(
      ledgerEntriesBeforeReturn.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "The stitching near the sleeve is damaged.",
          },
        ],

        customerNote: "Please arrange pickup from the delivery address.",
      });

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return request created successfully");

    const returnRequest = response.body.data.returnRequest;

    /*
        |--------------------------------------------------------------------------
        | Public Return Response
        |--------------------------------------------------------------------------
        */

    expect(returnRequest.returnRequestNumber).toMatch(
      /^RET-\d{8}-[A-F0-9]{12}$/,
    );

    expect(returnRequest.orderId).toBe(createdOrder.id);

    expect(returnRequest.orderNumber).toBe(createdOrder.orderNumber);

    expect(returnRequest.requestedResolution).toBe("refund");

    expect(returnRequest.status).toBe("requested");

    expect(returnRequest.customerNote).toBe(
      "Please arrange pickup from the delivery address.",
    );

    expect(returnRequest).not.toHaveProperty("adminNote");

    /*
        |--------------------------------------------------------------------------
        | Trusted Item Snapshot
        |--------------------------------------------------------------------------
        */

    const returnedItem = returnRequest.items[0];

    expect(returnedItem.orderItemId).toBe(String(orderItem._id));

    expect(returnedItem.productId).toBe(String(orderItem.product));

    expect(returnedItem.variantId).toBe(String(orderItem.variantId));

    expect(returnedItem.sku).toBe(orderItem.sku);

    expect(returnedItem.productName).toBe(orderItem.productName);

    expect(returnedItem.size).toBe(orderItem.size);

    expect(returnedItem.color).toEqual({
      name: orderItem.color.name,

      code: orderItem.color.code,
    });

    expect(returnedItem.quantity).toBe(1);

    expect(returnedItem.reason).toBe("defective");

    expect(returnedItem.details).toBe(
      "The stitching near the sleeve is damaged.",
    );

    expect(returnedItem.inspection).toEqual({
      status: "pending",

      resellableQuantity: 0,

      damagedQuantity: 0,

      rejectedQuantity: 0,

      note: null,

      inspectedAt: null,
    });

    expect(returnedItem.inspection).not.toHaveProperty("inspectedBy");

    /*
        |--------------------------------------------------------------------------
        | Stored Return Request
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest).toBeTruthy();

    expect(String(storedReturnRequest.order)).toBe(createdOrder.id);

    expect(String(storedReturnRequest.customer)).toBe(String(customer._id));

    expect(String(storedReturnRequest.createdBy)).toBe(String(customer._id));

    expect(String(storedReturnRequest.updatedBy)).toBe(String(customer._id));

    const storedReturnedItem = storedReturnRequest.items[0];

    expect(String(storedReturnedItem.orderItemId)).toBe(String(orderItem._id));

    expect(String(storedReturnedItem.product)).toBe(String(orderItem.product));

    expect(String(storedReturnedItem.variantId)).toBe(
      String(orderItem.variantId),
    );

    expect(storedReturnedItem.sku).toBe(orderItem.sku);

    expect(storedReturnedItem.productName).toBe(orderItem.productName);

    /*
        |--------------------------------------------------------------------------
        | Return Version Increment
        |--------------------------------------------------------------------------
        */

    const orderWithReturnVersion = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderWithReturnVersion.returnRequestVersion).toBe(1);

    expect(orderWithReturnVersion.status).toBe(storedOrder.status);

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterReturn = await Product.findById(product._id).lean();

    const variantAfterReturn = findProductVariant(
      productAfterReturn,
      variant._id,
    );

    expect(variantAfterReturn.inventory.stock).toBe(
      variantBeforeReturn.inventory.stock,
    );

    expect(variantAfterReturn.inventory.reservedStock).toBe(
      variantBeforeReturn.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No New Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerEntriesAfterReturn = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesAfterReturn).toHaveLength(2);

    expect(
      ledgerEntriesAfterReturn.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Refunded Order Eligibility
    |--------------------------------------------------------------------------
    */

  it("allows a customer to create a physical return request for a refunded Order", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    await adminAgent
      .post(`/api/v1/admin/orders/${createdOrder.id}/refund`)
      .send({
        reason: "Financial refund completed before physical item return.",

        referenceId: createRefundReference("RFND-RETURN"),

        note: "Customer must return the physical product.",
      })
      .expect(200);

    const refundedOrder = await Order.findById(createdOrder.id).lean();

    expect(refundedOrder.status).toBe("refunded");

    expect(refundedOrder.payment.status).toBe("refunded");

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "The refunded product is being physically returned.",
          },
        ],
      });

    expect(response.status).toBe(201);

    expect(response.body.data.returnRequest.status).toBe("requested");

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Other Reason Details
    |--------------------------------------------------------------------------
    */

  it("requires return details when the reason is other", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "other",
          },
        ],
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("ORDER_RETURN_DETAILS_REQUIRED");

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Partial Returns and Quantity Exhaustion
    |--------------------------------------------------------------------------
    */

  it("allows partial returns up to the purchased quantity and rejects any excess", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,

        quantity: 3,
      },
    );

    const orderItemId = String(orderItem._id);

    /*
        |--------------------------------------------------------------------------
        | First Partial Return: 1 of 3
        |--------------------------------------------------------------------------
        */

    const firstResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId,

            quantity: 1,

            reason: "size-issue",

            details: "One item has an incorrect size.",
          },
        ],
      });

    expect(firstResponse.status).toBe(201);

    /*
        |--------------------------------------------------------------------------
        | Second Partial Return: Remaining 2 of 3
        |--------------------------------------------------------------------------
        */

    const secondResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId,

            quantity: 2,

            reason: "quality-issue",

            details: "The remaining two items have quality problems.",
          },
        ],
      });

    expect(secondResponse.status).toBe(201);

    const returnRequests = await OrderReturnRequest.find({
      order: createdOrder.id,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(returnRequests).toHaveLength(2);

    const totalConsumedQuantity = returnRequests.reduce(
      (total, returnRequest) => {
        return total + returnRequest.items[0].quantity;
      },
      0,
    );

    expect(totalConsumedQuantity).toBe(3);

    /*
        |--------------------------------------------------------------------------
        | Third Return Must Be Rejected
        |--------------------------------------------------------------------------
        */

    const thirdResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId,

            quantity: 1,

            reason: "defective",

            details: "Attempt to return more than the purchased quantity.",
          },
        ],
      });

    expect(thirdResponse.status).toBe(409);

    expect(thirdResponse.body.errorCode).toBe("ORDER_RETURN_QUANTITY_EXCEEDED");

    expect(thirdResponse.body.details).toMatchObject({
      orderItemId,

      orderedQuantity: 3,

      consumedQuantity: 3,

      requestedQuantity: 1,

      remainingQuantity: 0,
    });

    expect(
      await OrderReturnRequest.countDocuments({
        order: createdOrder.id,
      }),
    ).toBe(2);

    /*
     * The failed transaction must not increment
     * the Order version.
     */
    const orderWithVersion = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderWithVersion.returnRequestVersion).toBe(2);
  });

  /*
    |--------------------------------------------------------------------------
    | Rejected Return Quantity Reuse
    |--------------------------------------------------------------------------
    */

  it("allows return quantity to be reused after a previous request is rejected", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,

        quantity: 2,
      },
    );

    const orderItemId = String(orderItem._id);

    const firstResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId,

            quantity: 2,

            reason: "defective",

            details: "Initial full-quantity return request.",
          },
        ],
      });

    expect(firstResponse.status).toBe(201);

    const firstReturnRequestId = firstResponse.body.data.returnRequest.id;

    /*
     * Admin rejection endpoint does not exist yet.
     * Simulate the future admin rejection workflow.
     */
    await OrderReturnRequest.updateOne(
      {
        _id: firstReturnRequestId,
      },
      {
        $set: {
          status: "rejected",

          "rejection.reason":
            "Return request did not satisfy the return policy.",

          "rejection.rejectedAt": new Date(),
        },
      },
    );

    const secondResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId,

            quantity: 2,

            reason: "size-issue",

            details: "A new return request after the earlier rejection.",
          },
        ],
      });

    expect(secondResponse.status).toBe(201);

    const returnRequests = await OrderReturnRequest.find({
      order: createdOrder.id,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(returnRequests).toHaveLength(2);

    expect(returnRequests[0].status).toBe("rejected");

    expect(returnRequests[1].status).toBe("requested");

    expect(returnRequests[1].items[0].quantity).toBe(2);
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Return Protection
    |--------------------------------------------------------------------------
    */

  it("prevents concurrent return requests from exceeding the purchased quantity", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem } = await createDeliveredOrderReturnFixture(
      {
        adminAgent,
        customerAgent,

        quantity: 1,
      },
    );

    const requestBody = {
      requestedResolution: "refund",

      items: [
        {
          orderItemId: String(orderItem._id),

          quantity: 1,

          reason: "defective",

          details: "Concurrent return-request protection test.",
        },
      ],
    };

    const [firstResponse, secondResponse] = await Promise.all([
      customerAgent
        .post(`/api/v1/orders/${createdOrder.id}/returns`)
        .send(requestBody),

      customerAgent
        .post(`/api/v1/orders/${createdOrder.id}/returns`)
        .send(requestBody),
    ]);

    const responses = [firstResponse, secondResponse];

    const successfulResponses = responses.filter((response) => {
      return response.status === 201;
    });

    const rejectedResponses = responses.filter((response) => {
      return response.status === 409;
    });

    /*
     * Exactly one request may consume the one
     * purchased unit.
     */
    expect(successfulResponses).toHaveLength(1);

    expect(rejectedResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_QUANTITY_EXCEEDED",
      "ORDER_RETURN_CONCURRENT_REQUEST",
    ]).toContain(rejectedResponses[0].body.errorCode);

    const storedReturnRequests = await OrderReturnRequest.find({
      order: createdOrder.id,
    }).lean();

    expect(storedReturnRequests).toHaveLength(1);

    expect(storedReturnRequests[0].items[0].quantity).toBe(1);

    const consumedQuantity = storedReturnRequests.reduce(
      (total, returnRequest) => {
        return (
          total +
          returnRequest.items.reduce((itemTotal, item) => {
            return itemTotal + item.quantity;
          }, 0)
        );
      },
      0,
    );

    expect(consumedQuantity).toBe(1);

    /*
     * The failed transaction's version increment
     * must be rolled back.
     */
    const orderWithVersion = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderWithVersion.returnRequestVersion).toBe(1);
  });
});

/*
|--------------------------------------------------------------------------
| Customer Return Request Cancellation
|--------------------------------------------------------------------------
*/

describe("POST /api/v1/orders/returns/:returnRequestId/cancel", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when cancelling a return request without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/orders/returns/${returnRequestId}/cancel`)
      .send({
        reason: "I no longer want to return this item.",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Return Request ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the Return Request ID is invalid", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent
      .post("/api/v1/orders/returns/not-a-valid-object-id/cancel")
      .send({
        reason: "I no longer want to return this item.",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "returnRequestId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects an invalid cancellation reason and backend-controlled fields", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequestId}/cancel`)
      .send({
        reason: "No",

        status: "cancelled",

        cancelledBy: new mongoose.Types.ObjectId().toString(),

        cancelledAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details.length).toBeGreaterThan(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Return Request does not exist", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${missingReturnRequestId}/cancel`)
      .send({
        reason: "I no longer want to return this item.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");

    expect(response.body.message).toBe("Return request was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Ownership Protection
    |--------------------------------------------------------------------------
    */

  it("returns 404 when a customer cancels another customer's Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: ownerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: otherCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,

      customerAgent: ownerAgent,
    });

    const response = await otherCustomerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Attempting to cancel another customer return.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("requested");

    expect(unchangedReturnRequest.cancellation.cancelledAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Requested Return Cancellation
    |--------------------------------------------------------------------------
    */

  it("cancels a requested Return Request and records trusted audit information", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 1,

        productOverrides: {
          name: "Return Cancellation Test Shirt",

          slug: "return-cancellation-test-shirt",

          variants: [
            {
              sku: "RETURN-CANCEL-BLK-M",

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
        },
      });

    const productBeforeCancellation = await Product.findById(
      product._id,
    ).lean();

    const variantBeforeCancellation = findProductVariant(
      productBeforeCancellation,
      variant._id,
    );

    const ledgerEntriesBeforeCancellation = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesBeforeCancellation).toHaveLength(2);

    const orderBeforeCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeCancellation.returnRequestVersion).toBe(1);

    const cancellationReason = "I no longer want to return this product.";

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: cancellationReason,
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return request cancelled successfully");

    const cancelledReturnRequest = response.body.data.returnRequest;

    /*
        |--------------------------------------------------------------------------
        | Customer Response
        |--------------------------------------------------------------------------
        */

    expect(cancelledReturnRequest.id).toBe(returnRequest.id);

    expect(cancelledReturnRequest.status).toBe("cancelled");

    expect(cancelledReturnRequest.cancellation.reason).toBe(cancellationReason);

    expect(cancelledReturnRequest.cancellation.cancelledAt).toBeTruthy();

    expect(cancelledReturnRequest.cancellation).not.toHaveProperty(
      "cancelledBy",
    );

    expect(cancelledReturnRequest).not.toHaveProperty("updatedBy");

    expect(cancelledReturnRequest).not.toHaveProperty("adminNote");

    /*
        |--------------------------------------------------------------------------
        | Stored Cancellation Audit
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("cancelled");

    expect(storedReturnRequest.cancellation.reason).toBe(cancellationReason);

    expect(storedReturnRequest.cancellation.cancelledAt).toBeTruthy();

    expect(String(storedReturnRequest.cancellation.cancelledBy)).toBe(
      String(customer._id),
    );

    expect(String(storedReturnRequest.updatedBy)).toBe(String(customer._id));

    expect(storedReturnRequest.cancellation.cancelledAt.toISOString()).toBe(
      cancelledReturnRequest.cancellation.cancelledAt,
    );

    /*
        |--------------------------------------------------------------------------
        | Return Version Synchronization
        |--------------------------------------------------------------------------
        |
        | Creation incremented it to 1.
        | Cancellation increments it to 2.
        |--------------------------------------------------------------------------
        */

    const orderAfterCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterCancellation.returnRequestVersion).toBe(2);

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterCancellation = await Product.findById(product._id).lean();

    const variantAfterCancellation = findProductVariant(
      productAfterCancellation,
      variant._id,
    );

    expect(variantAfterCancellation.inventory.stock).toBe(
      variantBeforeCancellation.inventory.stock,
    );

    expect(variantAfterCancellation.inventory.reservedStock).toBe(
      variantBeforeCancellation.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerEntriesAfterCancellation = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntriesAfterCancellation).toHaveLength(2);

    expect(
      ledgerEntriesAfterCancellation.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Approved Return Cancellation
    |--------------------------------------------------------------------------
    */

  it("allows a customer to cancel an approved Return Request before physical processing starts", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    await OrderReturnRequest.updateOne(
      {
        _id: returnRequest.id,
      },
      {
        $set: {
          status: "approved",

          "approval.approvedBy": admin._id,

          "approval.approvedAt": new Date(),
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "I decided to keep the approved return item.",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.status).toBe("cancelled");

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("cancelled");

    /*
     * Existing approval audit should remain.
     */
    expect(String(storedReturnRequest.approval.approvedBy)).toBe(
      String(admin._id),
    );

    expect(storedReturnRequest.approval.approvedAt).toBeTruthy();

    expect(storedReturnRequest.cancellation.cancelledAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Cancellation
    |--------------------------------------------------------------------------
    */

  it("rejects cancelling the same Return Request twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "First cancellation request.",
      })
      .expect(200);

    const orderAfterFirstCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterFirstCancellation.returnRequestVersion).toBe(2);

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Second cancellation request.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_ALREADY_CANCELLED");

    expect(response.body.details.status).toBe("cancelled");

    expect(response.body.details.cancelledAt).toBeTruthy();

    const orderAfterSecondCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    /*
     * Failed duplicate cancellation must not
     * increment the version.
     */
    expect(orderAfterSecondCancellation.returnRequestVersion).toBe(2);
  });

  /*
    |--------------------------------------------------------------------------
    | Rejected Return
    |--------------------------------------------------------------------------
    */

  it("rejects cancellation when the Return Request is already rejected", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    await OrderReturnRequest.updateOne(
      {
        _id: returnRequest.id,
      },
      {
        $set: {
          status: "rejected",

          "rejection.reason":
            "The Return Request did not meet the return policy.",

          "rejection.rejectedBy": admin._id,

          "rejection.rejectedAt": new Date(),
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Attempting to cancel a rejected request.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_CANCELLATION_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("rejected");

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("rejected");

    expect(storedReturnRequest.cancellation.cancelledAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | In-Transit Return
    |--------------------------------------------------------------------------
    */

  it("rejects cancellation after the Return Request enters transit", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    await OrderReturnRequest.updateOne(
      {
        _id: returnRequest.id,
      },
      {
        $set: {
          status: "in-transit",
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Attempting cancellation after return shipment.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_CANCELLATION_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("in-transit");
  });

  /*
    |--------------------------------------------------------------------------
    | Approved but Receipt Evidence Exists
    |--------------------------------------------------------------------------
    */

  it("rejects cancellation when an approved Return Request already contains receipt evidence", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const receivedAt = new Date();

    await OrderReturnRequest.updateOne(
      {
        _id: returnRequest.id,
      },
      {
        $set: {
          status: "approved",

          "approval.approvedBy": admin._id,

          "approval.approvedAt": new Date(),

          "receipt.receivedBy": admin._id,

          "receipt.receivedAt": receivedAt,
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Attempting cancellation after warehouse receipt.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_CANCELLATION_STATE_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("approved");

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("approved");

    expect(storedReturnRequest.receipt.receivedAt.getTime()).toBe(
      receivedAt.getTime(),
    );

    expect(storedReturnRequest.cancellation.cancelledAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Quantity Reuse After Cancellation
    |--------------------------------------------------------------------------
    */

  it("releases consumed return quantity so it can be used by a new Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, orderItem, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const orderItemId = String(orderItem._id);

    /*
        |--------------------------------------------------------------------------
        | Quantity Fully Consumed
        |--------------------------------------------------------------------------
        */

    const exhaustedResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId,

            quantity: 1,

            reason: "size-issue",

            details: "Attempt before cancelling the first Return Request.",
          },
        ],
      });

    expect(exhaustedResponse.status).toBe(409);

    expect(exhaustedResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    /*
        |--------------------------------------------------------------------------
        | Cancel Existing Return Request
        |--------------------------------------------------------------------------
        */

    await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Cancelling this Return Request to submit a corrected one.",
      })
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Full Quantity Becomes Available Again
        |--------------------------------------------------------------------------
        */

    const newResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId,

            quantity: 2,

            reason: "size-issue",

            details: "Submitting a corrected Return Request.",
          },
        ],
      });

    expect(newResponse.status).toBe(201);

    expect(newResponse.body.data.returnRequest.items[0].quantity).toBe(2);

    const returnRequests = await OrderReturnRequest.find({
      order: createdOrder.id,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(returnRequests).toHaveLength(2);

    expect(returnRequests[0].status).toBe("cancelled");

    expect(returnRequests[1].status).toBe("requested");

    expect(returnRequests[1].items[0].quantity).toBe(2);

    /*
     * Creation = 1
     * Cancellation = 2
     * Second creation = 3
     */
    const orderWithVersion = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderWithVersion.returnRequestVersion).toBe(3);
  });

  /*
    |--------------------------------------------------------------------------
    | Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back the Order version increment when saving the cancellation fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    /*
|--------------------------------------------------------------------------
| Introduce Invalid Stored Data
|--------------------------------------------------------------------------
|
| returnRequestNumber is immutable, so Model.updateOne() may ignore it.
|
| Native collection access intentionally bypasses Mongoose validation
| and immutable-field protection for this rollback test.
|--------------------------------------------------------------------------
*/

    const returnRequestObjectId = new mongoose.Types.ObjectId(returnRequest.id);

    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequestObjectId,
      },
      {
        $set: {
          returnRequestNumber: "",
        },
      },
    );

    /*
|--------------------------------------------------------------------------
| Confirm Test Data Was Actually Corrupted
|--------------------------------------------------------------------------
*/
    const corruptedReturnRequest = await OrderReturnRequest.collection.findOne({
      _id: returnRequestObjectId,
    });

    expect(corruptedReturnRequest.returnRequestNumber).toBe("");

    const orderBeforeCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeCancellation.returnRequestVersion).toBe(1);

    const response = await customerAgent
      .post(`/api/v1/orders/returns/${returnRequest.id}/cancel`)
      .send({
        reason: "Cancellation transaction rollback integration test.",
      });

    expect(response.status).toBe(400);

    /*
        |--------------------------------------------------------------------------
        | Return Request Cancellation Must Roll Back
        |--------------------------------------------------------------------------
        */

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("requested");

    expect(unchangedReturnRequest.cancellation.reason).toBeNull();

    expect(unchangedReturnRequest.cancellation.cancelledBy).toBeNull();

    expect(unchangedReturnRequest.cancellation.cancelledAt).toBeNull();

    /*
        |--------------------------------------------------------------------------
        | Order Version Increment Must Roll Back
        |--------------------------------------------------------------------------
        */

    const orderAfterCancellation = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterCancellation.returnRequestVersion).toBe(1);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Return Request List
|--------------------------------------------------------------------------
*/

describe("GET /api/v1/admin/order-returns", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when listing Return Requests without authentication", async () => {
    const response = await request(app).get("/api/v1/admin/order-returns");

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer lists admin Return Requests", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get("/api/v1/admin/order-returns");

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Query Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid admin Return Request filters", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get("/api/v1/admin/order-returns").query({
      page: 0,

      limit: 101,

      status: "not-a-return-status",

      customerId: "not-an-object-id",

      sortBy: "unknownField",

      sortDirection: "sideways",
    });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details.length).toBeGreaterThan(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Empty List
    |--------------------------------------------------------------------------
    */

  it("returns an empty paginated list when no Return Requests exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get("/api/v1/admin/order-returns");

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Admin Return Requests retrieved successfully",
    );

    expect(response.body.data.returnRequests).toEqual([]);

    expect(response.body.data.pagination).toEqual({
      page: 1,

      limit: 20,

      total: 0,

      totalPages: 0,

      hasPreviousPage: false,

      hasNextPage: false,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Pagination and Sorting
    |--------------------------------------------------------------------------
    */

  it("paginates and sorts admin Return Requests", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const firstReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      returnRequestNumber: "RET-20260805-AAAAAAAAAAAA",

      productName: "First Admin Return Product",
    });

    const secondReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      returnRequestNumber: "RET-20260805-BBBBBBBBBBBB",

      productName: "Second Admin Return Product",
    });

    const thirdReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      returnRequestNumber: "RET-20260805-CCCCCCCCCCCC",

      productName: "Third Admin Return Product",
    });

    /*
        |--------------------------------------------------------------------------
        | Page One
        |--------------------------------------------------------------------------
        */

    const firstPageResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        page: 1,

        limit: 2,

        sortBy: "returnRequestNumber",

        sortDirection: "asc",
      });

    expect(firstPageResponse.status).toBe(200);

    expect(
      firstPageResponse.body.data.returnRequests.map((returnRequest) => {
        return returnRequest.id;
      }),
    ).toEqual([
      String(firstReturnRequest._id),

      String(secondReturnRequest._id),
    ]);

    expect(firstPageResponse.body.data.pagination).toEqual({
      page: 1,

      limit: 2,

      total: 3,

      totalPages: 2,

      hasPreviousPage: false,

      hasNextPage: true,
    });

    /*
        |--------------------------------------------------------------------------
        | Admin Summary Fields
        |--------------------------------------------------------------------------
        */

    const firstSummary = firstPageResponse.body.data.returnRequests[0];

    expect(firstSummary.customerId).toBe(String(customer._id));

    expect(firstSummary.itemCount).toBe(1);

    expect(firstSummary.totalQuantity).toBe(1);

    expect(firstSummary).not.toHaveProperty("items");

    /*
        |--------------------------------------------------------------------------
        | Page Two
        |--------------------------------------------------------------------------
        */

    const secondPageResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        page: 2,

        limit: 2,

        sortBy: "returnRequestNumber",

        sortDirection: "asc",
      });

    expect(secondPageResponse.status).toBe(200);

    expect(
      secondPageResponse.body.data.returnRequests.map((returnRequest) => {
        return returnRequest.id;
      }),
    ).toEqual([String(thirdReturnRequest._id)]);

    expect(secondPageResponse.body.data.pagination).toEqual({
      page: 2,

      limit: 2,

      total: 3,

      totalPages: 2,

      hasPreviousPage: true,

      hasNextPage: false,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Filters
    |--------------------------------------------------------------------------
    */

  it("filters admin Return Requests by status, resolution, customer and Order", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: firstCustomer } = await createAuthenticatedCustomerAgent();

    const { user: secondCustomer } = await createAuthenticatedCustomerAgent();

    const firstOrderId = new mongoose.Types.ObjectId();

    const secondOrderId = new mongoose.Types.ObjectId();

    const firstReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: firstCustomer._id,

      orderId: firstOrderId,

      returnRequestNumber: "RET-20260805-FILTERAAAAAA",

      status: "requested",

      requestedResolution: "refund",
    });

    const secondReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: secondCustomer._id,

      updatedBy: admin._id,

      orderId: secondOrderId,

      returnRequestNumber: "RET-20260805-FILTERBBBBBB",

      status: "approved",

      requestedResolution: "replacement",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },

      adminNote: "Replacement Return Request approved.",
    });

    /*
        |--------------------------------------------------------------------------
        | Status Filter
        |--------------------------------------------------------------------------
        */

    const statusResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        status: "approved",
      });

    expect(statusResponse.status).toBe(200);

    expect(statusResponse.body.data.returnRequests).toHaveLength(1);

    expect(statusResponse.body.data.returnRequests[0].id).toBe(
      String(secondReturnRequest._id),
    );

    /*
        |--------------------------------------------------------------------------
        | Resolution Filter
        |--------------------------------------------------------------------------
        */

    const resolutionResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        requestedResolution: "refund",
      });

    expect(resolutionResponse.status).toBe(200);

    expect(resolutionResponse.body.data.returnRequests).toHaveLength(1);

    expect(resolutionResponse.body.data.returnRequests[0].id).toBe(
      String(firstReturnRequest._id),
    );

    /*
        |--------------------------------------------------------------------------
        | Customer Filter
        |--------------------------------------------------------------------------
        */

    const customerResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        customerId: String(secondCustomer._id),
      });

    expect(customerResponse.status).toBe(200);

    expect(customerResponse.body.data.returnRequests).toHaveLength(1);

    expect(customerResponse.body.data.returnRequests[0].customerId).toBe(
      String(secondCustomer._id),
    );

    /*
        |--------------------------------------------------------------------------
        | Order Filter
        |--------------------------------------------------------------------------
        */

    const orderResponse = await adminAgent
      .get("/api/v1/admin/order-returns")
      .query({
        orderId: String(firstOrderId),
      });

    expect(orderResponse.status).toBe(200);

    expect(orderResponse.body.data.returnRequests).toHaveLength(1);

    expect(orderResponse.body.data.returnRequests[0].orderId).toBe(
      String(firstOrderId),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

  it("searches Return Requests by Return number, Order number, SKU and Product name", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const searchableReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      returnRequestNumber: "RET-SEARCH-UNIQUE-001",

      orderNumber: "ORD-SEARCH-UNIQUE-001",

      sku: "SEARCH-LINEN-SHIRT-M",

      productName: "Premium Searchable Linen Shirt",
    });

    await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      returnRequestNumber: "RET-DECOY-RETURN-002",

      orderNumber: "ORD-DECOY-ORDER-002",

      sku: "DECOY-COTTON-M",

      productName: "Decoy Cotton Product",
    });

    const searchValues = [
      "RET-SEARCH-UNIQUE-001",
      "ORD-SEARCH-UNIQUE-001",
      "SEARCH-LINEN-SHIRT-M",
      "searchable linen",
    ];

    for (const search of searchValues) {
      const response = await adminAgent
        .get("/api/v1/admin/order-returns")
        .query({
          search,
        });

      expect(response.status).toBe(200);

      expect(response.body.data.returnRequests).toHaveLength(1);

      expect(response.body.data.returnRequests[0].id).toBe(
        String(searchableReturnRequest._id),
      );
    }
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Return Request Details
|--------------------------------------------------------------------------
*/

describe("GET /api/v1/admin/order-returns/:returnRequestId", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when retrieving admin Return Request details without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await request(app).get(
      `/api/v1/admin/order-returns/${returnRequestId}`,
    );

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer retrieves admin Return Request details", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent.get(
      `/api/v1/admin/order-returns/${returnRequestId}`,
    );

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Return Request ID
    |--------------------------------------------------------------------------
    */

  it("returns 400 when the admin Return Request ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/not-a-valid-object-id",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "returnRequestId",
        }),
      ]),
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the admin Return Request does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent.get(
      `/api/v1/admin/order-returns/${missingReturnRequestId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");

    expect(response.body.message).toBe("Return request was not found");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Admin Details
    |--------------------------------------------------------------------------
    */

  it("returns complete Return Request details including internal audit fields", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const approvedAt = new Date("2026-08-05T08:00:00.000Z");

    const receivedAt = new Date("2026-08-05T09:00:00.000Z");

    const inspectedAt = new Date("2026-08-05T10:00:00.000Z");

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      returnRequestNumber: "RET-20260805-INSPECTED001",

      orderNumber: "ORD-20260805-INSPECTED001",

      status: "inspected",

      requestedResolution: "refund",

      quantity: 2,

      productName: "Inspected Linen Return Shirt",

      sku: "INSPECTED-LINEN-M",

      customerNote: "The two delivered shirts were defective.",

      adminNote: "Warehouse inspection completed.",

      approval: {
        approvedBy: admin._id,

        approvedAt,
      },

      receipt: {
        receivedBy: admin._id,

        receivedAt,
      },

      inspection: {
        status: "inspected",

        resellableQuantity: 1,

        damagedQuantity: 1,

        rejectedQuantity: 0,

        note: "One unit can be resold and one unit is damaged.",

        inspectedBy: admin._id,

        inspectedAt,
      },
    });

    const response = await adminAgent.get(
      `/api/v1/admin/order-returns/${returnRequest._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Admin Return Request retrieved successfully",
    );

    const returnedDetails = response.body.data.returnRequest;

    /*
        |--------------------------------------------------------------------------
        | Main Return Information
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.id).toBe(String(returnRequest._id));

    expect(returnedDetails.returnRequestNumber).toBe(
      "RET-20260805-INSPECTED001",
    );

    expect(returnedDetails.orderNumber).toBe("ORD-20260805-INSPECTED001");

    expect(returnedDetails.customerId).toBe(String(customer._id));

    expect(returnedDetails.status).toBe("inspected");

    expect(returnedDetails.requestedResolution).toBe("refund");

    expect(returnedDetails.customerNote).toBe(
      "The two delivered shirts were defective.",
    );

    expect(returnedDetails.adminNote).toBe("Warehouse inspection completed.");

    /*
        |--------------------------------------------------------------------------
        | Approval Audit
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.approval).toEqual({
      approvedBy: String(admin._id),

      approvedAt: approvedAt.toISOString(),
    });

    /*
        |--------------------------------------------------------------------------
        | Warehouse Receipt Audit
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.receipt).toEqual({
      note: null,

      receivedBy: String(admin._id),

      receivedAt: receivedAt.toISOString(),
    });

    /*
        |--------------------------------------------------------------------------
        | Item and Inspection Details
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.items).toHaveLength(1);

    const returnedItem = returnedDetails.items[0];

    expect(returnedItem.sku).toBe("INSPECTED-LINEN-M");

    expect(returnedItem.productName).toBe("Inspected Linen Return Shirt");

    expect(returnedItem.quantity).toBe(2);

    expect(returnedItem.inspection).toEqual({
      status: "inspected",

      resellableQuantity: 1,

      damagedQuantity: 1,

      rejectedQuantity: 0,

      note: "One unit can be resold and one unit is damaged.",

      inspectedBy: String(admin._id),

      inspectedAt: inspectedAt.toISOString(),
    });

    /*
        |--------------------------------------------------------------------------
        | Internal Audit Actors
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.createdBy).toBe(String(customer._id));

    expect(returnedDetails.updatedBy).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Empty Terminal-State Audits
        |--------------------------------------------------------------------------
        */

    expect(returnedDetails.rejection).toEqual({
      reason: null,

      rejectedBy: null,

      rejectedAt: null,
    });

    expect(returnedDetails.completion).toEqual({
      completedBy: null,

      completedAt: null,
    });

    expect(returnedDetails.cancellation).toEqual({
      reason: null,

      cancelledBy: null,

      cancelledAt: null,
    });
  });
});

/*
|--------------------------------------------------------------------------
| Admin Order Return Approval and Rejection
|--------------------------------------------------------------------------
*/

describe("Admin Order Return approval and rejection", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when approval or rejection is attempted without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const approvalResponse = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/approve`)
      .send({});

    expect(approvalResponse.status).toBe(401);

    const rejectionResponse = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/reject`)
      .send({
        reason: "The Return Request does not satisfy the return policy.",
      });

    expect(rejectionResponse.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer attempts to approve or reject a Return Request", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const approvalResponse = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/approve`)
      .send({});

    expect(approvalResponse.status).toBe(403);

    const rejectionResponse = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/reject`)
      .send({
        reason: "The Return Request does not satisfy the return policy.",
      });

    expect(rejectionResponse.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid Return Request IDs and backend-controlled decision fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const invalidApprovalIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-a-valid-object-id/approve")
      .send({});

    expect(invalidApprovalIdResponse.status).toBe(400);

    expect(invalidApprovalIdResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidRejectionIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-a-valid-object-id/reject")
      .send({
        reason: "The Return Request does not satisfy the return policy.",
      });

    expect(invalidRejectionIdResponse.status).toBe(400);

    expect(invalidRejectionIdResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const invalidApprovalBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/approve`)
      .send({
        status: "approved",

        approvedBy: new mongoose.Types.ObjectId().toString(),

        approvedAt: new Date().toISOString(),
      });

    expect(invalidApprovalBodyResponse.status).toBe(400);

    expect(invalidApprovalBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidRejectionBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/reject`)
      .send({
        reason: "No",

        status: "rejected",

        rejectedBy: new mongoose.Types.ObjectId().toString(),
      });

    expect(invalidRejectionBodyResponse.status).toBe(400);

    expect(invalidRejectionBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Return Request does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const approvalResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/approve`)
      .send({});

    expect(approvalResponse.status).toBe(404);

    expect(approvalResponse.body.errorCode).toBe(
      "ORDER_RETURN_REQUEST_NOT_FOUND",
    );

    const rejectionResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/reject`)
      .send({
        reason: "The Return Request does not satisfy the return policy.",
      });

    expect(rejectionResponse.status).toBe(404);

    expect(rejectionResponse.body.errorCode).toBe(
      "ORDER_RETURN_REQUEST_NOT_FOUND",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Approval
    |--------------------------------------------------------------------------
    */

  it("approves a requested Return Request without releasing quantity or changing inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const productBeforeApproval = await Product.findById(product._id).lean();

    const variantBeforeApproval = findProductVariant(
      productBeforeApproval,
      variant._id,
    );

    const ledgerBeforeApproval = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerBeforeApproval.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    const orderBeforeApproval = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeApproval.returnRequestVersion).toBe(1);

    const adminNote = "The Return Request was reviewed and approved.";

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/approve`)
      .send({
        adminNote,
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return Request approved successfully");

    const approvedReturnRequest = response.body.data.returnRequest;

    expect(approvedReturnRequest.id).toBe(returnRequest.id);

    expect(approvedReturnRequest.status).toBe("approved");

    expect(approvedReturnRequest.adminNote).toBe(adminNote);

    expect(approvedReturnRequest.approval.approvedBy).toBe(String(admin._id));

    expect(approvedReturnRequest.approval.approvedAt).toBeTruthy();

    expect(approvedReturnRequest.updatedBy).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Stored Approval Audit
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("approved");

    expect(storedReturnRequest.adminNote).toBe(adminNote);

    expect(String(storedReturnRequest.approval.approvedBy)).toBe(
      String(admin._id),
    );

    expect(storedReturnRequest.approval.approvedAt).toBeTruthy();

    expect(String(storedReturnRequest.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Approval Must Not Release Return Quantity
        |--------------------------------------------------------------------------
        */

    const exhaustedQuantityResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "Attempting another return after approval.",
          },
        ],
      });

    expect(exhaustedQuantityResponse.status).toBe(409);

    expect(exhaustedQuantityResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    expect(exhaustedQuantityResponse.body.details).toMatchObject({
      orderedQuantity: 2,

      consumedQuantity: 2,

      requestedQuantity: 1,

      remainingQuantity: 0,
    });

    /*
        |--------------------------------------------------------------------------
        | Approval Must Not Increment Return Quantity Version
        |--------------------------------------------------------------------------
        */

    const orderAfterApproval = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterApproval.returnRequestVersion).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterApproval = await Product.findById(product._id).lean();

    const variantAfterApproval = findProductVariant(
      productAfterApproval,
      variant._id,
    );

    expect(variantAfterApproval.inventory.stock).toBe(
      variantBeforeApproval.inventory.stock,
    );

    expect(variantAfterApproval.inventory.reservedStock).toBe(
      variantBeforeApproval.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No New Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerAfterApproval = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfterApproval.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Rejection and Quantity Release
    |--------------------------------------------------------------------------
    */

  it("rejects a Return Request and releases its consumed quantity", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const productBeforeRejection = await Product.findById(product._id).lean();

    const variantBeforeRejection = findProductVariant(
      productBeforeRejection,
      variant._id,
    );

    /*
        |--------------------------------------------------------------------------
        | Quantity Is Fully Consumed Before Rejection
        |--------------------------------------------------------------------------
        */

    const exhaustedResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "size-issue",

            details: "Attempt before rejection.",
          },
        ],
      });

    expect(exhaustedResponse.status).toBe(409);

    expect(exhaustedResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    const rejectionReason =
      "The Return Request does not satisfy the return policy.";

    const adminNote = "The submitted evidence was insufficient.";

    const rejectionResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/reject`)
      .send({
        reason: rejectionReason,

        adminNote,
      });

    expect(rejectionResponse.status).toBe(200);

    expect(rejectionResponse.body.message).toBe(
      "Return Request rejected successfully",
    );

    const rejectedReturnRequest = rejectionResponse.body.data.returnRequest;

    expect(rejectedReturnRequest.status).toBe("rejected");

    expect(rejectedReturnRequest.adminNote).toBe(adminNote);

    expect(rejectedReturnRequest.rejection.reason).toBe(rejectionReason);

    expect(rejectedReturnRequest.rejection.rejectedBy).toBe(String(admin._id));

    expect(rejectedReturnRequest.rejection.rejectedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Stored Rejection Audit
        |--------------------------------------------------------------------------
        */

    const storedRejectedRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedRejectedRequest.status).toBe("rejected");

    expect(storedRejectedRequest.rejection.reason).toBe(rejectionReason);

    expect(String(storedRejectedRequest.rejection.rejectedBy)).toBe(
      String(admin._id),
    );

    expect(String(storedRejectedRequest.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Rejection Releases the Full Quantity
        |--------------------------------------------------------------------------
        */

    const replacementResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 2,

            reason: "size-issue",

            details: "New Return Request after the previous rejection.",
          },
        ],
      });

    expect(replacementResponse.status).toBe(201);

    expect(replacementResponse.body.data.returnRequest.items[0].quantity).toBe(
      2,
    );

    const returnRequests = await OrderReturnRequest.find({
      order: createdOrder.id,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(returnRequests).toHaveLength(2);

    expect(returnRequests[0].status).toBe("rejected");

    expect(returnRequests[1].status).toBe("requested");

    /*
        |--------------------------------------------------------------------------
        | Return Request Version
        |--------------------------------------------------------------------------
        |
        | Initial creation = 1
        | Rejection       = 2
        | New creation    = 3
        |--------------------------------------------------------------------------
        */

    const orderAfterReplacement = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterReplacement.returnRequestVersion).toBe(3);

    /*
        |--------------------------------------------------------------------------
        | Inventory Remains Unchanged
        |--------------------------------------------------------------------------
        */

    const productAfterRejection = await Product.findById(product._id).lean();

    const variantAfterRejection = findProductVariant(
      productAfterRejection,
      variant._id,
    );

    expect(variantAfterRejection.inventory.stock).toBe(
      variantBeforeRejection.inventory.stock,
    );

    expect(variantAfterRejection.inventory.reservedStock).toBe(
      variantBeforeRejection.inventory.reservedStock,
    );

    const ledgerAfterRejection = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfterRejection.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Approval
    |--------------------------------------------------------------------------
    */

  it("rejects approving an already approved Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,
    });

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/approve`)
      .send({})
      .expect(200);

    const secondResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/approve`)
      .send({});

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe("ORDER_RETURN_ALREADY_APPROVED");

    expect(secondResponse.body.details.status).toBe("approved");

    expect(secondResponse.body.details.approvedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Rejection
    |--------------------------------------------------------------------------
    */

  it("rejects rejecting an already rejected Return Request", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const rejectedAt = new Date();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "rejected",

      rejection: {
        reason: "The Return Request was previously rejected.",

        rejectedBy: admin._id,

        rejectedAt,
      },
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/reject`)
      .send({
        reason: "Attempting to reject the Return Request again.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_ALREADY_REJECTED");

    expect(response.body.details.status).toBe("rejected");

    expect(response.body.details.rejectedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Conflicting Decisions
    |--------------------------------------------------------------------------
    */

  it("prevents rejecting an approved request and approving a rejected request", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const approvedReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "approved",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    const rejectApprovedResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${approvedReturnRequest._id}/reject`)
      .send({
        reason: "Attempting to reject an approved request.",
      });

    expect(rejectApprovedResponse.status).toBe(409);

    expect(rejectApprovedResponse.body.errorCode).toBe(
      "ORDER_RETURN_ALREADY_APPROVED",
    );

    const rejectedReturnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "rejected",

      rejection: {
        reason: "The Return Request was rejected.",

        rejectedBy: admin._id,

        rejectedAt: new Date(),
      },
    });

    const approveRejectedResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${rejectedReturnRequest._id}/approve`)
      .send({});

    expect(approveRejectedResponse.status).toBe(409);

    expect(approveRejectedResponse.body.errorCode).toBe(
      "ORDER_RETURN_ALREADY_REJECTED",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Cancelled Return Request
    |--------------------------------------------------------------------------
    */

  it("prevents approving or rejecting a cancelled Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const cancelledAt = new Date();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      status: "cancelled",

      cancellation: {
        reason: "The customer cancelled the Return Request.",

        cancelledBy: customer._id,

        cancelledAt,
      },
    });

    const approvalResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/approve`)
      .send({});

    expect(approvalResponse.status).toBe(409);

    expect(approvalResponse.body.errorCode).toBe(
      "ORDER_RETURN_APPROVAL_STATUS_INVALID",
    );

    const rejectionResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/reject`)
      .send({
        reason: "Attempting to reject a cancelled request.",
      });

    expect(rejectionResponse.status).toBe(409);

    expect(rejectionResponse.body.errorCode).toBe(
      "ORDER_RETURN_REJECTION_STATUS_INVALID",
    );

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("cancelled");

    expect(unchangedReturnRequest.cancellation.cancelledAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Inconsistent Physical Processing State
    |--------------------------------------------------------------------------
    */

  it("rejects admin decisions when a requested Return Request already contains receipt evidence", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,
    });

    /*
     * Native collection update intentionally creates an inconsistent
     * stored state without Mongoose validation.
     */
    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequest._id,
      },
      {
        $set: {
          "receipt.receivedBy": admin._id,

          "receipt.receivedAt": new Date(),
        },
      },
    );

    const approvalResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/approve`)
      .send({});

    expect(approvalResponse.status).toBe(409);

    expect(approvalResponse.body.errorCode).toBe(
      "ORDER_RETURN_DECISION_STATE_INVALID",
    );

    const rejectionResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/reject`)
      .send({
        reason: "Attempting a decision after receipt evidence exists.",
      });

    expect(rejectionResponse.status).toBe(409);

    expect(rejectionResponse.body.errorCode).toBe(
      "ORDER_RETURN_DECISION_STATE_INVALID",
    );

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("requested");

    expect(unchangedReturnRequest.approval.approvedAt).toBeNull();

    expect(unchangedReturnRequest.rejection.rejectedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Rejection Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back the Order version increment when rejection persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    /*
        |--------------------------------------------------------------------------
        | Corrupt Stored Data
        |--------------------------------------------------------------------------
        |
        | Native collection access bypasses:
        |
        | - Mongoose enum validation
        | - schema middleware
        | - normal document validation
        |--------------------------------------------------------------------------
        */

    const returnRequestObjectId = new mongoose.Types.ObjectId(returnRequest.id);

    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequestObjectId,
      },
      {
        $set: {
          requestedResolution: "invalid-resolution",
        },
      },
    );

    const corruptedReturnRequest = await OrderReturnRequest.collection.findOne({
      _id: returnRequestObjectId,
    });

    expect(corruptedReturnRequest.requestedResolution).toBe(
      "invalid-resolution",
    );

    const orderBeforeRejection = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeRejection.returnRequestVersion).toBe(1);

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/reject`)
      .send({
        reason: "Rejection transaction rollback integration test.",
      });

    expect(response.status).toBe(400);

    /*
        |--------------------------------------------------------------------------
        | Return Request Decision Must Roll Back
        |--------------------------------------------------------------------------
        */

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("requested");

    expect(unchangedReturnRequest.rejection.reason).toBeNull();

    expect(unchangedReturnRequest.rejection.rejectedBy).toBeNull();

    expect(unchangedReturnRequest.rejection.rejectedAt).toBeNull();

    /*
        |--------------------------------------------------------------------------
        | Linked Order Version Must Roll Back
        |--------------------------------------------------------------------------
        */

    const orderAfterRejection = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterRejection.returnRequestVersion).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Approval and Rejection
    |--------------------------------------------------------------------------
    */

  it("allows only one decision when approval and rejection happen concurrently", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    const [approvalResponse, rejectionResponse] = await Promise.all([
      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/approve`)
        .send({
          adminNote: "Concurrent approval attempt.",
        }),

      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/reject`)
        .send({
          reason: "Concurrent rejection attempt.",
        }),
    ]);

    const responses = [approvalResponse, rejectionResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_DECISION_CONFLICT",
      "ORDER_RETURN_ALREADY_APPROVED",
      "ORDER_RETURN_ALREADY_REJECTED",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
        |--------------------------------------------------------------------------
        | Final State Must Contain Exactly One Decision
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(["approved", "rejected"]).toContain(storedReturnRequest.status);

    if (storedReturnRequest.status === "approved") {
      expect(storedReturnRequest.approval.approvedAt).toBeTruthy();

      expect(storedReturnRequest.rejection.rejectedAt).toBeNull();
    }

    if (storedReturnRequest.status === "rejected") {
      expect(storedReturnRequest.rejection.rejectedAt).toBeTruthy();

      expect(storedReturnRequest.approval.approvedAt).toBeNull();
    }

    /*
        |--------------------------------------------------------------------------
        | Version Depends on Winning Decision
        |--------------------------------------------------------------------------
        |
        | Approval does not release quantity: version remains 1.
        | Rejection releases quantity: version becomes 2.
        |--------------------------------------------------------------------------
        */

    const linkedOrder = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    if (storedReturnRequest.status === "approved") {
      expect(linkedOrder.returnRequestVersion).toBe(1);
    }

    if (storedReturnRequest.status === "rejected") {
      expect(linkedOrder.returnRequestVersion).toBe(2);
    }
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Shipment and Warehouse Receipt
|--------------------------------------------------------------------------
*/

describe("Admin Return shipment and warehouse receipt", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when shipment or receipt is attempted without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const shipmentResponse = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/mark-in-transit`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-RETURN-401",
      });

    expect(shipmentResponse.status).toBe(401);

    const receiptResponse = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/receive`)
      .send({});

    expect(receiptResponse.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Admin Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer attempts shipment or warehouse receipt operations", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const shipmentResponse = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/mark-in-transit`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-RETURN-403",
      });

    expect(shipmentResponse.status).toBe(403);

    const receiptResponse = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/receive`)
      .send({});

    expect(receiptResponse.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Request Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid Return Request IDs and backend-controlled shipment or receipt fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const invalidShipmentIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-a-valid-object-id/mark-in-transit")
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-RETURN-INVALID-ID",
      });

    expect(invalidShipmentIdResponse.status).toBe(400);

    expect(invalidShipmentIdResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidReceiptIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-a-valid-object-id/receive")
      .send({});

    expect(invalidReceiptIdResponse.status).toBe(400);

    expect(invalidReceiptIdResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const invalidShipmentBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/mark-in-transit`)
      .send({
        carrier: "A",

        trackingNumber: "X",

        trackingUrl: "not-a-valid-url",

        status: "in-transit",

        markedInTransitBy: new mongoose.Types.ObjectId().toString(),

        markedInTransitAt: new Date().toISOString(),
      });

    expect(invalidShipmentBodyResponse.status).toBe(400);

    expect(invalidShipmentBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidReceiptBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/receive`)
      .send({
        status: "received",

        receivedBy: new mongoose.Types.ObjectId().toString(),

        receivedAt: new Date().toISOString(),
      });

    expect(invalidReceiptBodyResponse.status).toBe(400);

    expect(invalidReceiptBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when shipment or receipt is attempted for a missing Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const shipmentResponse = await adminAgent
      .post(
        `/api/v1/admin/order-returns/${missingReturnRequestId}/mark-in-transit`,
      )
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-MISSING-RETURN",
      });

    expect(shipmentResponse.status).toBe(404);

    expect(shipmentResponse.body.errorCode).toBe(
      "ORDER_RETURN_REQUEST_NOT_FOUND",
    );

    const receiptResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/receive`)
      .send({});

    expect(receiptResponse.status).toBe(404);

    expect(receiptResponse.body.errorCode).toBe(
      "ORDER_RETURN_REQUEST_NOT_FOUND",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Mark-In-Transit
    |--------------------------------------------------------------------------
    */

  it("marks an approved Return Request as in transit using trusted audit fields without changing quantity or inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createApprovedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const productBeforeShipment = await Product.findById(product._id).lean();

    const variantBeforeShipment = findProductVariant(
      productBeforeShipment,
      variant._id,
    );

    const ledgerBeforeShipment = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(
      ledgerBeforeShipment.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);

    const orderBeforeShipment = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeShipment.returnRequestVersion).toBe(1);

    const shipmentData = {
      carrier: "Blue Dart",

      trackingNumber: "BD-RETURN-SUCCESS-001",

      trackingUrl: "https://tracking.example.com/BD-RETURN-SUCCESS-001",

      note: "Customer pickup completed at the registered address.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
      .send(shipmentData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return Request marked as in transit successfully",
    );

    const inTransitReturnRequest = response.body.data.returnRequest;

    expect(inTransitReturnRequest.status).toBe("in-transit");

    expect(inTransitReturnRequest.shipment).toMatchObject({
      carrier: shipmentData.carrier,

      trackingNumber: shipmentData.trackingNumber,

      trackingUrl: shipmentData.trackingUrl,

      note: shipmentData.note,

      markedInTransitBy: String(admin._id),
    });

    expect(inTransitReturnRequest.shipment.markedInTransitAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Stored Shipment Audit
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("in-transit");

    expect(storedReturnRequest.shipment.carrier).toBe(shipmentData.carrier);

    expect(storedReturnRequest.shipment.trackingNumber).toBe(
      shipmentData.trackingNumber,
    );

    expect(storedReturnRequest.shipment.trackingUrl).toBe(
      shipmentData.trackingUrl,
    );

    expect(storedReturnRequest.shipment.note).toBe(shipmentData.note);

    expect(String(storedReturnRequest.shipment.markedInTransitBy)).toBe(
      String(admin._id),
    );

    expect(storedReturnRequest.shipment.markedInTransitAt).toBeTruthy();

    expect(String(storedReturnRequest.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Shipment Retains Consumed Return Quantity
        |--------------------------------------------------------------------------
        */

    const exhaustedResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "Attempt to create an additional return during shipment.",
          },
        ],
      });

    expect(exhaustedResponse.status).toBe(409);

    expect(exhaustedResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    expect(exhaustedResponse.body.details).toMatchObject({
      orderedQuantity: 2,

      consumedQuantity: 2,

      requestedQuantity: 1,

      remainingQuantity: 0,
    });

    /*
        |--------------------------------------------------------------------------
        | Return Version Must Not Change
        |--------------------------------------------------------------------------
        */

    const orderAfterShipment = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterShipment.returnRequestVersion).toBe(1);

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
        | No Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerAfterShipment = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(
      ledgerAfterShipment.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Shipment Status Protection
    |--------------------------------------------------------------------------
    */

  it("rejects marking a requested Return Request as in transit before approval", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-BEFORE-APPROVAL",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_SHIPMENT_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("requested");

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("requested");

    expect(unchangedReturnRequest.shipment.markedInTransitAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Approval Evidence
    |--------------------------------------------------------------------------
    */

  it("rejects marking an approved Return Request as in transit when approval audit evidence is missing", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      status: "approved",
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/mark-in-transit`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-MISSING-APPROVAL-AUDIT",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_SHIPMENT_STATE_INVALID");

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(storedReturnRequest.status).toBe("approved");

    expect(storedReturnRequest.shipment.markedInTransitAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Shipment
    |--------------------------------------------------------------------------
    */

  it("rejects marking the same Return Request as in transit twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createInTransitCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
      .send({
        carrier: "Different Carrier",

        trackingNumber: "DUPLICATE-TRACKING-NUMBER",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_ALREADY_IN_TRANSIT");

    expect(response.body.details.status).toBe("in-transit");

    expect(response.body.details.markedInTransitAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Warehouse Receipt
    |--------------------------------------------------------------------------
    */

  it("receives an in-transit Return Request while preserving shipment data and leaving inventory unchanged", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const shipmentData = {
      carrier: "Delhivery",

      trackingNumber: "DLV-RETURN-RECEIPT-001",

      trackingUrl: "https://tracking.example.com/DLV-RETURN-RECEIPT-001",

      note: "Customer return parcel collected.",
    };

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createInTransitCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,

        shipmentData,
      });

    const productBeforeReceipt = await Product.findById(product._id).lean();

    const variantBeforeReceipt = findProductVariant(
      productBeforeReceipt,
      variant._id,
    );

    const orderBeforeReceipt = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderBeforeReceipt.returnRequestVersion).toBe(1);

    const receiptData = {
      note: "The sealed parcel was received at the Pune warehouse.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/receive`)
      .send(receiptData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return Request received successfully");

    const receivedReturnRequest = response.body.data.returnRequest;

    expect(receivedReturnRequest.status).toBe("received");

    expect(receivedReturnRequest.receipt).toMatchObject({
      note: receiptData.note,

      receivedBy: String(admin._id),
    });

    expect(receivedReturnRequest.receipt.receivedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Shipment Data Must Remain Unchanged
        |--------------------------------------------------------------------------
        */

    expect(receivedReturnRequest.shipment).toMatchObject({
      carrier: shipmentData.carrier,

      trackingNumber: shipmentData.trackingNumber,

      trackingUrl: shipmentData.trackingUrl,

      note: shipmentData.note,

      markedInTransitBy: String(admin._id),
    });

    /*
        |--------------------------------------------------------------------------
        | Stored Receipt Audit
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("received");

    expect(storedReturnRequest.receipt.note).toBe(receiptData.note);

    expect(String(storedReturnRequest.receipt.receivedBy)).toBe(
      String(admin._id),
    );

    expect(storedReturnRequest.receipt.receivedAt).toBeTruthy();

    expect(storedReturnRequest.shipment.trackingNumber).toBe(
      shipmentData.trackingNumber,
    );

    /*
        |--------------------------------------------------------------------------
        | Receipt Retains Consumed Return Quantity
        |--------------------------------------------------------------------------
        */

    const exhaustedResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "replacement",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "quality-issue",

            details:
              "Attempt to create another return after warehouse receipt.",
          },
        ],
      });

    expect(exhaustedResponse.status).toBe(409);

    expect(exhaustedResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    /*
        |--------------------------------------------------------------------------
        | Return Version Must Not Change
        |--------------------------------------------------------------------------
        */

    const orderAfterReceipt = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterReceipt.returnRequestVersion).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Not Change
        |--------------------------------------------------------------------------
        */

    const productAfterReceipt = await Product.findById(product._id).lean();

    const variantAfterReceipt = findProductVariant(
      productAfterReceipt,
      variant._id,
    );

    expect(variantAfterReceipt.inventory.stock).toBe(
      variantBeforeReceipt.inventory.stock,
    );

    expect(variantAfterReceipt.inventory.reservedStock).toBe(
      variantBeforeReceipt.inventory.reservedStock,
    );

    /*
        |--------------------------------------------------------------------------
        | No Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(
      ledgerEntries.map((entry) => {
        return entry.operation;
      }),
    ).toEqual(["reserve", "commit"]);
  });

  /*
    |--------------------------------------------------------------------------
    | Receipt Status Protection
    |--------------------------------------------------------------------------
    */

  it("rejects receiving an approved Return Request before it enters transit", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createApprovedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/receive`)
      .send({
        note: "Attempt to receive before shipment.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_RECEIPT_STATUS_INVALID");

    expect(response.body.details.currentStatus).toBe("approved");
  });

  /*
    |--------------------------------------------------------------------------
    | Incomplete Shipment Evidence
    |--------------------------------------------------------------------------
    */

  it("rejects warehouse receipt when an in-transit Return Request has incomplete shipment evidence", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "in-transit",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    /*
     * Native collection access creates incomplete
     * shipment evidence intentionally.
     */
    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequest._id,
      },
      {
        $set: {
          "shipment.carrier": "Blue Dart",

          "shipment.markedInTransitBy": admin._id,

          "shipment.markedInTransitAt": new Date(),

          /*
           * trackingNumber is intentionally absent.
           */
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/receive`)
      .send({
        note: "Attempt to receive with incomplete shipment evidence.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_RECEIPT_STATE_INVALID");

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("in-transit");

    expect(unchangedReturnRequest.receipt.receivedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Warehouse Receipt
    |--------------------------------------------------------------------------
    */

  it("rejects receiving the same Return Request twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createInTransitCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/receive`)
      .send({
        note: "First warehouse receipt.",
      })
      .expect(200);

    const secondResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/receive`)
      .send({
        note: "Duplicate warehouse receipt.",
      });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe("ORDER_RETURN_ALREADY_RECEIVED");

    expect(secondResponse.body.details.status).toBe("received");

    expect(secondResponse.body.details.receivedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Shipment Persistence Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back shipment changes when Return Request persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createApprovedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const returnRequestObjectId = new mongoose.Types.ObjectId(returnRequest.id);

    /*
     * Corrupt an enum-controlled field using
     * native collection access.
     */
    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequestObjectId,
      },
      {
        $set: {
          requestedResolution: "invalid-resolution",
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "BD-ROLLBACK-SHIPMENT",
      });

    expect(response.status).toBe(400);

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("approved");

    expect(unchangedReturnRequest.shipment.carrier).toBeNull();

    expect(unchangedReturnRequest.shipment.trackingNumber).toBeNull();

    expect(unchangedReturnRequest.shipment.markedInTransitBy).toBeNull();

    expect(unchangedReturnRequest.shipment.markedInTransitAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Receipt Persistence Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back warehouse receipt changes when Return Request persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createInTransitCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,
      },
    );

    const returnRequestObjectId = new mongoose.Types.ObjectId(returnRequest.id);

    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequestObjectId,
      },
      {
        $set: {
          requestedResolution: "invalid-resolution",
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/receive`)
      .send({
        note: "Receipt persistence rollback test.",
      });

    expect(response.status).toBe(400);

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("in-transit");

    expect(unchangedReturnRequest.receipt.note).toBeNull();

    expect(unchangedReturnRequest.receipt.receivedBy).toBeNull();

    expect(unchangedReturnRequest.receipt.receivedAt).toBeNull();

    /*
     * Existing shipment must remain intact.
     */
    expect(unchangedReturnRequest.shipment.trackingNumber).toBeTruthy();

    expect(unchangedReturnRequest.shipment.markedInTransitAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Shipment Protection
    |--------------------------------------------------------------------------
    */

  it("allows only one mark-in-transit operation when two shipment requests happen concurrently", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createApprovedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const [firstResponse, secondResponse] = await Promise.all([
      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
        .send({
          carrier: "Blue Dart",

          trackingNumber: "BD-CONCURRENT-001",
        }),

      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/mark-in-transit`)
        .send({
          carrier: "Delhivery",

          trackingNumber: "DLV-CONCURRENT-002",
        }),
    ]);

    const responses = [firstResponse, secondResponse];

    const successfulResponses = responses.filter((response) => {
      return response.status === 200;
    });

    const conflictResponses = responses.filter((response) => {
      return response.status === 409;
    });

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_PROCESSING_CONFLICT",
      "ORDER_RETURN_ALREADY_IN_TRANSIT",
    ]).toContain(conflictResponses[0].body.errorCode);

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("in-transit");

    expect(["BD-CONCURRENT-001", "DLV-CONCURRENT-002"]).toContain(
      storedReturnRequest.shipment.trackingNumber,
    );

    expect(storedReturnRequest.shipment.markedInTransitAt).toBeTruthy();
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Warehouse Inspection
|--------------------------------------------------------------------------
*/

describe("Admin Return warehouse inspection", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when inspection is attempted without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/inspect`)
      .send({
        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer attempts to inspect a Return Request", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/inspect`)
      .send({
        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid inspection request data and backend-controlled fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
     * Invalid Return Request ID.
     */

    const invalidIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-valid-id/inspect")
      .send({
        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(invalidIdResponse.status).toBe(400);

    expect(invalidIdResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
     * Backend-controlled inspection fields.
     */

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const invalidBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/inspect`)
      .send({
        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,

            status: "inspected",

            inspectedBy: new mongoose.Types.ObjectId().toString(),

            inspectedAt: new Date().toISOString(),
          },
        ],
      });

    expect(invalidBodyResponse.status).toBe(400);

    expect(invalidBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when the Return Request does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/inspect`)
      .send({
        items: [
          {
            orderItemId: new mongoose.Types.ObjectId().toString(),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Inspection
    |--------------------------------------------------------------------------
    */

  it("inspects a received Return Request while preserving its trusted item identity and leaving inventory unchanged", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    /*
        |--------------------------------------------------------------------------
        | Snapshot Return Item Before Inspection
        |--------------------------------------------------------------------------
        */

    const returnBeforeInspection = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(returnBeforeInspection.status).toBe("received");

    const returnItemBefore = returnBeforeInspection.items[0];

    const returnItemSubdocumentIdBefore = String(returnItemBefore._id);

    const trustedProductBefore = String(returnItemBefore.product);

    const trustedVariantBefore = String(returnItemBefore.variantId);

    const trustedSkuBefore = returnItemBefore.sku;

    const trustedQuantityBefore = returnItemBefore.quantity;

    /*
        |--------------------------------------------------------------------------
        | Snapshot Product Inventory
        |--------------------------------------------------------------------------
        */

    const productBeforeInspection = await Product.findById(product._id).lean();

    const variantBeforeInspection = findProductVariant(
      productBeforeInspection,
      variant._id,
    );

    const stockBefore = variantBeforeInspection.inventory.stock;

    const reservedStockBefore = variantBeforeInspection.inventory.reservedStock;

    /*
        |--------------------------------------------------------------------------
        | Snapshot Inventory Ledger
        |--------------------------------------------------------------------------
        */

    const ledgerBeforeInspection = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerBeforeInspection.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    /*
        |--------------------------------------------------------------------------
        | Inspect Return
        |--------------------------------------------------------------------------
        |
        | Returned quantity = 2
        |
        | 1 resellable + 1 damaged = 2
        |--------------------------------------------------------------------------
        */

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            resellableQuantity: 1,

            damagedQuantity: 1,

            rejectedQuantity: 0,

            note: "One unit is resellable and one unit has physical damage.",
          },
        ],
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return Request inspected successfully");

    const inspectedReturnRequest = response.body.data.returnRequest;

    expect(inspectedReturnRequest.status).toBe("inspected");

    expect(inspectedReturnRequest.items[0].inspection).toMatchObject({
      status: "inspected",

      resellableQuantity: 1,

      damagedQuantity: 1,

      rejectedQuantity: 0,

      note: "One unit is resellable and one unit has physical damage.",

      inspectedBy: String(admin._id),
    });

    expect(inspectedReturnRequest.items[0].inspection.inspectedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Verify Stored Inspection
        |--------------------------------------------------------------------------
        */

    const returnAfterInspection = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(returnAfterInspection.status).toBe("inspected");

    const returnItemAfter = returnAfterInspection.items[0];

    /*
        |--------------------------------------------------------------------------
        | Return Item Identity Must Be Preserved
        |--------------------------------------------------------------------------
        */

    expect(String(returnItemAfter._id)).toBe(returnItemSubdocumentIdBefore);

    expect(String(returnItemAfter.product)).toBe(trustedProductBefore);

    expect(String(returnItemAfter.variantId)).toBe(trustedVariantBefore);

    expect(returnItemAfter.sku).toBe(trustedSkuBefore);

    expect(returnItemAfter.quantity).toBe(trustedQuantityBefore);

    /*
        |--------------------------------------------------------------------------
        | Stored Inspection Audit
        |--------------------------------------------------------------------------
        */

    expect(returnItemAfter.inspection.status).toBe("inspected");

    expect(returnItemAfter.inspection.resellableQuantity).toBe(1);

    expect(returnItemAfter.inspection.damagedQuantity).toBe(1);

    expect(returnItemAfter.inspection.rejectedQuantity).toBe(0);

    expect(String(returnItemAfter.inspection.inspectedBy)).toBe(
      String(admin._id),
    );

    expect(returnItemAfter.inspection.inspectedAt).toBeTruthy();

    expect(String(returnAfterInspection.updatedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Product Inventory Must Remain Unchanged
        |--------------------------------------------------------------------------
        */

    const productAfterInspection = await Product.findById(product._id).lean();

    const variantAfterInspection = findProductVariant(
      productAfterInspection,
      variant._id,
    );

    expect(variantAfterInspection.inventory.stock).toBe(stockBefore);

    expect(variantAfterInspection.inventory.reservedStock).toBe(
      reservedStockBefore,
    );

    /*
        |--------------------------------------------------------------------------
        | Inspection Must Not Create Inventory Ledger Entry
        |--------------------------------------------------------------------------
        */

    const ledgerAfterInspection = await ProductInventoryLedger.find({
      referenceId: createdOrder.orderNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfterInspection.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    /*
        |--------------------------------------------------------------------------
        | Return Quantity Version Must Remain Unchanged
        |--------------------------------------------------------------------------
        */

    const orderAfterInspection = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterInspection.returnRequestVersion).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Inspection Before Warehouse Receipt
    |--------------------------------------------------------------------------
    */

  it("rejects inspection before the Return Request is received", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createInTransitCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_INSPECTION_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("in-transit");
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Inspection Quantity — Too Low
    |--------------------------------------------------------------------------
    */

  it("rejects inspection when classified quantity is less than the returned quantity", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            /*
             * Total = 1
             * Returned = 2
             */
            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_INSPECTION_QUANTITY_INVALID",
    );

    expect(response.body.details).toMatchObject({
      returnedQuantity: 2,

      inspectedQuantity: 1,
    });

    const unchanged = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchanged.status).toBe("received");

    expect(unchanged.items[0].inspection.status).toBe("pending");
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Inspection Quantity — Too High
    |--------------------------------------------------------------------------
    */

  it("rejects inspection when classified quantity exceeds the returned quantity", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            /*
             * Total = 3
             * Returned = 2
             */
            resellableQuantity: 2,

            damagedQuantity: 1,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_INSPECTION_QUANTITY_INVALID",
    );

    expect(response.body.details).toMatchObject({
      returnedQuantity: 2,

      inspectedQuantity: 3,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Unknown Return Item
    |--------------------------------------------------------------------------
    */

  it("rejects inspection when the supplied Order item does not belong to the Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const unrelatedOrderItemId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: unrelatedOrderItemId,

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_INSPECTION_ITEM_NOT_FOUND",
    );

    expect(response.body.details.orderItemId).toBe(unrelatedOrderItemId);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Inspection
    |--------------------------------------------------------------------------
    */

  it("rejects inspecting the same Return Request twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    const inspectionData = {
      items: [
        {
          orderItemId: String(orderItem._id),

          resellableQuantity: 1,

          damagedQuantity: 0,

          rejectedQuantity: 0,

          note: "Item is suitable for resale.",
        },
      ],
    };

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send(inspectionData)
      .expect(200);

    const secondResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send(inspectionData);

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_ALREADY_INSPECTED",
    );

    expect(secondResponse.body.details.status).toBe("inspected");

    expect(secondResponse.body.details.inspectedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Inconsistent Receipt Evidence
    |--------------------------------------------------------------------------
    */

  it("rejects inspection when received status exists without complete receipt audit evidence", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    /*
     * Corrupt trusted receipt evidence without changing status.
     */
    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          "receipt.receivedBy": null,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,
          },
        ],
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_INSPECTION_STATE_INVALID",
    );

    const unchanged = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchanged.status).toBe("received");

    expect(unchanged.items[0].inspection.status).toBe("pending");
  });

  /*
    |--------------------------------------------------------------------------
    | Persistence Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back inspection state when Return Request persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    const returnRequestObjectId = new mongoose.Types.ObjectId(returnRequest.id);

    /*
     * Deliberately corrupt an enum-controlled field.
     */
    await OrderReturnRequest.collection.updateOne(
      {
        _id: returnRequestObjectId,
      },
      {
        $set: {
          requestedResolution: "invalid-resolution",
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(orderItem._id),

            resellableQuantity: 1,

            damagedQuantity: 0,

            rejectedQuantity: 0,

            note: "Rollback inspection test.",
          },
        ],
      });

    expect(response.status).toBe(400);

    const unchanged = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(unchanged.status).toBe("received");

    expect(unchanged.items[0].inspection.status).toBe("pending");

    expect(unchanged.items[0].inspection.resellableQuantity).toBe(0);

    expect(unchanged.items[0].inspection.damagedQuantity).toBe(0);

    expect(unchanged.items[0].inspection.rejectedQuantity).toBe(0);

    expect(unchanged.items[0].inspection.inspectedBy).toBeNull();

    expect(unchanged.items[0].inspection.inspectedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Inspection
    |--------------------------------------------------------------------------
    */

  it("allows only one inspection when two inspection requests happen concurrently", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { orderItem, returnRequest } =
      await createReceivedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,
      });

    const orderItemId = String(orderItem._id);

    const [firstResponse, secondResponse] = await Promise.all([
      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
        .send({
          items: [
            {
              orderItemId,

              resellableQuantity: 1,

              damagedQuantity: 0,

              rejectedQuantity: 0,

              note: "Concurrent inspection A.",
            },
          ],
        }),

      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
        .send({
          items: [
            {
              orderItemId,

              resellableQuantity: 0,

              damagedQuantity: 1,

              rejectedQuantity: 0,

              note: "Concurrent inspection B.",
            },
          ],
        }),
    ]);

    const responses = [firstResponse, secondResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_PROCESSING_CONFLICT",
      "ORDER_RETURN_ALREADY_INSPECTED",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
        |--------------------------------------------------------------------------
        | Database Must Contain Exactly One Final Inspection
        |--------------------------------------------------------------------------
        */

    const stored = await OrderReturnRequest.findById(returnRequest.id).lean();

    expect(stored.status).toBe("inspected");

    expect(stored.items[0].inspection.status).toBe("inspected");

    expect(stored.items[0].inspection.inspectedAt).toBeTruthy();

    const classifiedQuantity =
      stored.items[0].inspection.resellableQuantity +
      stored.items[0].inspection.damagedQuantity +
      stored.items[0].inspection.rejectedQuantity;

    expect(classifiedQuantity).toBe(1);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Completion
|--------------------------------------------------------------------------
*/

describe("Admin Return completion", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when Return completion is attempted without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/complete`)
      .send({});

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer attempts to complete a Return Request", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/complete`)
      .send({});

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid completion requests and backend-controlled fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
     * Invalid Return Request ID
     */

    const invalidIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-valid-object-id/complete")
      .send({});

    expect(invalidIdResponse.status).toBe(400);

    expect(invalidIdResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
     * Backend-controlled fields
     */

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const invalidBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/complete`)
      .send({
        status: "completed",

        completedBy: new mongoose.Types.ObjectId().toString(),

        completedAt: new Date().toISOString(),

        resellableQuantity: 100,
      });

    expect(invalidBodyResponse.status).toBe(400);

    expect(invalidBodyResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Missing Return Request
    |--------------------------------------------------------------------------
    */

  it("returns 404 when completing a missing Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/complete`)
      .send({});

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Successful Completion + Partial Resellable Restoration
    |--------------------------------------------------------------------------
    */

  it("completes an inspected Return Request and restores only resellable Product stock with a matching Inventory Ledger entry", async () => {
    const { agent: adminAgent, user: admin } =
      await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
        |--------------------------------------------------------------------------
        | Create Received Return
        |--------------------------------------------------------------------------
        */

    const fixture = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 3,

      returnQuantity: 3,
    });

    const {
      product,
      variant,
      createdOrder,
      orderItem,
      returnRequest,
      storedReceivedReturnRequest,
    } = fixture;

    /*
        |--------------------------------------------------------------------------
        | Inspect Return
        |--------------------------------------------------------------------------
        |
        | Returned = 3
        |
        | Resellable = 2
        | Damaged    = 1
        | Rejected   = 0
        |--------------------------------------------------------------------------
        */

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(
              storedReceivedReturnRequest.items[0].orderItemId,
            ),

            resellableQuantity: 2,

            damagedQuantity: 1,

            rejectedQuantity: 0,

            note: "Two units are sellable and one unit is damaged.",
          },
        ],
      })
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Verify Inspection Stored
        |--------------------------------------------------------------------------
        */

    const storedInspectedReturn = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedInspectedReturn.status).toBe("inspected");

    expect(storedInspectedReturn.items[0].inspection.resellableQuantity).toBe(
      2,
    );

    expect(storedInspectedReturn.items[0].inspection.damagedQuantity).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Product Snapshot Before Completion
        |--------------------------------------------------------------------------
        */

    const productBeforeCompletion = await Product.findById(product._id).lean();

    const variantBeforeCompletion = findProductVariant(
      productBeforeCompletion,
      variant._id,
    );

    const stockBefore = variantBeforeCompletion.inventory.stock;

    const reservedStockBefore = variantBeforeCompletion.inventory.reservedStock;

    /*
        |--------------------------------------------------------------------------
        | No Return-Restock Ledger Before Completion
        |--------------------------------------------------------------------------
        */

    const returnLedgerBeforeCompletion = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(returnLedgerBeforeCompletion).toHaveLength(0);

    /*
        |--------------------------------------------------------------------------
        | Complete Return
        |--------------------------------------------------------------------------
        */

    const completionResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({
        adminNote: "Warehouse Return processing completed.",
      });

    expect(completionResponse.status).toBe(200);

    expect(completionResponse.body.success).toBe(true);

    expect(completionResponse.body.message).toBe(
      "Return Request completed successfully",
    );

    const completedReturnRequest = completionResponse.body.data.returnRequest;

    expect(completedReturnRequest.status).toBe("completed");

    /*
        |--------------------------------------------------------------------------
        | Completion Audit
        |--------------------------------------------------------------------------
        */

    expect(completedReturnRequest.completion.completedBy).toBe(
      String(admin._id),
    );

    expect(completedReturnRequest.completion.completedAt).toBeTruthy();

    expect(completedReturnRequest.adminNote).toBe(
      "Warehouse Return processing completed.",
    );

    /*
        |--------------------------------------------------------------------------
        | Product Stock
        |--------------------------------------------------------------------------
        |
        | Only resellable quantity = 2 is restored.
        |--------------------------------------------------------------------------
        */

    const productAfterCompletion = await Product.findById(product._id).lean();

    const variantAfterCompletion = findProductVariant(
      productAfterCompletion,
      variant._id,
    );

    expect(variantAfterCompletion.inventory.stock).toBe(stockBefore + 2);

    expect(variantAfterCompletion.inventory.reservedStock).toBe(
      reservedStockBefore,
    );

    /*
        |--------------------------------------------------------------------------
        | Return Inventory Ledger
        |--------------------------------------------------------------------------
        */

    const returnLedgerEntries = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(returnLedgerEntries).toHaveLength(1);

    const returnLedger = returnLedgerEntries[0];

    expect(returnLedger.operation).toBe("adjust");

    expect(returnLedger.reason).toBe("customer-return");

    expect(returnLedger.quantity).toBe(2);

    expect(returnLedger.stockDelta).toBe(2);

    expect(returnLedger.reservedStockDelta).toBe(0);

    expect(String(returnLedger.product)).toBe(String(product._id));

    expect(String(returnLedger.variantId)).toBe(String(variant._id));

    expect(returnLedger.referenceId).toBe(returnRequest.returnRequestNumber);

    expect(String(returnLedger.actor)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Ledger Before State
        |--------------------------------------------------------------------------
        */

    expect(returnLedger.before).toMatchObject({
      stock: stockBefore,

      reservedStock: reservedStockBefore,

      availableStock: stockBefore - reservedStockBefore,
    });

    /*
        |--------------------------------------------------------------------------
        | Ledger After State
        |--------------------------------------------------------------------------
        */

    expect(returnLedger.after).toMatchObject({
      stock: stockBefore + 2,

      reservedStock: reservedStockBefore,

      availableStock: stockBefore + 2 - reservedStockBefore,
    });

    /*
        |--------------------------------------------------------------------------
        | Stored Return Request
        |--------------------------------------------------------------------------
        */

    const storedCompletedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedCompletedReturnRequest.status).toBe("completed");

    expect(String(storedCompletedReturnRequest.completion.completedBy)).toBe(
      String(admin._id),
    );

    expect(storedCompletedReturnRequest.completion.completedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Inspection Must Remain Preserved
        |--------------------------------------------------------------------------
        */

    expect(storedCompletedReturnRequest.items[0].inspection.status).toBe(
      "inspected",
    );

    expect(
      storedCompletedReturnRequest.items[0].inspection.resellableQuantity,
    ).toBe(2);

    expect(
      storedCompletedReturnRequest.items[0].inspection.damagedQuantity,
    ).toBe(1);

    expect(
      storedCompletedReturnRequest.items[0].inspection.rejectedQuantity,
    ).toBe(0);

    /*
        |--------------------------------------------------------------------------
        | Completed Return Quantity Remains Consumed
        |--------------------------------------------------------------------------
        */

    const secondReturnResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "Attempting to return an already completed quantity.",
          },
        ],
      });

    expect(secondReturnResponse.status).toBe(409);

    expect(secondReturnResponse.body.errorCode).toBe(
      "ORDER_RETURN_QUANTITY_EXCEEDED",
    );

    /*
        |--------------------------------------------------------------------------
        | Completion Does Not Change Return Request Version
        |--------------------------------------------------------------------------
        */

    const orderAfterCompletion = await Order.findById(createdOrder.id)
      .select("+returnRequestVersion")
      .lean();

    expect(orderAfterCompletion.returnRequestVersion).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Fully Damaged Return
    |--------------------------------------------------------------------------
    */

  it("completes a fully damaged Return Request without restoring Product stock or creating a restock ledger entry", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const fixture = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 2,
    });

    const { product, variant, returnRequest, storedReceivedReturnRequest } =
      fixture;

    /*
        |--------------------------------------------------------------------------
        | Inspect All as Damaged
        |--------------------------------------------------------------------------
        */

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(
              storedReceivedReturnRequest.items[0].orderItemId,
            ),

            resellableQuantity: 0,

            damagedQuantity: 2,

            rejectedQuantity: 0,

            note: "Both returned units are damaged.",
          },
        ],
      })
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Inventory Before Completion
        |--------------------------------------------------------------------------
        */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const stockBefore = variantBefore.inventory.stock;

    const reservedStockBefore = variantBefore.inventory.reservedStock;

    /*
        |--------------------------------------------------------------------------
        | Complete
        |--------------------------------------------------------------------------
        */

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.status).toBe("completed");

    /*
        |--------------------------------------------------------------------------
        | Inventory Must Remain Unchanged
        |--------------------------------------------------------------------------
        */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(stockBefore);

    expect(variantAfter.inventory.reservedStock).toBe(reservedStockBefore);

    /*
        |--------------------------------------------------------------------------
        | No Return-Restock Ledger
        |--------------------------------------------------------------------------
        */

    const returnLedger = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(returnLedger).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Rejected Returned Merchandise
    |--------------------------------------------------------------------------
    */

  it("does not restore rejected Return quantities to sellable Product stock", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const fixture = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 2,
    });

    const { product, variant, returnRequest, storedReceivedReturnRequest } =
      fixture;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/inspect`)
      .send({
        items: [
          {
            orderItemId: String(
              storedReceivedReturnRequest.items[0].orderItemId,
            ),

            resellableQuantity: 0,

            damagedQuantity: 0,

            rejectedQuantity: 2,

            note: "Returned merchandise failed warehouse acceptance.",
          },
        ],
      })
      .expect(200);

    const before = await Product.findById(product._id).lean();

    const beforeVariant = findProductVariant(before, variant._id);

    const stockBefore = beforeVariant.inventory.stock;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({})
      .expect(200);

    const after = await Product.findById(product._id).lean();

    const afterVariant = findProductVariant(after, variant._id);

    expect(afterVariant.inventory.stock).toBe(stockBefore);

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(ledgerEntries).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Completion Before Inspection
    |--------------------------------------------------------------------------
    */

  it("rejects completing a Return Request before warehouse inspection", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_COMPLETION_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("received");

    const stored = await OrderReturnRequest.findById(returnRequest.id).lean();

    expect(stored.status).toBe("received");

    expect(stored.completion.completedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Stored Inspection
    |--------------------------------------------------------------------------
    */

  it("rejects completion when inspected status exists with invalid inspection quantities", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createInspectedCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 2,
      },
    );

    /*
     * Corrupt inspection directly in MongoDB.
     *
     * Returned = 2
     * Classified = 1
     */

    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          "items.0.inspection.resellableQuantity": 1,

          "items.0.inspection.damagedQuantity": 0,

          "items.0.inspection.rejectedQuantity": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_COMPLETION_INSPECTION_INVALID",
    );

    const stored = await OrderReturnRequest.findById(returnRequest.id).lean();

    expect(stored.status).toBe("inspected");
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Completion
    |--------------------------------------------------------------------------
    */

  it("rejects duplicate completion and does not restore the same Product stock twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, returnRequest } =
      await createInspectedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,
      });

    const before = await Product.findById(product._id).lean();

    const beforeVariant = findProductVariant(before, variant._id);

    const stockBefore = beforeVariant.inventory.stock;

    /*
        |--------------------------------------------------------------------------
        | First Completion
        |--------------------------------------------------------------------------
        */

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({})
      .expect(200);

    const afterFirstCompletion = await Product.findById(product._id).lean();

    const variantAfterFirstCompletion = findProductVariant(
      afterFirstCompletion,
      variant._id,
    );

    expect(variantAfterFirstCompletion.inventory.stock).toBe(stockBefore + 1);

    /*
        |--------------------------------------------------------------------------
        | Second Completion
        |--------------------------------------------------------------------------
        */

    const secondResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_ALREADY_COMPLETED",
    );

    /*
        |--------------------------------------------------------------------------
        | Product Must Not Be Restocked Twice
        |--------------------------------------------------------------------------
        */

    const afterSecondCompletion = await Product.findById(product._id).lean();

    const variantAfterSecondCompletion = findProductVariant(
      afterSecondCompletion,
      variant._id,
    );

    expect(variantAfterSecondCompletion.inventory.stock).toBe(stockBefore + 1);

    /*
        |--------------------------------------------------------------------------
        | Exactly One Return Ledger
        |--------------------------------------------------------------------------
        */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(ledgerEntries).toHaveLength(1);

    expect(ledgerEntries[0].quantity).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back Product stock and Inventory Ledger when Return completion persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, returnRequest } =
      await createInspectedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,
      });

    /*
        |--------------------------------------------------------------------------
        | Product Before Completion
        |--------------------------------------------------------------------------
        */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const stockBefore = variantBefore.inventory.stock;

    const reservedStockBefore = variantBefore.inventory.reservedStock;

    /*
        |--------------------------------------------------------------------------
        | Corrupt Return Request
        |--------------------------------------------------------------------------
        |
        | Native collection access bypasses Mongoose validation.
        |
        | Inventory restoration runs first, but the final Return save
        | must fail validation.
        |--------------------------------------------------------------------------
        */

    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          requestedResolution: "invalid-resolution",
        },
      },
    );

    /*
        |--------------------------------------------------------------------------
        | Attempt Completion
        |--------------------------------------------------------------------------
        */

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(response.status).toBe(400);

    /*
        |--------------------------------------------------------------------------
        | Product Must Roll Back
        |--------------------------------------------------------------------------
        */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(stockBefore);

    expect(variantAfter.inventory.reservedStock).toBe(reservedStockBefore);

    /*
        |--------------------------------------------------------------------------
        | Ledger Must Roll Back
        |--------------------------------------------------------------------------
        */

    const returnLedgerEntries = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(returnLedgerEntries).toHaveLength(0);

    /*
        |--------------------------------------------------------------------------
        | Return Completion Must Roll Back
        |--------------------------------------------------------------------------
        */

    const storedReturnRequest = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturnRequest.status).toBe("inspected");

    expect(storedReturnRequest.completion.completedBy).toBeNull();

    expect(storedReturnRequest.completion.completedAt).toBeNull();

    /*
     * Existing warehouse inspection remains.
     */

    expect(storedReturnRequest.items[0].inspection.status).toBe("inspected");
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Completion
    |--------------------------------------------------------------------------
    */

  it("restores Product stock exactly once when two Return completion requests happen concurrently", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, returnRequest } =
      await createInspectedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,
      });

    /*
        |--------------------------------------------------------------------------
        | Product Before
        |--------------------------------------------------------------------------
        */

    const before = await Product.findById(product._id).lean();

    const beforeVariant = findProductVariant(before, variant._id);

    const stockBefore = beforeVariant.inventory.stock;

    /*
        |--------------------------------------------------------------------------
        | Concurrent Completion Calls
        |--------------------------------------------------------------------------
        */

    const [firstResponse, secondResponse] = await Promise.all([
      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
        .send({
          adminNote: "Concurrent completion A",
        }),

      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
        .send({
          adminNote: "Concurrent completion B",
        }),
    ]);

    const responses = [firstResponse, secondResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_PROCESSING_CONFLICT",
      "ORDER_RETURN_ALREADY_COMPLETED",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
        |--------------------------------------------------------------------------
        | Product Must Be Restored Exactly Once
        |--------------------------------------------------------------------------
        */

    const after = await Product.findById(product._id).lean();

    const afterVariant = findProductVariant(after, variant._id);

    expect(afterVariant.inventory.stock).toBe(stockBefore + 1);

    /*
        |--------------------------------------------------------------------------
        | Exactly One Return Ledger
        |--------------------------------------------------------------------------
        */

    const returnLedgers = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(returnLedgers).toHaveLength(1);

    expect(returnLedgers[0].stockDelta).toBe(1);

    /*
        |--------------------------------------------------------------------------
        | Return Must Be Completed
        |--------------------------------------------------------------------------
        */

    const stored = await OrderReturnRequest.findById(returnRequest.id).lean();

    expect(stored.status).toBe("completed");

    expect(stored.completion.completedAt).toBeTruthy();
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Trusted Product Variant
    |--------------------------------------------------------------------------
    */

  it("does not complete the Return when its trusted Product variant can no longer be restored", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { product, variant, returnRequest } =
      await createInspectedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,
      });

    const before = await Product.findById(product._id).lean();

    const beforeVariant = findProductVariant(before, variant._id);

    const stockBefore = beforeVariant.inventory.stock;

    /*
        |--------------------------------------------------------------------------
        | Corrupt Trusted Variant Reference
        |--------------------------------------------------------------------------
        */

    const unavailableVariantId = new mongoose.Types.ObjectId();

    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          "items.0.variantId": unavailableVariantId,
        },
      },
    );

    /*
        |--------------------------------------------------------------------------
        | Attempt Completion
        |--------------------------------------------------------------------------
        */

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({});

    expect(response.status).toBe(409);

    expect([
      "ORDER_RETURN_RESTOCK_INVENTORY_STATE_INVALID",
      "ORDER_RETURN_RESTOCK_INVENTORY_CONFLICT",
    ]).toContain(response.body.errorCode);

    /*
        |--------------------------------------------------------------------------
        | Product Must Stay Unchanged
        |--------------------------------------------------------------------------
        */

    const after = await Product.findById(product._id).lean();

    const afterVariant = findProductVariant(after, variant._id);

    expect(afterVariant.inventory.stock).toBe(stockBefore);

    /*
        |--------------------------------------------------------------------------
        | Return Must Remain Inspected
        |--------------------------------------------------------------------------
        */

    const stored = await OrderReturnRequest.findById(returnRequest.id).lean();

    expect(stored.status).toBe("inspected");

    /*
        |--------------------------------------------------------------------------
        | No Restock Ledger
        |--------------------------------------------------------------------------
        */

    const ledgers = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(ledgers).toHaveLength(0);
  });
});
