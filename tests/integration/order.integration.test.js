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

import OrderReturnReplacement from "../../src/modules/orders/order-return-replacement.model.js";

import OrderReturnRefundAudit from "../../src/modules/orders/order-return-refund-audit.model.js";

import PaymentTransaction from "../../src/modules/payments/payment.model.js";

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
| Create Customer Online Payment Order
|--------------------------------------------------------------------------
|
| Creates a real Order through the customer Order API.
|
| The Order starts as:
|
| status          = pending
| payment.method  = online
| payment.status  = pending
| inventoryStatus = reserved
|--------------------------------------------------------------------------
*/

const createOnlinePaymentOrderFixture = async ({
  customerAgent,
  product,
  variant = product.variants[0],
  quantity = 2,
  customerNote = "Online Payment integration test",
}) => {
  const requestBody = createOrderRequestBody({
    productId: product._id,

    variantId: variant._id,

    quantity,
  });

  requestBody.paymentMethod = "online";

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
| Create Completed Customer Return Request Fixture
|--------------------------------------------------------------------------
*/

const createCompletedCustomerReturnRequestFixture = async ({
  adminAgent,
  customerAgent,

  completionData = {
    adminNote: "Return processing completed for refund testing.",
  },

  ...returnFixtureOptions
}) => {
  const fixture = await createInspectedCustomerReturnRequestFixture({
    adminAgent,
    customerAgent,

    ...returnFixtureOptions,
  });

  const completionResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${fixture.returnRequest.id}/complete`)
    .send(completionData)
    .expect(200);

  const completedReturnRequest = completionResponse.body.data.returnRequest;

  const storedCompletedReturnRequest = await OrderReturnRequest.findById(
    fixture.returnRequest.id,
  ).lean();

  return {
    ...fixture,

    completionData,

    completedReturnRequest,

    storedCompletedReturnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create and Complete Return for Existing Order
|--------------------------------------------------------------------------
|
| This helper does NOT create another Order.
|
| It creates a new Return Request against an existing delivered Order and
| moves it through:
|
| requested
|   ↓
| approved
|   ↓
| in-transit
|   ↓
| received
|   ↓
| inspected
|   ↓
| completed
|--------------------------------------------------------------------------
*/

const createCompletedReturnForExistingOrder = async ({
  adminAgent,
  customerAgent,

  orderId,
  orderItemId,

  quantity = 1,

  requestedResolution = "refund",

  resellableQuantity = quantity,
  damagedQuantity = 0,
  rejectedQuantity = 0,
}) => {
  /*
    |--------------------------------------------------------------------------
    | Create Return Request
    |--------------------------------------------------------------------------
    */

  const createResponse = await customerAgent
    .post(`/api/v1/orders/${orderId}/returns`)
    .send({
      requestedResolution,

      items: [
        {
          orderItemId: String(orderItemId),

          quantity,

          reason: "defective",

          details: "Additional Return Request for cumulative refund testing.",
        },
      ],

      customerNote: "Please process this additional Return Request.",
    })
    .expect(201);

  const createdReturnRequest = createResponse.body.data.returnRequest;

  /*
    |--------------------------------------------------------------------------
    | Approve
    |--------------------------------------------------------------------------
    */

  await adminAgent
    .post(`/api/v1/admin/order-returns/${createdReturnRequest.id}/approve`)
    .send({
      adminNote: "Additional Return Request approved.",
    })
    .expect(200);

  /*
    |--------------------------------------------------------------------------
    | Mark In Transit
    |--------------------------------------------------------------------------
    */

  const trackingSuffix = new mongoose.Types.ObjectId()
    .toString()
    .slice(-10)
    .toUpperCase();

  await adminAgent
    .post(
      `/api/v1/admin/order-returns/${createdReturnRequest.id}/mark-in-transit`,
    )
    .send({
      carrier: "Blue Dart",

      trackingNumber: `RET-${trackingSuffix}`,

      note: "Additional Return shipment is in transit.",
    })
    .expect(200);

  /*
    |--------------------------------------------------------------------------
    | Receive
    |--------------------------------------------------------------------------
    */

  await adminAgent
    .post(`/api/v1/admin/order-returns/${createdReturnRequest.id}/receive`)
    .send({
      note: "Additional Return parcel received at warehouse.",
    })
    .expect(200);

  /*
    |--------------------------------------------------------------------------
    | Inspect
    |--------------------------------------------------------------------------
    */

  await adminAgent
    .post(`/api/v1/admin/order-returns/${createdReturnRequest.id}/inspect`)
    .send({
      items: [
        {
          orderItemId: String(orderItemId),

          resellableQuantity,

          damagedQuantity,

          rejectedQuantity,

          note: "Additional Return item inspected.",
        },
      ],
    })
    .expect(200);

  /*
    |--------------------------------------------------------------------------
    | Complete
    |--------------------------------------------------------------------------
    */

  const completionResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${createdReturnRequest.id}/complete`)
    .send({
      adminNote: "Additional Return processing completed.",
    })
    .expect(200);

  return {
    createdReturnRequest,

    completedReturnRequest: completionResponse.body.data.returnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Mark Return Refunded For Metrics
|--------------------------------------------------------------------------
|
| Refund business behavior is already covered by the refund integration tests.
|
| Metrics tests only need persisted refund data to verify aggregation.
|--------------------------------------------------------------------------
*/

const markReturnRefundedForMetrics = async ({
  returnRequestId,
  adminId,

  refundedQuantity,
  amount,

  currency = "INR",
}) => {
  const refundedAt = new Date();

  await OrderReturnRequest.collection.updateOne(
    {
      _id: new mongoose.Types.ObjectId(String(returnRequestId)),
    },

    {
      $set: {
        "refund.refundedQuantity": refundedQuantity,

        "refund.amount": amount,

        "refund.currency": currency,

        "refund.referenceId": `RFND-METRICS-${new mongoose.Types.ObjectId()
          .toString()
          .slice(-12)
          .toUpperCase()}`,

        "refund.note": "Metrics fixture refund",

        "refund.refundedBy": adminId,

        "refund.refundedAt": refundedAt,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Set Metrics Fixture CreatedAt
|--------------------------------------------------------------------------
|
| Mongoose timestamps normally control createdAt.
|
| Date-range tests need exact UTC timestamps, so we update only createdAt
| directly through the native collection.
|--------------------------------------------------------------------------
*/

const setMetricsFixtureCreatedAt = async ({ model, documentId, createdAt }) => {
  const resolvedCreatedAt =
    createdAt instanceof Date ? createdAt : new Date(createdAt);

  await model.collection.updateOne(
    {
      _id: new mongoose.Types.ObjectId(String(documentId)),
    },
    {
      $set: {
        createdAt: resolvedCreatedAt,
      },
    },
  );
};

/*
|--------------------------------------------------------------------------
| Completed Replacement Return Fixture
|--------------------------------------------------------------------------
|
| This fixture intentionally creates the already-completed Return state
| directly.
|
| Earlier integration tests already verify the complete Return lifecycle.
| These tests isolate the replacement-creation workflow.
|--------------------------------------------------------------------------
*/

const createCompletedReplacementReturnFixture = async ({
  customerId,
  adminId,

  items,

  requestedResolution = "replacement",

  status = "completed",
}) => {
  if (!customerId) {
    throw new Error("Replacement Return fixture requires a customer ID");
  }

  if (!adminId) {
    throw new Error("Replacement Return fixture requires an admin ID");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Replacement Return fixture requires at least one item");
  }

  fixtureSequence += 1;

  const now = new Date();

  const returnItems = items.map(
    ({
      product,
      variant,

      quantity = 2,

      resellableQuantity = 1,

      damagedQuantity = 1,

      rejectedQuantity = 0,

      reason = "defective",
    }) => {
      return {
        orderItemId: new mongoose.Types.ObjectId(),

        product: product._id,

        variantId: variant._id,

        sku: variant.sku,

        productName: product.name,

        size: variant.size ?? null,

        color: {
          name: variant.color?.name ?? null,

          code: variant.color?.code ?? null,
        },

        quantity,

        reason,

        details: null,

        inspection: {
          status: "inspected",

          resellableQuantity,

          damagedQuantity,

          rejectedQuantity,

          note: "Replacement integration-test inspection",

          inspectedBy: adminId,

          inspectedAt: now,
        },
      };
    },
  );

  return OrderReturnRequest.create({
    returnRequestNumber: `RET-20260810-RPL${String(fixtureSequence).padStart(
      6,
      "0",
    )}`,

    order: new mongoose.Types.ObjectId(),

    orderNumber: `ORD-RPL-${fixtureSequence}`,

    customer: customerId,

    items: returnItems,

    requestedResolution,

    status,

    customerNote: "Replacement requested",

    adminNote: null,

    approval: {
      approvedBy: adminId,

      approvedAt: now,
    },

    shipment: {
      carrier: "Blue Dart",

      trackingNumber: `RET-RPL-${fixtureSequence}`,

      trackingUrl: null,

      note: null,

      markedInTransitBy: adminId,

      markedInTransitAt: now,
    },

    receipt: {
      note: "Received for replacement testing",

      receivedBy: adminId,

      receivedAt: now,
    },

    completion: {
      completedBy: adminId,

      completedAt: now,
    },

    createdBy: customerId,

    updatedBy: adminId,
  });
};

/*
|--------------------------------------------------------------------------
| Create Completed Return Awaiting Replacement
|--------------------------------------------------------------------------
|
| Creates a completed Return with all trusted Product/variant snapshots,
| but DOES NOT create the replacement yet.
|--------------------------------------------------------------------------
*/

const createCompletedReturnAwaitingReplacementFixture = async ({
  customerId,
  adminId,

  requestedResolution = "replacement",
}) => {
  const category = await createActiveCategoryFixture();

  const product = await createActiveProductFixture({
    category: category._id,
  });

  const variant = product.variants[0];

  const returnRequest = await createCompletedReplacementReturnFixture({
    customerId,

    adminId,

    requestedResolution,

    items: [
      {
        product,

        variant,

        quantity: 2,

        resellableQuantity: 1,

        damagedQuantity: 1,

        rejectedQuantity: 0,
      },
    ],
  });

  return {
    category,
    product,
    variant,
    returnRequest,
  };
};

/*
|--------------------------------------------------------------------------
| Create Reserved Replacement Fixture
|--------------------------------------------------------------------------
|
| Creates:
|
| completed replacement-resolution Return
|              ↓
| replacement creation API
|              ↓
| reserved replacement
|--------------------------------------------------------------------------
*/

const createReservedReplacementFixture = async ({
  adminAgent,
  adminId,
  customerId,

  productOverrides = {},

  quantity = 2,
  resellableQuantity = 1,
  damagedQuantity = 1,
  rejectedQuantity = 0,
}) => {
  if (!adminAgent) {
    throw new Error("Reserved Replacement fixture requires an admin agent");
  }

  if (!adminId) {
    throw new Error("Reserved Replacement fixture requires an admin ID");
  }

  if (!customerId) {
    throw new Error("Reserved Replacement fixture requires a customer ID");
  }

  const category = await createActiveCategoryFixture();

  const product = await createActiveProductFixture({
    category: category._id,

    ...productOverrides,
  });

  const variant = product.variants[0];

  const returnRequest = await createCompletedReplacementReturnFixture({
    customerId,

    adminId,

    items: [
      {
        product,

        variant,

        quantity,

        resellableQuantity,

        damagedQuantity,

        rejectedQuantity,
      },
    ],
  });

  const creationResponse = await adminAgent
    .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
    .send({})
    .expect(201);

  const replacement = creationResponse.body.data.replacement;

  const storedReplacement = await OrderReturnReplacement.findById(
    replacement.id,
  ).lean();

  return {
    category,
    product,
    variant,

    returnRequest,

    replacement,
    storedReplacement,
  };
};

/*
|--------------------------------------------------------------------------
| Create Processing Replacement Fixture
|--------------------------------------------------------------------------
|
| Creates:
|
| completed Return
|      ↓
| replacement created
|      ↓
| reserved
|      ↓
| processing
|--------------------------------------------------------------------------
*/

const createProcessingReplacementFixture = async ({
  adminAgent,
  adminId,
  customerId,

  productOverrides = {},

  quantity = 2,
  resellableQuantity = 1,
  damagedQuantity = 1,
  rejectedQuantity = 0,
}) => {
  const fixture = await createReservedReplacementFixture({
    adminAgent,
    adminId,
    customerId,

    productOverrides,

    quantity,
    resellableQuantity,
    damagedQuantity,
    rejectedQuantity,
  });

  const processingResponse = await adminAgent
    .post(
      `/api/v1/admin/order-return-replacements/${fixture.replacement.id}/process`,
    )
    .send({
      note: "Replacement prepared for shipment integration testing.",
    })
    .expect(200);

  const processingReplacement = processingResponse.body.data.replacement;

  const storedProcessingReplacement = await OrderReturnReplacement.findById(
    fixture.replacement.id,
  ).lean();

  return {
    ...fixture,

    processingReplacement,
    storedProcessingReplacement,
  };
};

/*
|--------------------------------------------------------------------------
| Create Shipped Replacement Fixture
|--------------------------------------------------------------------------
|
| Creates:
|
| completed Return
|      ↓
| reserved replacement
|      ↓
| processing
|      ↓
| shipped
|--------------------------------------------------------------------------
*/

const createShippedReplacementFixture = async ({
  adminAgent,
  adminId,
  customerId,

  productOverrides = {},

  quantity = 2,
  resellableQuantity = 1,
  damagedQuantity = 1,
  rejectedQuantity = 0,

  shipmentData = {},
}) => {
  const fixture = await createProcessingReplacementFixture({
    adminAgent,
    adminId,
    customerId,

    productOverrides,

    quantity,
    resellableQuantity,
    damagedQuantity,
    rejectedQuantity,
  });

  const resolvedShipmentData = {
    carrier: shipmentData.carrier ?? "Blue Dart",

    trackingNumber:
      shipmentData.trackingNumber ??
      `RPL-${new mongoose.Types.ObjectId()
        .toString()
        .slice(-12)
        .toUpperCase()}`,

    trackingUrl:
      shipmentData.trackingUrl ?? "https://tracking.example.com/replacement",

    note: shipmentData.note ?? "Replacement shipped for delivery testing.",
  };

  const shipmentResponse = await adminAgent
    .post(
      `/api/v1/admin/order-return-replacements/${fixture.replacement.id}/ship`,
    )
    .send(resolvedShipmentData)
    .expect(200);

  const shippedReplacement = shipmentResponse.body.data.replacement;

  const storedShippedReplacement = await OrderReturnReplacement.findById(
    fixture.replacement.id,
  ).lean();

  return {
    ...fixture,

    shipmentData: resolvedShipmentData,

    shippedReplacement,

    storedShippedReplacement,
  };
};

/*
|--------------------------------------------------------------------------
| Create Admin Replacement Read Fixture
|--------------------------------------------------------------------------
|
| Admin replacement list/details endpoints are read-only.
|
| Creating the replacement directly keeps these tests fast and isolates:
|
| - pagination
| - filtering
| - searching
| - sorting
| - response mapping
|--------------------------------------------------------------------------
*/

const createAdminOrderReturnReplacementReadFixture = async ({
  customerId,

  adminId = customerId,

  replacementNumber,

  returnRequestId = new mongoose.Types.ObjectId(),

  returnRequestNumber,

  orderId = new mongoose.Types.ObjectId(),

  orderNumber,

  status = "reserved",

  replacementQuantities = [2],

  productName,

  sku,

  reservation,

  processing,

  shipment,

  cancellation,

  failure,
} = {}) => {
  if (!customerId) {
    throw new Error("Replacement read fixture requires a customer ID");
  }

  if (!adminId) {
    throw new Error("Replacement read fixture requires an admin ID");
  }

  fixtureSequence += 1;

  const suffix = String(fixtureSequence).padStart(6, "0");

  const now = new Date();

  const resolvedReplacementNumber =
    replacementNumber ?? `RPL-20260810-READ${suffix}`;

  const resolvedReturnRequestNumber =
    returnRequestNumber ?? `RET-20260810-READ${suffix}`;

  const resolvedOrderNumber = orderNumber ?? `ORD-READ-${suffix}`;

  const items = replacementQuantities.map((replacementQuantity, index) => {
    return {
      returnItemId: new mongoose.Types.ObjectId(),

      orderItemId: new mongoose.Types.ObjectId(),

      product: new mongoose.Types.ObjectId(),

      variantId: new mongoose.Types.ObjectId(),

      productName:
        productName ?? `Replacement Read Product ${suffix}-${index + 1}`,

      sku: sku ?? `RPL-READ-${suffix}-${index + 1}`,

      size: "M",

      color: {
        name: "Black",

        code: "#000000",
      },

      returnedQuantity: replacementQuantity,

      replacementQuantity,
    };
  });

  const defaultReservation = {
    reservedBy: adminId,

    reservedAt: now,
  };

  const defaultProcessing = [
    "processing",
    "shipped",
    "delivered",
    "failed",
  ].includes(status)
    ? {
        note: "Replacement processing started.",

        processedBy: adminId,

        processedAt: now,
      }
    : undefined;

  const defaultShipment = ["shipped", "delivered"].includes(status)
    ? {
        carrier: "Blue Dart",

        trackingNumber: `RPL-TRACK-${suffix}`,

        trackingUrl: `https://tracking.example.com/${suffix}`,

        note: "Replacement dispatched.",

        shippedBy: adminId,

        shippedAt: now,

        deliveredBy: status === "delivered" ? adminId : null,

        deliveredAt: status === "delivered" ? now : null,
      }
    : undefined;

  const defaultCancellation =
    status === "cancelled"
      ? {
          reason: "Replacement cancelled for read testing.",

          note: "Cancellation test fixture.",

          cancelledBy: adminId,

          cancelledAt: now,
        }
      : undefined;

  const defaultFailure =
    status === "failed"
      ? {
          reason: "Replacement fulfillment failed.",

          note: "Failure test fixture.",

          failedBy: adminId,

          failedAt: now,
        }
      : undefined;

  return OrderReturnReplacement.create({
    replacementNumber: resolvedReplacementNumber,

    returnRequest: returnRequestId,

    returnRequestNumber: resolvedReturnRequestNumber,

    order: orderId,

    orderNumber: resolvedOrderNumber,

    customer: customerId,

    status,

    items,

    reservation: reservation ?? defaultReservation,

    ...(processing !== undefined || defaultProcessing
      ? {
          processing: processing ?? defaultProcessing,
        }
      : {}),

    ...(shipment !== undefined || defaultShipment
      ? {
          shipment: shipment ?? defaultShipment,
        }
      : {}),

    ...(cancellation !== undefined || defaultCancellation
      ? {
          cancellation: cancellation ?? defaultCancellation,
        }
      : {}),

    ...(failure !== undefined || defaultFailure
      ? {
          failure: failure ?? defaultFailure,
        }
      : {}),
  });
};

/*
|--------------------------------------------------------------------------
| Get Replacement Inventory Ledger
|--------------------------------------------------------------------------
*/

const getReplacementInventoryLedger = async (replacementNumber) => {
  return ProductInventoryLedger.find({
    referenceId: replacementNumber,
  })
    .sort({
      createdAt: 1,

      _id: 1,
    })
    .lean();
};

/*
|--------------------------------------------------------------------------
| Sum Replacement Quantity
|--------------------------------------------------------------------------
*/

const getTotalReplacementQuantity = (replacement) => {
  return (replacement.items ?? []).reduce((total, item) => {
    return total + Number(item.replacementQuantity ?? 0);
  }, 0);
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

    OrderReturnRequest.deleteMany({}),

    OrderReturnReplacement.deleteMany({}),

    PaymentTransaction.deleteMany({}),

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

/*
|--------------------------------------------------------------------------
| Admin Return Refund
|--------------------------------------------------------------------------
*/

describe("Admin Return refund", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when Return refund is attempted without authentication", async () => {
    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/refund`)
      .send({
        referenceId: "RFND-UNAUTH-001",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Authorization
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer attempts to refund a Return Request", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/refund`)
      .send({
        referenceId: "RFND-CUSTOMER-001",
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

  it("rejects invalid refund requests and backend-controlled financial fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
     * Invalid Return Request ID
     */

    const invalidIdResponse = await adminAgent
      .post("/api/v1/admin/order-returns/not-valid-id/refund")
      .send({
        referenceId: "RFND-INVALID-001",
      });

    expect(invalidIdResponse.status).toBe(400);

    expect(invalidIdResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
     * Backend-controlled fields
     */

    const returnRequestId = new mongoose.Types.ObjectId().toString();

    const invalidBodyResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/refund`)
      .send({
        referenceId: "RFND-INVALID-002",

        amount: 999999,

        refundedQuantity: 100,

        currency: "USD",

        refundedBy: new mongoose.Types.ObjectId().toString(),

        refundedAt: new Date().toISOString(),
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

  it("returns 404 when refunding a missing Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const missingReturnRequestId = new mongoose.Types.ObjectId().toString();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${missingReturnRequestId}/refund`)
      .send({
        referenceId: "RFND-MISSING-001",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");
  });

  /*
    |--------------------------------------------------------------------------
    | Partial Refund
    |--------------------------------------------------------------------------
    */

  it("refunds a completed partial Return using trusted Order pricing and marks the Order payment partially-refunded", async () => {
    const { agent: adminAgent, user: admin } =
      await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
        |--------------------------------------------------------------------------
        | Purchase 2, Return only 1
        |--------------------------------------------------------------------------
        |
        | This gives us a partial financial refund.
        |--------------------------------------------------------------------------
        */

    const { product, variant, createdOrder, orderItem, returnRequest } =
      await createCompletedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 1,

        requestedResolution: "refund",
      });

    /*
        |--------------------------------------------------------------------------
        | Read Trusted Order Pricing
        |--------------------------------------------------------------------------
        */

    const orderBeforeRefund = await Order.findById(createdOrder.id).lean();

    const trustedOrderItem = orderBeforeRefund.items.find(
      (item) => String(item._id) === String(orderItem._id),
    );

    expect(trustedOrderItem).toBeTruthy();

    const expectedUnitRefundAmount = Number(
      trustedOrderItem.pricing.unitFinalPrice,
    );

    const expectedRefundAmount = expectedUnitRefundAmount;

    const orderGrandTotal = Number(orderBeforeRefund.totals.grandTotal);

    expect(expectedRefundAmount).toBeLessThan(orderGrandTotal);

    /*
        |--------------------------------------------------------------------------
        | Product Snapshot Before Financial Refund
        |--------------------------------------------------------------------------
        */

    const productBeforeRefund = await Product.findById(product._id).lean();

    const variantBeforeRefund = findProductVariant(
      productBeforeRefund,
      variant._id,
    );

    const stockBeforeRefund = variantBeforeRefund.inventory.stock;

    const reservedStockBeforeRefund =
      variantBeforeRefund.inventory.reservedStock;

    /*
        |--------------------------------------------------------------------------
        | Inventory Ledger Snapshot
        |--------------------------------------------------------------------------
        |
        | Completion may already have created customer-return adjustment.
        |--------------------------------------------------------------------------
        */

    const inventoryLedgersBefore = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    /*
        |--------------------------------------------------------------------------
        | Refund
        |--------------------------------------------------------------------------
        */

    const referenceId = `RFND-PARTIAL-${new mongoose.Types.ObjectId().toString()}`;

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId,

        note: "Partial customer Return refund processed.",

        adminNote: "Financial Return refund completed.",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe("Return Request refunded successfully");

    const refundedReturnRequest = response.body.data.returnRequest;

    /*
        |--------------------------------------------------------------------------
        | Return Physical Status Must Stay Completed
        |--------------------------------------------------------------------------
        */

    expect(refundedReturnRequest.status).toBe("completed");

    /*
        |--------------------------------------------------------------------------
        | Trusted Refund Values
        |--------------------------------------------------------------------------
        */

    expect(refundedReturnRequest.refund.refundedQuantity).toBe(1);

    expect(refundedReturnRequest.refund.amount).toBe(expectedRefundAmount);

    expect(refundedReturnRequest.refund.currency).toBe(
      orderBeforeRefund.totals.currency,
    );

    expect(refundedReturnRequest.refund.referenceId).toBe(referenceId);

    expect(refundedReturnRequest.refund.refundedBy).toBe(String(admin._id));

    expect(refundedReturnRequest.refund.refundedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Order Payment Must Become Partially Refunded
        |--------------------------------------------------------------------------
        */

    const orderAfterRefund = await Order.findById(createdOrder.id).lean();

    expect(orderAfterRefund.payment.status).toBe("partially-refunded");

    expect(orderAfterRefund.payment.refundedAt).toBeNull();

    /*
     * Whole Order is not fully refunded yet.
     */

    expect(orderAfterRefund.status).not.toBe("refunded");

    /*
        |--------------------------------------------------------------------------
        | Immutable Return Refund Audit
        |--------------------------------------------------------------------------
        */

    const audits = await OrderReturnRefundAudit.find({
      returnRequest: returnRequest.id,
    }).lean();

    expect(audits).toHaveLength(1);

    const audit = audits[0];

    expect(audit.returnRequestNumber).toBe(returnRequest.returnRequestNumber);

    expect(audit.orderNumber).toBe(createdOrder.orderNumber);

    expect(audit.refundedQuantity).toBe(1);

    expect(audit.amount).toBe(expectedRefundAmount);

    expect(audit.referenceId).toBe(referenceId);

    expect(audit.previousPaymentStatus).toBe("paid");

    expect(audit.paymentStatus).toBe("partially-refunded");

    expect(audit.previousCumulativeRefundAmount).toBe(0);

    expect(audit.cumulativeRefundAmount).toBe(expectedRefundAmount);

    expect(String(audit.refundedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Refund Must Not Touch Inventory
        |--------------------------------------------------------------------------
        */

    const productAfterRefund = await Product.findById(product._id).lean();

    const variantAfterRefund = findProductVariant(
      productAfterRefund,
      variant._id,
    );

    expect(variantAfterRefund.inventory.stock).toBe(stockBeforeRefund);

    expect(variantAfterRefund.inventory.reservedStock).toBe(
      reservedStockBeforeRefund,
    );

    const inventoryLedgersAfter = await ProductInventoryLedger.find({
      referenceId: returnRequest.returnRequestNumber,
    }).lean();

    expect(inventoryLedgersAfter).toHaveLength(inventoryLedgersBefore.length);
  });

  /*
    |--------------------------------------------------------------------------
    | Full Refund
    |--------------------------------------------------------------------------
    */

  it("fully refunds the Order when the cumulative Return refund reaches the Order grand total", async () => {
    const { agent: adminAgent, user: admin } =
      await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
     * Single purchased unit.
     *
     * Returning/refunding it should fully refund the Order.
     */

    const { createdOrder, returnRequest } =
      await createCompletedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,

        requestedResolution: "refund",
      });

    const orderBefore = await Order.findById(createdOrder.id).lean();

    const orderGrandTotal = Number(orderBefore.totals.grandTotal);

    const referenceId = `RFND-FULL-${new mongoose.Types.ObjectId().toString()}`;

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId,

        note: "Full Return refund processed successfully.",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.refund.amount).toBe(
      orderGrandTotal,
    );

    /*
        |--------------------------------------------------------------------------
        | Verify Fully Refunded Order State
        |--------------------------------------------------------------------------
        */

    const orderAfter = await Order.findById(createdOrder.id).lean();

    expect(orderAfter.status).toBe("refunded");

    expect(orderAfter.payment.status).toBe("refunded");

    expect(orderAfter.payment.refundedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Existing Order-Level Refund Snapshot Required by Model
        |--------------------------------------------------------------------------
        */

    expect(orderAfter.refund.amount).toBe(orderGrandTotal);

    expect(orderAfter.refund.referenceId).toBe(referenceId);

    expect(orderAfter.refund.currency).toBe(orderBefore.totals.currency);

    expect(String(orderAfter.refund.refundedBy)).toBe(String(admin._id));

    expect(orderAfter.refund.refundedAt).toBeTruthy();

    /*
        |--------------------------------------------------------------------------
        | Refunded Status History
        |--------------------------------------------------------------------------
        */

    const refundedHistoryEntry = orderAfter.statusHistory.find(
      (entry) => entry.status === "refunded",
    );

    expect(refundedHistoryEntry).toBeTruthy();

    expect(String(refundedHistoryEntry.changedBy)).toBe(String(admin._id));

    /*
        |--------------------------------------------------------------------------
        | Audit
        |--------------------------------------------------------------------------
        */

    const audit = await OrderReturnRefundAudit.findOne({
      returnRequest: returnRequest.id,
    }).lean();

    expect(audit).toBeTruthy();

    expect(audit.paymentStatus).toBe("refunded");

    expect(audit.cumulativeRefundAmount).toBe(orderGrandTotal);
  });

  /*
    |--------------------------------------------------------------------------
    | Refund Before Completion
    |--------------------------------------------------------------------------
    */

  it("rejects refunding a Return Request before physical Return completion", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createInspectedCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,

        requestedResolution: "refund",
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId: `RFND-EARLY-${new mongoose.Types.ObjectId().toString()}`,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REFUND_STATUS_INVALID");
  });

  /*
    |--------------------------------------------------------------------------
    | Wrong Resolution
    |--------------------------------------------------------------------------
    */

  it("rejects the refund endpoint when the Return Request resolution is replacement", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCompletedCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,

        requestedResolution: "refund",
      },
    );

    /*
     * Corrupt resolution directly to simulate an existing replacement
     * Return reaching this endpoint.
     */

    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          requestedResolution: "replacement",
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId: `RFND-REPLACEMENT-${new mongoose.Types.ObjectId().toString()}`,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REFUND_RESOLUTION_INVALID",
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Nothing Refundable
    |--------------------------------------------------------------------------
    */

  it("rejects refund when all returned quantities were rejected during inspection", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
        |--------------------------------------------------------------------------
        | Create Received Return
        |--------------------------------------------------------------------------
        */

    const fixture = await createReceivedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 1,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const { returnRequest, storedReceivedReturnRequest } = fixture;

    /*
        |--------------------------------------------------------------------------
        | Reject Returned Unit During Inspection
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

            damagedQuantity: 0,

            rejectedQuantity: 1,

            note: "Returned merchandise was rejected.",
          },
        ],
      })
      .expect(200);

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/complete`)
      .send({})
      .expect(200);

    /*
        |--------------------------------------------------------------------------
        | Financial Refund
        |--------------------------------------------------------------------------
        */

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId: `RFND-REJECTED-${new mongoose.Types.ObjectId().toString()}`,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_RETURN_NOTHING_REFUNDABLE");

    const audits = await OrderReturnRefundAudit.find({
      returnRequest: returnRequest.id,
    }).lean();

    expect(audits).toHaveLength(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate Refund
    |--------------------------------------------------------------------------
    */

  it("rejects refunding the same Return Request twice", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCompletedCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,

        requestedResolution: "refund",
      },
    );

    const firstReferenceId = `RFND-DUPLICATE-A-${new mongoose.Types.ObjectId().toString()}`;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId: firstReferenceId,
      })
      .expect(200);

    const secondResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId: `RFND-DUPLICATE-B-${new mongoose.Types.ObjectId().toString()}`,
      });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe("ORDER_RETURN_ALREADY_REFUNDED");

    /*
        |--------------------------------------------------------------------------
        | Exactly One Financial Audit
        |--------------------------------------------------------------------------
        */

    const audits = await OrderReturnRefundAudit.find({
      returnRequest: returnRequest.id,
    }).lean();

    expect(audits).toHaveLength(1);

    expect(audits[0].referenceId).toBe(firstReferenceId);
  });

  /*
    |--------------------------------------------------------------------------
    | Duplicate External Reference
    |--------------------------------------------------------------------------
    */

  it("rejects reusing the same external refund reference ID for another Return Request", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const firstFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 1,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const secondFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 1,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const sharedReferenceId = `RFND-SHARED-${new mongoose.Types.ObjectId().toString()}`;

    await adminAgent
      .post(
        `/api/v1/admin/order-returns/${firstFixture.returnRequest.id}/refund`,
      )
      .send({
        referenceId: sharedReferenceId,
      })
      .expect(200);

    const response = await adminAgent
      .post(
        `/api/v1/admin/order-returns/${secondFixture.returnRequest.id}/refund`,
      )
      .send({
        referenceId: sharedReferenceId,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REFUND_REFERENCE_CONFLICT",
    );

    /*
     * Second Return must remain financially unrefunded.
     */

    const secondStoredReturn = await OrderReturnRequest.findById(
      secondFixture.returnRequest.id,
    ).lean();

    expect(secondStoredReturn.refund.refundedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Transaction Rollback
    |--------------------------------------------------------------------------
    */

  it("rolls back refund audit and Order payment changes when Return refund persistence fails", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCompletedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 2,

        returnQuantity: 1,

        requestedResolution: "refund",
      });

    const orderBefore = await Order.findById(createdOrder.id).lean();

    /*
        |--------------------------------------------------------------------------
        | Corrupt an unrelated Return field
        |--------------------------------------------------------------------------
        |
        | Refund plan itself does not use shipment.carrier.
        |
        | The audit and Order update can occur, then the final Return save
        | should fail Mongoose validation.
        |--------------------------------------------------------------------------
        */

    await OrderReturnRequest.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(returnRequest.id),
      },
      {
        $set: {
          "shipment.carrier": "X".repeat(101),
        },
      },
    );

    const referenceId = `RFND-ROLLBACK-${new mongoose.Types.ObjectId().toString()}`;

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId,
      });

    expect(response.status).toBe(400);

    /*
        |--------------------------------------------------------------------------
        | Order Payment Must Roll Back
        |--------------------------------------------------------------------------
        */

    const orderAfter = await Order.findById(createdOrder.id).lean();

    expect(orderAfter.payment.status).toBe(orderBefore.payment.status);

    expect(orderAfter.payment.refundedAt ?? null).toEqual(
      orderBefore.payment.refundedAt ?? null,
    );

    /*
        |--------------------------------------------------------------------------
        | Audit Must Roll Back
        |--------------------------------------------------------------------------
        */

    const audit = await OrderReturnRefundAudit.findOne({
      referenceId,
    }).lean();

    expect(audit).toBeNull();

    /*
        |--------------------------------------------------------------------------
        | Return Refund State Must Roll Back
        |--------------------------------------------------------------------------
        */

    const storedReturn = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturn.status).toBe("completed");

    expect(storedReturn.refund.refundedQuantity).toBe(0);

    expect(storedReturn.refund.amount).toBe(0);

    expect(storedReturn.refund.referenceId).toBeNull();

    expect(storedReturn.refund.refundedAt).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Concurrent Refund
    |--------------------------------------------------------------------------
    */

  it("allows only one financial refund when two refund requests target the same Return Request concurrently", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { createdOrder, returnRequest } =
      await createCompletedCustomerReturnRequestFixture({
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,

        requestedResolution: "refund",
      });

    const firstReferenceId = `RFND-CONCURRENT-A-${new mongoose.Types.ObjectId().toString()}`;

    const secondReferenceId = `RFND-CONCURRENT-B-${new mongoose.Types.ObjectId().toString()}`;

    const [firstResponse, secondResponse] = await Promise.all([
      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
        .send({
          referenceId: firstReferenceId,
        }),

      adminAgent
        .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
        .send({
          referenceId: secondReferenceId,
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
      "ORDER_RETURN_REFUND_CONFLICT",
      "ORDER_RETURN_ALREADY_REFUNDED",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
        |--------------------------------------------------------------------------
        | Exactly One Audit
        |--------------------------------------------------------------------------
        */

    const audits = await OrderReturnRefundAudit.find({
      returnRequest: returnRequest.id,
    }).lean();

    expect(audits).toHaveLength(1);

    /*
        |--------------------------------------------------------------------------
        | Return Financial State Exists Exactly Once
        |--------------------------------------------------------------------------
        */

    const storedReturn = await OrderReturnRequest.findById(
      returnRequest.id,
    ).lean();

    expect(storedReturn.refund.refundedAt).toBeTruthy();

    expect([firstReferenceId, secondReferenceId]).toContain(
      storedReturn.refund.referenceId,
    );

    /*
        |--------------------------------------------------------------------------
        | Full Single-Item Order Refunded Once
        |--------------------------------------------------------------------------
        */

    const order = await Order.findById(createdOrder.id).lean();

    expect(order.status).toBe("refunded");

    expect(order.payment.status).toBe("refunded");
  });
});

/*
|--------------------------------------------------------------------------
| Admin Multi-Return Cumulative Refund
|--------------------------------------------------------------------------
*/

describe("Admin multi-Return cumulative refund", () => {
  it("moves one Order from paid to partially-refunded and then refunded across two separate Return Requests", async () => {
    const { agent: adminAgent, user: admin } =
      await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
    |--------------------------------------------------------------------------
    | First Return
    |--------------------------------------------------------------------------
    |
    | Order quantity = 2
    | First Return   = 1
    |--------------------------------------------------------------------------
    */

    const firstFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const {
      createdOrder,
      orderItem,

      returnRequest: firstReturnRequest,
    } = firstFixture;

    /*
    |--------------------------------------------------------------------------
    | Trusted Order Values
    |--------------------------------------------------------------------------
    */

    const initialOrder = await Order.findById(createdOrder.id).lean();

    expect(initialOrder.payment.status).toBe("paid");

    const trustedOrderItem = initialOrder.items.find(
      (item) => String(item._id) === String(orderItem._id),
    );

    expect(trustedOrderItem).toBeTruthy();

    const unitRefundAmount = Number(trustedOrderItem.pricing.unitFinalPrice);

    const orderGrandTotal = Number(initialOrder.totals.grandTotal);

    /*
     * For this fixture:
     *
     * 2 units × unitFinalPrice
     *
     * should equal the complete Order value.
     */

    expect(unitRefundAmount * 2).toBe(orderGrandTotal);

    /*
    |--------------------------------------------------------------------------
    | Refund First Return
    |--------------------------------------------------------------------------
    */

    const firstReferenceId = `RFND-MULTI-A-${new mongoose.Types.ObjectId().toString()}`;

    const firstRefundResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${firstReturnRequest.id}/refund`)
      .send({
        referenceId: firstReferenceId,

        note: "First partial Return refund.",
      });

    expect(firstRefundResponse.status).toBe(200);

    expect(firstRefundResponse.body.data.returnRequest.refund.amount).toBe(
      unitRefundAmount,
    );

    /*
    |--------------------------------------------------------------------------
    | Order Must Now Be Partially Refunded
    |--------------------------------------------------------------------------
    */

    const orderAfterFirstRefund = await Order.findById(createdOrder.id).lean();

    expect(orderAfterFirstRefund.payment.status).toBe("partially-refunded");

    expect(orderAfterFirstRefund.payment.refundedAt).toBeNull();

    expect(orderAfterFirstRefund.status).not.toBe("refunded");

    /*
    |--------------------------------------------------------------------------
    | First Audit
    |--------------------------------------------------------------------------
    */

    const firstAudit = await OrderReturnRefundAudit.findOne({
      returnRequest: firstReturnRequest.id,
    }).lean();

    expect(firstAudit).toBeTruthy();

    expect(firstAudit.previousPaymentStatus).toBe("paid");

    expect(firstAudit.paymentStatus).toBe("partially-refunded");

    expect(firstAudit.previousCumulativeRefundAmount).toBe(0);

    expect(firstAudit.cumulativeRefundAmount).toBe(unitRefundAmount);

    /*
    |--------------------------------------------------------------------------
    | Create Second Return Against SAME Order
    |--------------------------------------------------------------------------
    |
    | First completed Return consumes 1.
    |
    | Purchased quantity = 2
    |
    | Remaining returnable quantity = 1.
    |--------------------------------------------------------------------------
    */

    const { completedReturnRequest: secondReturnRequest } =
      await createCompletedReturnForExistingOrder({
        adminAgent,
        customerAgent,

        orderId: createdOrder.id,

        orderItemId: orderItem._id,

        quantity: 1,

        requestedResolution: "refund",

        resellableQuantity: 1,

        damagedQuantity: 0,

        rejectedQuantity: 0,
      });

    expect(secondReturnRequest.status).toBe("completed");

    expect(secondReturnRequest.id).not.toBe(firstReturnRequest.id);

    /*
    |--------------------------------------------------------------------------
    | Refund Second Return
    |--------------------------------------------------------------------------
    */

    const secondReferenceId = `RFND-MULTI-B-${new mongoose.Types.ObjectId().toString()}`;

    const secondRefundResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${secondReturnRequest.id}/refund`)
      .send({
        referenceId: secondReferenceId,

        note: "Second Return completes the Order refund.",
      });

    expect(secondRefundResponse.status).toBe(200);

    expect(secondRefundResponse.body.data.returnRequest.refund.amount).toBe(
      unitRefundAmount,
    );

    /*
    |--------------------------------------------------------------------------
    | Entire Order Must Now Be Fully Refunded
    |--------------------------------------------------------------------------
    */

    const fullyRefundedOrder = await Order.findById(createdOrder.id).lean();

    expect(fullyRefundedOrder.status).toBe("refunded");

    expect(fullyRefundedOrder.payment.status).toBe("refunded");

    expect(fullyRefundedOrder.payment.refundedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Final Order-Level Refund Snapshot
    |--------------------------------------------------------------------------
    */

    expect(fullyRefundedOrder.refund.amount).toBe(orderGrandTotal);

    expect(fullyRefundedOrder.refund.currency).toBe(
      initialOrder.totals.currency,
    );

    expect(fullyRefundedOrder.refund.referenceId).toBe(secondReferenceId);

    expect(String(fullyRefundedOrder.refund.refundedBy)).toBe(
      String(admin._id),
    );

    expect(fullyRefundedOrder.refund.refundedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Two Immutable Return Refund Audits
    |--------------------------------------------------------------------------
    */

    const audits = await OrderReturnRefundAudit.find({
      order: createdOrder.id,
    })
      .sort({
        refundedAt: 1,
      })
      .lean();

    expect(audits).toHaveLength(2);

    /*
    |--------------------------------------------------------------------------
    | First Refund Audit
    |--------------------------------------------------------------------------
    */

    expect(audits[0].amount).toBe(unitRefundAmount);

    expect(audits[0].previousCumulativeRefundAmount).toBe(0);

    expect(audits[0].cumulativeRefundAmount).toBe(unitRefundAmount);

    expect(audits[0].paymentStatus).toBe("partially-refunded");

    /*
    |--------------------------------------------------------------------------
    | Second Refund Audit
    |--------------------------------------------------------------------------
    */

    expect(audits[1].amount).toBe(unitRefundAmount);

    expect(audits[1].previousPaymentStatus).toBe("partially-refunded");

    expect(audits[1].paymentStatus).toBe("refunded");

    expect(audits[1].previousCumulativeRefundAmount).toBe(unitRefundAmount);

    expect(audits[1].cumulativeRefundAmount).toBe(orderGrandTotal);

    /*
    |--------------------------------------------------------------------------
    | Audit Totals Must Equal Order Total
    |--------------------------------------------------------------------------
    */

    const totalRefunded = audits.reduce(
      (total, audit) => total + Number(audit.amount),
      0,
    );

    expect(totalRefunded).toBe(orderGrandTotal);
  });

  it("prevents a third Return Request after separate completed Returns have consumed the full purchased quantity", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
    |--------------------------------------------------------------------------
    | Order quantity = 2
    | First Return   = 1
    |--------------------------------------------------------------------------
    */

    const firstFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const { createdOrder, orderItem } = firstFixture;

    /*
    |--------------------------------------------------------------------------
    | Second Return = remaining 1
    |--------------------------------------------------------------------------
    */

    await createCompletedReturnForExistingOrder({
      adminAgent,
      customerAgent,

      orderId: createdOrder.id,

      orderItemId: orderItem._id,

      quantity: 1,

      requestedResolution: "refund",
    });

    /*
    |--------------------------------------------------------------------------
    | Third Return Should Fail
    |--------------------------------------------------------------------------
    */

    const thirdResponse = await customerAgent
      .post(`/api/v1/orders/${createdOrder.id}/returns`)
      .send({
        requestedResolution: "refund",

        items: [
          {
            orderItemId: String(orderItem._id),

            quantity: 1,

            reason: "defective",

            details: "Attempting to return more than purchased quantity.",
          },
        ],
      });

    expect(thirdResponse.status).toBe(409);

    expect(thirdResponse.body.errorCode).toBe("ORDER_RETURN_QUANTITY_EXCEEDED");
  });

  it("prevents a Return refund when cumulative financial refunds would exceed the Order grand total", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
    |--------------------------------------------------------------------------
    | First Return
    |--------------------------------------------------------------------------
    */

    const firstFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const {
      createdOrder,
      orderItem,

      returnRequest: firstReturnRequest,
    } = firstFixture;

    const initialOrder = await Order.findById(createdOrder.id).lean();

    const grandTotal = Number(initialOrder.totals.grandTotal);

    /*
    |--------------------------------------------------------------------------
    | Legitimate First Refund
    |--------------------------------------------------------------------------
    */

    const firstReferenceId = `RFND-OVER-A-${new mongoose.Types.ObjectId().toString()}`;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${firstReturnRequest.id}/refund`)
      .send({
        referenceId: firstReferenceId,
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Create Second Completed Return
    |--------------------------------------------------------------------------
    */

    const { completedReturnRequest: secondReturnRequest } =
      await createCompletedReturnForExistingOrder({
        adminAgent,
        customerAgent,

        orderId: createdOrder.id,

        orderItemId: orderItem._id,

        quantity: 1,

        requestedResolution: "refund",
      });

    /*
    |--------------------------------------------------------------------------
    | Corrupt Previous Audit
    |--------------------------------------------------------------------------
    |
    | Audit model itself is immutable through Mongoose.
    |
    | Native collection access is deliberately used only for this
    | corruption-defense integration test.
    |--------------------------------------------------------------------------
    */

    await OrderReturnRefundAudit.collection.updateOne(
      {
        returnRequest: new mongoose.Types.ObjectId(firstReturnRequest.id),
      },
      {
        $set: {
          amount: grandTotal,

          cumulativeRefundAmount: grandTotal,
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Attempt Second Refund
    |--------------------------------------------------------------------------
    */

    const secondReferenceId = `RFND-OVER-B-${new mongoose.Types.ObjectId().toString()}`;

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${secondReturnRequest.id}/refund`)
      .send({
        referenceId: secondReferenceId,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REFUND_EXCEEDS_ORDER_TOTAL",
    );

    /*
    |--------------------------------------------------------------------------
    | Second Return Must Remain Unrefunded
    |--------------------------------------------------------------------------
    */

    const storedSecondReturn = await OrderReturnRequest.findById(
      secondReturnRequest.id,
    ).lean();

    expect(storedSecondReturn.refund.refundedAt).toBeNull();

    expect(storedSecondReturn.refund.referenceId).toBeNull();

    expect(storedSecondReturn.refund.amount).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | No Second Financial Audit
    |--------------------------------------------------------------------------
    */

    const secondAudit = await OrderReturnRefundAudit.findOne({
      returnRequest: secondReturnRequest.id,
    }).lean();

    expect(secondAudit).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Second Reference Must Not Be Persisted
    |--------------------------------------------------------------------------
    */

    const referenceAudit = await OrderReturnRefundAudit.findOne({
      referenceId: secondReferenceId,
    }).lean();

    expect(referenceAudit).toBeNull();
  });

  it("prevents a Return refund when cumulative financial refunds would exceed the Order grand total", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
    |--------------------------------------------------------------------------
    | First Return
    |--------------------------------------------------------------------------
    */

    const firstFixture = await createCompletedCustomerReturnRequestFixture({
      adminAgent,
      customerAgent,

      orderedQuantity: 2,

      returnQuantity: 1,

      requestedResolution: "refund",
    });

    const {
      createdOrder,
      orderItem,

      returnRequest: firstReturnRequest,
    } = firstFixture;

    const initialOrder = await Order.findById(createdOrder.id).lean();

    const grandTotal = Number(initialOrder.totals.grandTotal);

    /*
    |--------------------------------------------------------------------------
    | Legitimate First Refund
    |--------------------------------------------------------------------------
    */

    const firstReferenceId = `RFND-OVER-A-${new mongoose.Types.ObjectId().toString()}`;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${firstReturnRequest.id}/refund`)
      .send({
        referenceId: firstReferenceId,
      })
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | Create Second Completed Return
    |--------------------------------------------------------------------------
    */

    const { completedReturnRequest: secondReturnRequest } =
      await createCompletedReturnForExistingOrder({
        adminAgent,
        customerAgent,

        orderId: createdOrder.id,

        orderItemId: orderItem._id,

        quantity: 1,

        requestedResolution: "refund",
      });

    /*
    |--------------------------------------------------------------------------
    | Corrupt Previous Audit
    |--------------------------------------------------------------------------
    |
    | Audit model itself is immutable through Mongoose.
    |
    | Native collection access is deliberately used only for this
    | corruption-defense integration test.
    |--------------------------------------------------------------------------
    */

    await OrderReturnRefundAudit.collection.updateOne(
      {
        returnRequest: new mongoose.Types.ObjectId(firstReturnRequest.id),
      },
      {
        $set: {
          amount: grandTotal,

          cumulativeRefundAmount: grandTotal,
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Attempt Second Refund
    |--------------------------------------------------------------------------
    */

    const secondReferenceId = `RFND-OVER-B-${new mongoose.Types.ObjectId().toString()}`;

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${secondReturnRequest.id}/refund`)
      .send({
        referenceId: secondReferenceId,
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REFUND_EXCEEDS_ORDER_TOTAL",
    );

    /*
    |--------------------------------------------------------------------------
    | Second Return Must Remain Unrefunded
    |--------------------------------------------------------------------------
    */

    const storedSecondReturn = await OrderReturnRequest.findById(
      secondReturnRequest.id,
    ).lean();

    expect(storedSecondReturn.refund.refundedAt).toBeNull();

    expect(storedSecondReturn.refund.referenceId).toBeNull();

    expect(storedSecondReturn.refund.amount).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | No Second Financial Audit
    |--------------------------------------------------------------------------
    */

    const secondAudit = await OrderReturnRefundAudit.findOne({
      returnRequest: secondReturnRequest.id,
    }).lean();

    expect(secondAudit).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Second Reference Must Not Be Persisted
    |--------------------------------------------------------------------------
    */

    const referenceAudit = await OrderReturnRefundAudit.findOne({
      referenceId: secondReferenceId,
    }).lean();

    expect(referenceAudit).toBeNull();
  });

  it("prevents modification of an existing Return refund audit through Mongoose", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const { returnRequest } = await createCompletedCustomerReturnRequestFixture(
      {
        adminAgent,
        customerAgent,

        orderedQuantity: 1,

        returnQuantity: 1,

        requestedResolution: "refund",
      },
    );

    const referenceId = `RFND-IMMUTABLE-${new mongoose.Types.ObjectId().toString()}`;

    await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest.id}/refund`)
      .send({
        referenceId,
      })
      .expect(200);

    const audit = await OrderReturnRefundAudit.findOne({
      returnRequest: returnRequest.id,
    });

    expect(audit).toBeTruthy();

    const originalAmount = audit.amount;

    audit.amount = originalAmount + 100;

    await expect(audit.save()).rejects.toThrow(
      "Order Return Refund Audit records are immutable",
    );

    /*
     * Database still contains original amount.
     */

    const unchangedAudit = await OrderReturnRefundAudit.findById(
      audit._id,
    ).lean();

    expect(unchangedAudit.amount).toBe(originalAmount);
  });
});

describe("Admin Return replacement creation", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when the request is unauthenticated", async () => {
    const returnRequestId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-returns/${returnRequestId}/replacement`)
      .send({});

    expect(response.status).toBe(401);

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to create a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const returnRequestId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/replacement`)
      .send({});

    expect(response.status).toBe(403);

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Request Validation
  |--------------------------------------------------------------------------
  */

  it("rejects admin-controlled replacement fields in the request body", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const returnRequestId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/replacement`)
      .send({
        quantity: 100,

        replacementQuantity: 100,

        status: "shipped",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Return
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the Return Request does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const returnRequestId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequestId}/replacement`)
      .send({});

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REQUEST_NOT_FOUND");

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Return Must Be Completed
  |--------------------------------------------------------------------------
  */

  it("rejects a replacement before the Return Request is completed", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      status: "inspected",

      items: [
        {
          product,

          variant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_STATUS_INVALID",
    );

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Resolution Must Be Replacement
  |--------------------------------------------------------------------------
  */

  it("rejects a completed refund-resolution Return Request", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      requestedResolution: "refund",

      items: [
        {
          product,

          variant,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_RESOLUTION_INVALID",
    );

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Successful Trusted Replacement
  |--------------------------------------------------------------------------
  */

  it("creates a trusted replacement and atomically reserves inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-BLK-M",

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

    /*
     * returned = 3
     *
     * accepted:
     * resellable = 1
     * damaged    = 1
     *
     * rejected   = 1
     *
     * trusted replacement quantity = 2
     */

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant,

          quantity: 3,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 1,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    const replacement = response.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | Replacement Response
    |--------------------------------------------------------------------------
    */

    expect(replacement.replacementNumber).toMatch(/^RPL-\d{8}-[A-F0-9]{12}$/);

    expect(replacement.status).toBe("reserved");

    expect(replacement.returnRequestId).toBe(String(returnRequest._id));

    expect(replacement.items).toHaveLength(1);

    expect(replacement.items[0].returnedQuantity).toBe(3);

    /*
     * Must come from inspection:
     *
     * 1 resellable
     * +
     * 1 damaged
     * =
     * 2 replacement units
     */

    expect(replacement.items[0].replacementQuantity).toBe(2);

    expect(replacement.items[0].productId).toBe(String(product._id));

    expect(replacement.items[0].variantId).toBe(String(variant._id));

    /*
    |--------------------------------------------------------------------------
    | Persisted Replacement
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findOne({
      returnRequest: returnRequest._id,
    }).lean();

    expect(storedReplacement).not.toBeNull();

    expect(storedReplacement.status).toBe("reserved");

    expect(storedReplacement.items[0].replacementQuantity).toBe(2);

    expect(String(storedReplacement.reservation.reservedBy)).toBe(
      String(admin._id),
    );

    expect(storedReplacement.reservation.reservedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Product Inventory
    |--------------------------------------------------------------------------
    */

    const updatedProduct = await Product.findById(product._id).lean();

    const updatedVariant = findProductVariant(updatedProduct, variant._id);

    /*
     * Reservation must NOT reduce physical stock.
     */

    expect(updatedVariant.inventory.stock).toBe(10);

    expect(updatedVariant.inventory.reservedStock).toBe(2);

    expect(
      updatedVariant.inventory.stock - updatedVariant.inventory.reservedStock,
    ).toBe(8);

    /*
    |--------------------------------------------------------------------------
    | Replacement Inventory Ledger
    |--------------------------------------------------------------------------
    */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    }).lean();

    expect(ledgerEntries).toHaveLength(1);

    const ledger = ledgerEntries[0];

    expect(ledger.operation).toBe("reserve");

    expect(ledger.quantity).toBe(2);

    expect(ledger.stockDelta).toBe(0);

    expect(ledger.reservedStockDelta).toBe(2);

    expect(ledger.before).toMatchObject({
      stock: 10,

      reservedStock: 0,

      availableStock: 10,
    });

    expect(ledger.after).toMatchObject({
      stock: 10,

      reservedStock: 2,

      availableStock: 8,
    });

    expect(String(ledger.actor)).toBe(String(admin._id));

    /*
    |--------------------------------------------------------------------------
    | Return Must Remain Completed
    |--------------------------------------------------------------------------
    */

    const unchangedReturn = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturn.status).toBe("completed");
  });

  /*
  |--------------------------------------------------------------------------
  | Nothing Eligible
  |--------------------------------------------------------------------------
  */

  it("rejects a Return whose complete quantity was rejected during inspection", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant,

          quantity: 2,

          resellableQuantity: 0,

          damagedQuantity: 0,

          rejectedQuantity: 2,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_NOTHING_ELIGIBLE",
    );

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Insufficient Replacement Stock
  |--------------------------------------------------------------------------
  */

  it("rolls back replacement creation when available stock is insufficient", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-LOW-STOCK-M",

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

          /*
           * Available =
           * 2 - 1
           * = 1
           *
           * Replacement needs 2.
           */

          inventory: {
            stock: 2,

            reservedStock: 1,

            lowStockThreshold: 1,
          },

          shipping: {
            weightInGrams: 250,
          },

          isActive: true,
        },
      ],
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_INSUFFICIENT_STOCK",
    );

    /*
     * Replacement creation must roll back.
     */

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);

    /*
     * Inventory must remain unchanged.
     */

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(2);

    expect(unchangedVariant.inventory.reservedStock).toBe(1);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Replacement
  |--------------------------------------------------------------------------
  */

  it("does not reserve inventory twice when replacement creation is repeated", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const url = `/api/v1/admin/order-returns/${returnRequest._id}/replacement`;

    const firstResponse = await adminAgent.post(url).send({});

    expect(firstResponse.status).toBe(201);

    const secondResponse = await adminAgent.post(url).send({});

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_EXISTS",
    );

    expect(
      await OrderReturnReplacement.countDocuments({
        returnRequest: returnRequest._id,
      }),
    ).toBe(1);

    const updatedProduct = await Product.findById(product._id).lean();

    const updatedVariant = findProductVariant(updatedProduct, variant._id);

    /*
     * Only one reservation of quantity 2.
     */

    expect(updatedVariant.inventory.reservedStock).toBe(2);

    expect(
      await ProductInventoryLedger.countDocuments({
        operation: "reserve",

        referenceId: firstResponse.body.data.replacement.replacementNumber,
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Multi-Item Rollback
  |--------------------------------------------------------------------------
  */

  it("rolls back an earlier replacement reservation when a later item fails", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-AVAILABLE-M",

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

        {
          sku: "RPL-UNAVAILABLE-L",

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

          /*
           * Available = 1
           * replacement needs = 2
           */

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

    const firstVariant = product.variants[0];

    const secondVariant = product.variants[1];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant: firstVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },

        {
          product,

          variant: secondVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_INSUFFICIENT_STOCK",
    );

    /*
    |--------------------------------------------------------------------------
    | Entire Transaction Must Roll Back
    |--------------------------------------------------------------------------
    */

    const updatedProduct = await Product.findById(product._id).lean();

    const updatedFirstVariant = findProductVariant(
      updatedProduct,
      firstVariant._id,
    );

    const updatedSecondVariant = findProductVariant(
      updatedProduct,
      secondVariant._id,
    );

    /*
     * First reservation happened earlier inside the transaction,
     * but it must not survive.
     */

    expect(updatedFirstVariant.inventory.reservedStock).toBe(1);

    expect(updatedSecondVariant.inventory.reservedStock).toBe(1);

    expect(await OrderReturnReplacement.countDocuments()).toBe(0);

    expect(await ProductInventoryLedger.countDocuments()).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Replacement Creation
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent replacement and reserves inventory once", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: firstAdmin._id,

      items: [
        {
          product,

          variant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const url = `/api/v1/admin/order-returns/${returnRequest._id}/replacement`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({}),

      secondAdminAgent.post(url).send({}),
    ]);

    const responses = [firstResponse, secondResponse];

    const successResponses = responses.filter(
      (response) => response.status === 201,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    expect(successResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect(conflictResponses[0].body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_EXISTS",
    );

    /*
    |--------------------------------------------------------------------------
    | Exactly One Replacement
    |--------------------------------------------------------------------------
    */

    expect(
      await OrderReturnReplacement.countDocuments({
        returnRequest: returnRequest._id,
      }),
    ).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Inventory Reserved Exactly Once
    |--------------------------------------------------------------------------
    */

    const updatedProduct = await Product.findById(product._id).lean();

    const updatedVariant = findProductVariant(updatedProduct, variant._id);

    expect(updatedVariant.inventory.stock).toBe(10);

    expect(updatedVariant.inventory.reservedStock).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Exactly One Replacement Reservation Ledger
    |--------------------------------------------------------------------------
    */

    const replacement = await OrderReturnReplacement.findOne({
      returnRequest: returnRequest._id,
    }).lean();

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(1);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Processing
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement processing", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when processing a replacement without authentication", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/process`)
      .send({});

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to process a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/process`)
      .send({});

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Replacement ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when the replacement ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post(
        "/api/v1/admin/order-return-replacements/not-a-valid-object-id/process",
      )
      .send({});

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "replacementId",
        }),
      ]),
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Request Validation
  |--------------------------------------------------------------------------
  */

  it("rejects backend-controlled processing fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/process`)
      .send({
        note: "Start processing",

        status: "processing",

        processedBy: new mongoose.Types.ObjectId().toString(),

        processedAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the replacement does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/process`)
      .send({});

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Successful Processing
  |--------------------------------------------------------------------------
  */

  it("moves a reserved replacement to processing without changing inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { product, variant, replacement, returnRequest } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,

        productOverrides: {
          variants: [
            {
              sku: "RPL-PROCESS-M",

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

                lowStockThreshold: 2,
              },

              shipping: {
                weightInGrams: 250,
              },

              isActive: true,
            },
          ],
        },
      });

    /*
    |--------------------------------------------------------------------------
    | State Before Processing
    |--------------------------------------------------------------------------
    */

    expect(replacement.status).toBe("reserved");

    const productBeforeProcessing = await Product.findById(product._id).lean();

    const variantBeforeProcessing = findProductVariant(
      productBeforeProcessing,
      variant._id,
    );

    expect(variantBeforeProcessing.inventory.stock).toBe(10);

    expect(variantBeforeProcessing.inventory.reservedStock).toBe(2);

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments({
      referenceId: replacement.replacementNumber,
    });

    expect(ledgerCountBefore).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Process Replacement
    |--------------------------------------------------------------------------
    */

    const processingNote =
      "Warehouse started preparing the replacement package.";

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/process`)
      .send({
        note: processingNote,
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement processing started successfully",
    );

    const processedReplacement = response.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | API Response
    |--------------------------------------------------------------------------
    */

    expect(processedReplacement.id).toBe(replacement.id);

    expect(processedReplacement.status).toBe("processing");

    expect(processedReplacement.processing).toMatchObject({
      note: processingNote,

      processedBy: String(admin._id),
    });

    expect(processedReplacement.processing.processedAt).toBeTruthy();

    /*
     * Reservation evidence must remain.
     */

    expect(processedReplacement.reservation.reservedBy).toBe(String(admin._id));

    expect(processedReplacement.reservation.reservedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Stored Replacement
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("processing");

    expect(storedReplacement.processing.note).toBe(processingNote);

    expect(String(storedReplacement.processing.processedBy)).toBe(
      String(admin._id),
    );

    expect(storedReplacement.processing.processedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Product Inventory Must Not Change
    |--------------------------------------------------------------------------
    */

    const productAfterProcessing = await Product.findById(product._id).lean();

    const variantAfterProcessing = findProductVariant(
      productAfterProcessing,
      variant._id,
    );

    expect(variantAfterProcessing.inventory.stock).toBe(
      variantBeforeProcessing.inventory.stock,
    );

    expect(variantAfterProcessing.inventory.reservedStock).toBe(
      variantBeforeProcessing.inventory.reservedStock,
    );

    /*
    |--------------------------------------------------------------------------
    | No New Inventory Ledger
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,
      }),
    ).toBe(ledgerCountBefore);

    /*
    |--------------------------------------------------------------------------
    | Return Request Must Remain Completed
    |--------------------------------------------------------------------------
    */

    const unchangedReturnRequest = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturnRequest.status).toBe("completed");
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Processing
  |--------------------------------------------------------------------------
  */

  it("rejects processing the same replacement twice", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/process`;

    const firstResponse = await adminAgent.post(url).send({
      note: "First processing request.",
    });

    expect(firstResponse.status).toBe(200);

    const firstProcessedAt =
      firstResponse.body.data.replacement.processing.processedAt;

    const secondResponse = await adminAgent.post(url).send({
      note: "Second processing request.",
    });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_PROCESSING",
    );

    /*
    |--------------------------------------------------------------------------
    | Original Processing Audit Must Remain
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("processing");

    expect(storedReplacement.processing.note).toBe("First processing request.");

    expect(storedReplacement.processing.processedAt.toISOString()).toBe(
      firstProcessedAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Inventory Still Reserved Only Once
    |--------------------------------------------------------------------------
    */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(10);

    expect(storedVariant.inventory.reservedStock).toBe(2);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Status
  |--------------------------------------------------------------------------
  */

  it("rejects processing a replacement that is not reserved", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement } = await createReservedReplacementFixture({
      adminAgent,

      adminId: admin._id,

      customerId: customer._id,
    });

    /*
     * Simulate a valid enum status that is not
     * eligible for processing.
     */

    await OrderReturnReplacement.updateOne(
      {
        _id: replacement.id,
      },
      {
        $set: {
          status: "pending",
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/process`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_PROCESSING_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("pending");

    expect(response.body.details.requiredStatus).toBe("reserved");
  });

  /*
  |--------------------------------------------------------------------------
  | Corrupted Reservation State
  |--------------------------------------------------------------------------
  */

  it("rejects processing when reserved replacement evidence is missing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Corrupt Persisted Reservation Evidence
    |--------------------------------------------------------------------------
    |
    | Native collection access deliberately bypasses
    | Mongoose validation for this state-integrity test.
    |--------------------------------------------------------------------------
    */

    await OrderReturnReplacement.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(replacement.id),
      },
      {
        $set: {
          "reservation.reservedBy": null,

          "reservation.reservedAt": null,
        },
      },
    );

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments({
      referenceId: replacement.replacementNumber,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/process`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_PROCESSING_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | Status Must Remain Reserved
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("reserved");

    expect(unchangedReplacement.processing?.processedAt ?? null).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Inventory Must Remain Untouched
    |--------------------------------------------------------------------------
    */

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(10);

    expect(unchangedVariant.inventory.reservedStock).toBe(2);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,
      }),
    ).toBe(ledgerCountBefore);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Processing
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent processing transition", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: secondAdminAgent,

      user: secondAdmin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/process`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({
        note: "Processing request from first admin.",
      }),

      secondAdminAgent.post(url).send({
        note: "Processing request from second admin.",
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

    expect(conflictResponses[0].body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_PROCESSING",
    );

    /*
    |--------------------------------------------------------------------------
    | Exactly One Processing Audit
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("processing");

    expect(storedReplacement.processing.processedAt).toBeTruthy();

    const processingAdminIds = [
      String(firstAdmin._id),

      String(secondAdmin._id),
    ];

    expect(processingAdminIds).toContain(
      String(storedReplacement.processing.processedBy),
    );

    /*
    |--------------------------------------------------------------------------
    | Inventory Must Still Be Reserved Exactly Once
    |--------------------------------------------------------------------------
    */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(10);

    expect(storedVariant.inventory.reservedStock).toBe(2);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(1);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Shipment
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement shipment", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when shipping a replacement without authentication", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-UNAUTH-123",
      });

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to ship a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-CUSTOMER-123",
      });

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Replacement ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when the shipment replacement ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post(
        "/api/v1/admin/order-return-replacements/not-a-valid-object-id/ship",
      )
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-INVALID-ID",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "replacementId",
        }),
      ]),
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Shipment Request Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid and backend-controlled shipment fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/ship`)
      .send({
        carrier: "A",

        trackingNumber: "X",

        trackingUrl: "not-a-valid-url",

        status: "shipped",

        shippedBy: new mongoose.Types.ObjectId().toString(),

        shippedAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details.length).toBeGreaterThan(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the shipment replacement does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-MISSING-123",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Must Be Processing
  |--------------------------------------------------------------------------
  */

  it("rejects shipping a replacement that is still reserved", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    expect(replacement.status).toBe("reserved");

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-NOT-PROCESSING",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_SHIPMENT_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("reserved");

    /*
     * Inventory reservation must remain untouched.
     */

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(10);

    expect(unchangedVariant.inventory.reservedStock).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Successful Shipment + Inventory Commit
  |--------------------------------------------------------------------------
  */

  it("ships a processing replacement and atomically commits reserved inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant, returnRequest } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,

        productOverrides: {
          variants: [
            {
              sku: "RPL-SHIP-BLK-M",

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

                lowStockThreshold: 2,
              },

              shipping: {
                weightInGrams: 250,
              },

              isActive: true,
            },
          ],
        },
      });

    /*
    |--------------------------------------------------------------------------
    | Before Shipment
    |--------------------------------------------------------------------------
    */

    const productBeforeShipment = await Product.findById(product._id).lean();

    const variantBeforeShipment = findProductVariant(
      productBeforeShipment,
      variant._id,
    );

    /*
     * Replacement creation reserved 2.
     */

    expect(variantBeforeShipment.inventory.stock).toBe(10);

    expect(variantBeforeShipment.inventory.reservedStock).toBe(2);

    expect(
      variantBeforeShipment.inventory.stock -
        variantBeforeShipment.inventory.reservedStock,
    ).toBe(8);

    const ledgerBeforeShipment = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerBeforeShipment).toHaveLength(1);

    expect(ledgerBeforeShipment[0].operation).toBe("reserve");

    /*
    |--------------------------------------------------------------------------
    | Ship
    |--------------------------------------------------------------------------
    */

    const shipmentData = {
      carrier: "Blue Dart",

      trackingNumber: "RPL-BD-123456789",

      trackingUrl: "https://tracking.example.com/RPL-BD-123456789",

      note: "Replacement package handed over to courier.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send(shipmentData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement shipped successfully",
    );

    const shippedReplacement = response.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | Response Shipment State
    |--------------------------------------------------------------------------
    */

    expect(shippedReplacement.status).toBe("shipped");

    expect(shippedReplacement.shipment).toMatchObject({
      carrier: shipmentData.carrier,

      trackingNumber: shipmentData.trackingNumber,

      trackingUrl: shipmentData.trackingUrl,

      note: shipmentData.note,

      shippedBy: String(admin._id),

      deliveredBy: null,

      deliveredAt: null,
    });

    expect(shippedReplacement.shipment.shippedAt).toBeTruthy();

    /*
     * Existing processing audit must remain.
     */

    expect(shippedReplacement.processing.processedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Stored Replacement
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("shipped");

    expect(storedReplacement.shipment.carrier).toBe("Blue Dart");

    expect(storedReplacement.shipment.trackingNumber).toBe("RPL-BD-123456789");

    expect(String(storedReplacement.shipment.shippedBy)).toBe(
      String(admin._id),
    );

    expect(storedReplacement.shipment.shippedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Product Inventory Commit
    |--------------------------------------------------------------------------
    */

    const productAfterShipment = await Product.findById(product._id).lean();

    const variantAfterShipment = findProductVariant(
      productAfterShipment,
      variant._id,
    );

    /*
     * COMMIT 2:
     *
     * stock         10 -> 8
     * reservedStock  2 -> 0
     */

    expect(variantAfterShipment.inventory.stock).toBe(8);

    expect(variantAfterShipment.inventory.reservedStock).toBe(0);

    /*
     * Available stock remains unchanged:
     *
     * before = 10 - 2 = 8
     * after  =  8 - 0 = 8
     */

    expect(
      variantAfterShipment.inventory.stock -
        variantAfterShipment.inventory.reservedStock,
    ).toBe(8);

    /*
    |--------------------------------------------------------------------------
    | Reserve + Commit Ledger
    |--------------------------------------------------------------------------
    */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    const commitLedger = ledgerEntries[1];

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

    /*
    |--------------------------------------------------------------------------
    | Original Return Remains Completed
    |--------------------------------------------------------------------------
    */

    const unchangedReturn = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturn.status).toBe("completed");
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Shipment
  |--------------------------------------------------------------------------
  */

  it("rejects shipping the same replacement twice without committing inventory twice", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/ship`;

    const firstResponse = await adminAgent.post(url).send({
      carrier: "Blue Dart",

      trackingNumber: "RPL-FIRST-SHIP",
    });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await adminAgent.post(url).send({
      carrier: "Delhivery",

      trackingNumber: "RPL-SECOND-SHIP",
    });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_SHIPPED",
    );

    /*
    |--------------------------------------------------------------------------
    | Stock Deducted Exactly Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Only One Commit Ledger
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(1);

    /*
     * Original shipment information must remain.
     */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.shipment.trackingNumber).toBe("RPL-FIRST-SHIP");
  });

  /*
  |--------------------------------------------------------------------------
  | Corrupted Reservation State
  |--------------------------------------------------------------------------
  */

  it("rolls back shipment when reserved Product inventory is missing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
     * Replacement believes 2 units are reserved.
     *
     * Corrupt Product inventory so the reservation
     * no longer exists.
     */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-CORRUPT-INVENTORY",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_COMMIT_INVENTORY_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | Replacement Shipment Must Roll Back
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("processing");

    expect(unchangedReplacement.shipment?.shippedAt ?? null).toBeNull();

    expect(unchangedReplacement.shipment?.trackingNumber ?? null).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Pre-existing Inventory Corruption Remains
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | No Commit Ledger Survives
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(0);

    /*
     * Original reservation Ledger still exists.
     */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Multi-Item Transaction Rollback
  |--------------------------------------------------------------------------
  */

  it("rolls back an earlier replacement inventory commit when a later item fails", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-COMMIT-FIRST",

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

        {
          sku: "RPL-COMMIT-SECOND",

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

    const firstVariant = product.variants[0];

    const secondVariant = product.variants[1];

    /*
    |--------------------------------------------------------------------------
    | Completed Multi-Item Return
    |--------------------------------------------------------------------------
    */

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant: firstVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },

        {
          product,

          variant: secondVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    /*
    |--------------------------------------------------------------------------
    | Create Replacement -> Reserve Both
    |--------------------------------------------------------------------------
    */

    const creationResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({})
      .expect(201);

    const replacement = creationResponse.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | Move To Processing
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/process`)
      .send({
        note: "Preparing multi-item replacement shipment.",
      })
      .expect(200);

    /*
     * Both variants should now hold two reservations.
     */

    const productAfterReservation = await Product.findById(product._id).lean();

    expect(
      findProductVariant(productAfterReservation, firstVariant._id).inventory
        .reservedStock,
    ).toBe(2);

    expect(
      findProductVariant(productAfterReservation, secondVariant._id).inventory
        .reservedStock,
    ).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Corrupt Second Variant
    |--------------------------------------------------------------------------
    |
    | First commit should execute inside transaction.
    | Second commit should fail.
    | Entire transaction must then roll back.
    |--------------------------------------------------------------------------
    */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": secondVariant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-MULTI-ROLLBACK",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_COMMIT_INVENTORY_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | First Commit Must Be Rolled Back
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalFirstVariant = findProductVariant(
      finalProduct,
      firstVariant._id,
    );

    const finalSecondVariant = findProductVariant(
      finalProduct,
      secondVariant._id,
    );

    expect(finalFirstVariant.inventory.stock).toBe(10);

    expect(finalFirstVariant.inventory.reservedStock).toBe(2);

    /*
     * Pre-existing second-variant corruption remains.
     */

    expect(finalSecondVariant.inventory.stock).toBe(10);

    expect(finalSecondVariant.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Replacement Must Remain Processing
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("processing");

    expect(unchangedReplacement.shipment?.shippedAt ?? null).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Commit Ledgers Must Roll Back
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(0);

    /*
     * Two original reserve ledgers remain.
     */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Shipment
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent replacement shipment and commits inventory once", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/ship`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-CONCURRENT-A",
      }),

      secondAdminAgent.post(url).send({
        carrier: "Delhivery",

        trackingNumber: "RPL-CONCURRENT-B",
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

    expect(conflictResponses[0].body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_SHIPPED",
    );

    /*
    |--------------------------------------------------------------------------
    | Exactly One Inventory Commit
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Exactly One Shipment State
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("shipped");

    expect(["RPL-CONCURRENT-A", "RPL-CONCURRENT-B"]).toContain(
      storedReplacement.shipment.trackingNumber,
    );
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Delivery
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement delivery", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when delivering a replacement without authentication", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/deliver`)
      .send({});

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to deliver a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/deliver`)
      .send({});

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Replacement ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when the delivery replacement ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post(
        "/api/v1/admin/order-return-replacements/not-a-valid-object-id/deliver",
      )
      .send({});

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "params",

          field: "replacementId",
        }),
      ]),
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Request Validation
  |--------------------------------------------------------------------------
  */

  it("rejects backend-controlled delivery fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/deliver`)
      .send({
        status: "delivered",

        deliveredBy: new mongoose.Types.ObjectId().toString(),

        deliveredAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the delivery replacement does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/deliver`)
      .send({});

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Must Already Be Shipped
  |--------------------------------------------------------------------------
  */

  it("rejects delivering a replacement that is still processing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_DELIVERY_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("processing");

    expect(response.body.details.requiredStatus).toBe("shipped");

    /*
     * Inventory is still reserved because
     * shipment never happened.
     */

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(10);

    expect(unchangedVariant.inventory.reservedStock).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Successful Delivery
  |--------------------------------------------------------------------------
  */

  it("delivers a shipped replacement without changing Product inventory or inventory Ledger", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant, returnRequest, shippedReplacement } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,

        productOverrides: {
          variants: [
            {
              sku: "RPL-DELIVER-M",

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

                lowStockThreshold: 2,
              },

              shipping: {
                weightInGrams: 250,
              },

              isActive: true,
            },
          ],
        },
      });

    expect(shippedReplacement.status).toBe("shipped");

    /*
    |--------------------------------------------------------------------------
    | Inventory Before Delivery
    |--------------------------------------------------------------------------
    |
    | Replacement quantity = 2
    |
    | Creation reserved 2.
    | Shipment committed 2.
    |--------------------------------------------------------------------------
    */

    const productBeforeDelivery = await Product.findById(product._id).lean();

    const variantBeforeDelivery = findProductVariant(
      productBeforeDelivery,
      variant._id,
    );

    expect(variantBeforeDelivery.inventory.stock).toBe(8);

    expect(variantBeforeDelivery.inventory.reservedStock).toBe(0);

    const ledgerBeforeDelivery = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerBeforeDelivery).toHaveLength(2);

    expect(ledgerBeforeDelivery.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    /*
    |--------------------------------------------------------------------------
    | Deliver
    |--------------------------------------------------------------------------
    */

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({});

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement delivered successfully",
    );

    const deliveredReplacement = response.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | API Delivery State
    |--------------------------------------------------------------------------
    */

    expect(deliveredReplacement.status).toBe("delivered");

    expect(deliveredReplacement.shipment.deliveredBy).toBe(String(admin._id));

    expect(deliveredReplacement.shipment.deliveredAt).toBeTruthy();

    /*
     * Existing shipment information must remain.
     */

    expect(deliveredReplacement.shipment.carrier).toBe(
      shippedReplacement.shipment.carrier,
    );

    expect(deliveredReplacement.shipment.trackingNumber).toBe(
      shippedReplacement.shipment.trackingNumber,
    );

    expect(deliveredReplacement.shipment.shippedAt).toBe(
      shippedReplacement.shipment.shippedAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Stored Delivery
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("delivered");

    expect(String(storedReplacement.shipment.deliveredBy)).toBe(
      String(admin._id),
    );

    expect(storedReplacement.shipment.deliveredAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Inventory Must Not Change
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
    | Ledger Must Not Change
    |--------------------------------------------------------------------------
    */

    const ledgerAfterDelivery = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfterDelivery).toHaveLength(2);

    expect(ledgerAfterDelivery.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    /*
    |--------------------------------------------------------------------------
    | Original Return Remains Completed
    |--------------------------------------------------------------------------
    */

    const unchangedReturn = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturn.status).toBe("completed");
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Delivery
  |--------------------------------------------------------------------------
  */

  it("rejects delivering the same replacement twice", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/deliver`;

    const firstResponse = await adminAgent.post(url).send({});

    expect(firstResponse.status).toBe(200);

    const firstDeliveredAt =
      firstResponse.body.data.replacement.shipment.deliveredAt;

    const secondResponse = await adminAgent.post(url).send({});

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_DELIVERED",
    );

    /*
    |--------------------------------------------------------------------------
    | Original Delivery Audit Preserved
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("delivered");

    expect(storedReplacement.shipment.deliveredAt.toISOString()).toBe(
      firstDeliveredAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Inventory Still Committed Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Corrupted Shipment Evidence
  |--------------------------------------------------------------------------
  */

  it("rejects delivery when required shipment evidence is missing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Corrupt Shipment Evidence
    |--------------------------------------------------------------------------
    |
    | Keep:
    |
    | status = shipped
    |
    | but remove evidence required for delivery.
    |--------------------------------------------------------------------------
    */

    await OrderReturnReplacement.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(replacement.id),
      },

      {
        $set: {
          "shipment.shippedAt": null,
        },
      },
    );

    const ledgerCountBefore = await ProductInventoryLedger.countDocuments({
      referenceId: replacement.replacementNumber,
    });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({});

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_DELIVERY_SHIPMENT_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | Replacement Must Remain Shipped
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("shipped");

    expect(unchangedReplacement.shipment.deliveredAt).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Product Must Remain Already Committed
    |--------------------------------------------------------------------------
    */

    const unchangedProduct = await Product.findById(product._id).lean();

    const unchangedVariant = findProductVariant(unchangedProduct, variant._id);

    expect(unchangedVariant.inventory.stock).toBe(8);

    expect(unchangedVariant.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | No Delivery Ledger
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,
      }),
    ).toBe(ledgerCountBefore);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Delivery
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent replacement delivery", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: secondAdminAgent,

      user: secondAdmin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/deliver`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({}),

      secondAdminAgent.post(url).send({}),
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

    expect(conflictResponses[0].body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_DELIVERED",
    );

    /*
    |--------------------------------------------------------------------------
    | Exactly One Delivery Audit
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("delivered");

    expect(storedReplacement.shipment.deliveredAt).toBeTruthy();

    expect([String(firstAdmin._id), String(secondAdmin._id)]).toContain(
      String(storedReplacement.shipment.deliveredBy),
    );

    /*
    |--------------------------------------------------------------------------
    | Inventory Must Stay Committed Exactly Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,
      }),
    ).toBe(2);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Cancellation
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement cancellation", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when cancelling a replacement without authentication", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/cancel`)
      .send({
        reason: "Replacement is no longer required.",
      });

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to cancel a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/cancel`)
      .send({
        reason: "Replacement is no longer required.",
      });

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Replacement ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when the cancellation replacement ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post(
        "/api/v1/admin/order-return-replacements/not-a-valid-object-id/cancel",
      )
      .send({
        reason: "Replacement is no longer required.",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid and backend-controlled cancellation fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/cancel`)
      .send({
        reason: "No",

        status: "cancelled",

        cancelledBy: new mongoose.Types.ObjectId().toString(),

        cancelledAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the replacement does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/cancel`)
      .send({
        reason: "Replacement is no longer required.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Reserved Replacement Cancellation
  |--------------------------------------------------------------------------
  */

  it("cancels a reserved replacement and releases its inventory reservation", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Before Cancellation
    |--------------------------------------------------------------------------
    */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    expect(replacement.status).toBe("reserved");

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Cancel
    |--------------------------------------------------------------------------
    */

    const cancellationData = {
      reason: "Customer no longer requires the replacement.",

      note: "Cancelled before warehouse processing started.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send(cancellationData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement cancelled successfully",
    );

    const cancelledReplacement = response.body.data.replacement;

    expect(cancelledReplacement.status).toBe("cancelled");

    expect(cancelledReplacement.cancellation).toMatchObject({
      reason: cancellationData.reason,

      note: cancellationData.note,

      cancelledBy: String(admin._id),
    });

    expect(cancelledReplacement.cancellation.cancelledAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Inventory Release
    |--------------------------------------------------------------------------
    */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(10);

    expect(variantAfter.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Reserve → Release Ledger
    |--------------------------------------------------------------------------
    */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "release",
    ]);

    const releaseLedger = ledgerEntries[1];

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

    expect(String(releaseLedger.actor)).toBe(String(admin._id));
  });

  /*
  |--------------------------------------------------------------------------
  | Processing Replacement Cancellation
  |--------------------------------------------------------------------------
  */

  it("allows cancellation while the replacement is processing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Replacement fulfilment was cancelled before dispatch.",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.replacement.status).toBe("cancelled");

    /*
     * Processing does not consume the reservation,
     * therefore cancellation must release it.
     */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Cancellation
  |--------------------------------------------------------------------------
  */

  it("rejects cancelling the same replacement twice without releasing inventory twice", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/cancel`;

    await adminAgent
      .post(url)
      .send({
        reason: "First valid replacement cancellation.",
      })
      .expect(200);

    const secondResponse = await adminAgent.post(url).send({
      reason: "Second duplicate replacement cancellation.",
    });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_CANCELLED",
    );

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Shipped Replacement Cannot Be Cancelled
  |--------------------------------------------------------------------------
  */

  it("rejects cancellation after the replacement has been shipped", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Attempt cancellation after shipment.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_CANCELLATION_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("shipped");

    /*
     * Shipment already committed the replacement.
     * Cancellation must NOT restore or release anything.
     */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Corrupted Reserved Inventory
  |--------------------------------------------------------------------------
  */

  it("rolls back cancellation when the Product reservation is missing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
     * Replacement owns reservation = 2,
     * but deliberately corrupt Product inventory.
     */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Cancellation inventory rollback test.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_STATE_INVALID",
    );

    /*
     * Replacement cancellation must roll back.
     */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("processing");

    expect(unchangedReplacement.cancellation?.cancelledAt ?? null).toBeNull();

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Multi-Item Rollback
  |--------------------------------------------------------------------------
  */

  it("rolls back an earlier reservation release when a later replacement item fails", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-CANCEL-FIRST",

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

        {
          sku: "RPL-CANCEL-SECOND",

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

    const firstVariant = product.variants[0];

    const secondVariant = product.variants[1];

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant: firstVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },

        {
          product,

          variant: secondVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    const creationResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({})
      .expect(201);

    const replacement = creationResponse.body.data.replacement;

    /*
     * Both variants now have reservedStock = 2.
     */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": secondVariant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Multi-item cancellation rollback test.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | First Release Must Roll Back
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalFirstVariant = findProductVariant(
      finalProduct,
      firstVariant._id,
    );

    const finalSecondVariant = findProductVariant(
      finalProduct,
      secondVariant._id,
    );

    expect(finalFirstVariant.inventory.stock).toBe(10);

    expect(finalFirstVariant.inventory.reservedStock).toBe(2);

    /*
     * Existing corruption stays as it was.
     */

    expect(finalSecondVariant.inventory.stock).toBe(10);

    expect(finalSecondVariant.inventory.reservedStock).toBe(0);

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("reserved");

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);

    /*
     * Original two reservation Ledger entries remain.
     */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Cancellation
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent replacement cancellation and releases inventory once", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/cancel`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({
        reason: "Concurrent cancellation from first admin.",
      }),

      secondAdminAgent.post(url).send({
        reason: "Concurrent cancellation from second admin.",
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
      "ORDER_RETURN_REPLACEMENT_ALREADY_CANCELLED",
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_CONFLICT",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
    |--------------------------------------------------------------------------
    | Inventory Released Exactly Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Exactly One Cancelled Replacement State
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("cancelled");

    expect(storedReplacement.cancellation.cancelledAt).toBeTruthy();
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Failure
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement failure", () => {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when failing a replacement without authentication", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/fail`)
      .send({
        reason: "Replacement fulfillment could not continue.",
      });

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer attempts to fail a replacement", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/fail`)
      .send({
        reason: "Replacement fulfillment could not continue.",
      });

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Replacement ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when the failure replacement ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent
      .post(
        "/api/v1/admin/order-return-replacements/not-a-valid-object-id/fail",
      )
      .send({
        reason: "Replacement fulfillment could not continue.",
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid and backend-controlled failure fields", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/fail`)
      .send({
        reason: "No",

        status: "failed",

        failedBy: new mongoose.Types.ObjectId().toString(),

        failedAt: new Date().toISOString(),
      });

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when the failed replacement does not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacementId}/fail`)
      .send({
        reason: "Replacement fulfillment could not continue.",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Reserved -> Failed
  |--------------------------------------------------------------------------
  */

  it("fails a reserved replacement and releases its reserved inventory", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant, returnRequest } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Before Failure
    |--------------------------------------------------------------------------
    */

    const productBeforeFailure = await Product.findById(product._id).lean();

    const variantBeforeFailure = findProductVariant(
      productBeforeFailure,
      variant._id,
    );

    expect(replacement.status).toBe("reserved");

    expect(variantBeforeFailure.inventory.stock).toBe(10);

    expect(variantBeforeFailure.inventory.reservedStock).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Fail Replacement
    |--------------------------------------------------------------------------
    */

    const failureData = {
      reason: "Replacement fulfillment could not continue.",

      note: "Reserved units were unsuitable for dispatch.",
    };

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send(failureData);

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement marked as failed successfully",
    );

    const failedReplacement = response.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | Failure State
    |--------------------------------------------------------------------------
    */

    expect(failedReplacement.status).toBe("failed");

    expect(failedReplacement.failure).toMatchObject({
      reason: failureData.reason,

      note: failureData.note,

      failedBy: String(admin._id),
    });

    expect(failedReplacement.failure.failedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Stored Replacement
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("failed");

    expect(storedReplacement.failure.reason).toBe(failureData.reason);

    expect(String(storedReplacement.failure.failedBy)).toBe(String(admin._id));

    expect(storedReplacement.failure.failedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Inventory Released
    |--------------------------------------------------------------------------
    */

    const productAfterFailure = await Product.findById(product._id).lean();

    const variantAfterFailure = findProductVariant(
      productAfterFailure,
      variant._id,
    );

    expect(variantAfterFailure.inventory.stock).toBe(10);

    expect(variantAfterFailure.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Reserve -> Release Ledger
    |--------------------------------------------------------------------------
    */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "release",
    ]);

    const releaseLedger = ledgerEntries[1];

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

    expect(String(releaseLedger.actor)).toBe(String(admin._id));

    /*
    |--------------------------------------------------------------------------
    | Return Request Remains Completed
    |--------------------------------------------------------------------------
    */

    const unchangedReturn = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    expect(unchangedReturn.status).toBe("completed");
  });

  /*
  |--------------------------------------------------------------------------
  | Processing -> Failed
  |--------------------------------------------------------------------------
  */

  it("allows a processing replacement to fail and releases its reservation", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Warehouse could not complete replacement fulfillment.",

        note: "Failure occurred before dispatch.",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.replacement.status).toBe("failed");

    /*
     * Processing does not commit inventory,
     * so the existing reservation must be released.
     */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Duplicate Failure
  |--------------------------------------------------------------------------
  */

  it("rejects failing the same replacement twice without releasing inventory twice", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/fail`;

    const firstResponse = await adminAgent.post(url).send({
      reason: "Initial replacement fulfillment failure.",
    });

    expect(firstResponse.status).toBe(200);

    const firstFailedAt = firstResponse.body.data.replacement.failure.failedAt;

    const secondResponse = await adminAgent.post(url).send({
      reason: "Duplicate replacement fulfillment failure.",
    });

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_ALREADY_FAILED",
    );

    /*
    |--------------------------------------------------------------------------
    | Original Failure Audit Preserved
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("failed");

    expect(storedReplacement.failure.failedAt.toISOString()).toBe(
      firstFailedAt,
    );

    /*
    |--------------------------------------------------------------------------
    | Reservation Released Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Shipped Replacement Cannot Fail
  |--------------------------------------------------------------------------
  */

  it("rejects failure after replacement inventory has been committed for shipment", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Attempt to fail replacement after shipment.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_FAILURE_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("shipped");

    /*
     * Shipment committed inventory already.
     * Failure must not release anything.
     */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Delivered Replacement Cannot Fail
  |--------------------------------------------------------------------------
  */

  it("rejects failure after the replacement has been delivered", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({})
      .expect(200);

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Attempt to fail replacement after delivery.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_FAILURE_STATUS_INVALID",
    );

    expect(response.body.details.currentStatus).toBe("delivered");

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(8);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Corrupted Reservation
  |--------------------------------------------------------------------------
  */

  it("rolls back failure when the reserved Product inventory is missing", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
     * Replacement owns reservation quantity = 2.
     *
     * Corrupt persisted Product inventory directly.
     */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": variant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Inventory state failure rollback test.",
      });

    expect(response.status).toBe(409);

    /*
     * Part 158 reuses the Part 156 release diagnostics.
     */

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | Replacement Must Not Become Failed
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("processing");

    expect(unchangedReplacement.failure?.failedAt ?? null).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | No Release Ledger
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);
  });

  /*
  |--------------------------------------------------------------------------
  | Multi-Item Failure Rollback
  |--------------------------------------------------------------------------
  */

  it("rolls back an earlier reservation release when a later failure item cannot be released", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,

      variants: [
        {
          sku: "RPL-FAIL-FIRST",

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

        {
          sku: "RPL-FAIL-SECOND",

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

    const firstVariant = product.variants[0];

    const secondVariant = product.variants[1];

    /*
    |--------------------------------------------------------------------------
    | Create Completed Two-Item Replacement Return
    |--------------------------------------------------------------------------
    */

    const returnRequest = await createCompletedReplacementReturnFixture({
      customerId: customer._id,

      adminId: admin._id,

      items: [
        {
          product,

          variant: firstVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },

        {
          product,

          variant: secondVariant,

          quantity: 2,

          resellableQuantity: 1,

          damagedQuantity: 1,

          rejectedQuantity: 0,
        },
      ],
    });

    /*
    |--------------------------------------------------------------------------
    | Reserve Both Replacement Items
    |--------------------------------------------------------------------------
    */

    const creationResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({})
      .expect(201);

    const replacement = creationResponse.body.data.replacement;

    /*
    |--------------------------------------------------------------------------
    | Corrupt Second Reservation
    |--------------------------------------------------------------------------
    */

    await Product.collection.updateOne(
      {
        _id: product._id,

        "variants._id": secondVariant._id,
      },

      {
        $set: {
          "variants.$.inventory.reservedStock": 0,
        },
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Fail Replacement
    |--------------------------------------------------------------------------
    */

    const response = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Multi-item replacement failure rollback test.",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_STATE_INVALID",
    );

    /*
    |--------------------------------------------------------------------------
    | First Release Must Roll Back
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalFirstVariant = findProductVariant(
      finalProduct,
      firstVariant._id,
    );

    const finalSecondVariant = findProductVariant(
      finalProduct,
      secondVariant._id,
    );

    expect(finalFirstVariant.inventory.stock).toBe(10);

    expect(finalFirstVariant.inventory.reservedStock).toBe(2);

    /*
     * Deliberate second-item corruption remains.
     */

    expect(finalSecondVariant.inventory.stock).toBe(10);

    expect(finalSecondVariant.inventory.reservedStock).toBe(0);

    /*
    |--------------------------------------------------------------------------
    | Replacement State Rolled Back
    |--------------------------------------------------------------------------
    */

    const unchangedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(unchangedReplacement.status).toBe("reserved");

    expect(unchangedReplacement.failure?.failedAt ?? null).toBeNull();

    /*
    |--------------------------------------------------------------------------
    | Release Ledgers Must Roll Back
    |--------------------------------------------------------------------------
    */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "reserve",
      }),
    ).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Concurrent Failure
  |--------------------------------------------------------------------------
  */

  it("allows only one concurrent replacement failure and releases inventory once", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const url = `/api/v1/admin/order-return-replacements/${replacement.id}/fail`;

    const [firstResponse, secondResponse] = await Promise.all([
      firstAdminAgent.post(url).send({
        reason: "Concurrent fulfillment failure from first admin.",
      }),

      secondAdminAgent.post(url).send({
        reason: "Concurrent fulfillment failure from second admin.",
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
      "ORDER_RETURN_REPLACEMENT_ALREADY_FAILED",
      "ORDER_RETURN_REPLACEMENT_RELEASE_INVENTORY_CONFLICT",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
    |--------------------------------------------------------------------------
    | Inventory Released Exactly Once
    |--------------------------------------------------------------------------
    */

    const finalProduct = await Product.findById(product._id).lean();

    const finalVariant = findProductVariant(finalProduct, variant._id);

    expect(finalVariant.inventory.stock).toBe(10);

    expect(finalVariant.inventory.reservedStock).toBe(0);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);

    /*
    |--------------------------------------------------------------------------
    | Final Failure State
    |--------------------------------------------------------------------------
    */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("failed");

    expect(storedReplacement.failure.failedAt).toBeTruthy();

    expect(String(storedReplacement.failure.failedBy)).toBeTruthy();

    /*
     * One reserve + one release.
     */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,
      }),
    ).toBe(2);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Read APIs
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement read APIs", () => {
  /*
  |--------------------------------------------------------------------------
  | List Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when replacement list is requested without authentication", async () => {
    const response = await request(app).get(
      "/api/v1/admin/order-return-replacements",
    );

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | List Authorization
  |--------------------------------------------------------------------------
  */

  it("returns 403 when a customer requests the admin replacement list", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get(
      "/api/v1/admin/order-return-replacements",
    );

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Default List + Summary Mapper
  |--------------------------------------------------------------------------
  */

  it("returns paginated replacement summaries for admins", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const firstReplacement = await createAdminOrderReturnReplacementReadFixture(
      {
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber: "RPL-READ-SUMMARY-A",

        replacementQuantities: [1, 2],
      },
    );

    const secondReplacement =
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber: "RPL-READ-SUMMARY-B",

        status: "processing",

        replacementQuantities: [3],
      });

    const response = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?sortBy=replacementNumber&sortDirection=asc",
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Admin Return replacements retrieved successfully",
    );

    const { replacements, pagination } = response.body.data;

    expect(replacements).toHaveLength(2);

    expect(
      replacements.map((replacement) => replacement.replacementNumber),
    ).toEqual(["RPL-READ-SUMMARY-A", "RPL-READ-SUMMARY-B"]);

    /*
    |--------------------------------------------------------------------------
    | Summary Shape
    |--------------------------------------------------------------------------
    */

    expect(replacements[0]).toMatchObject({
      id: String(firstReplacement._id),

      replacementNumber: "RPL-READ-SUMMARY-A",

      status: "reserved",

      itemCount: 2,

      totalReplacementQuantity: 3,

      customerId: String(customer._id),
    });

    expect(replacements[0].reservedAt).toBeTruthy();

    expect(replacements[1]).toMatchObject({
      id: String(secondReplacement._id),

      status: "processing",

      itemCount: 1,

      totalReplacementQuantity: 3,
    });

    expect(replacements[1].processedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    */

    expect(pagination).toEqual({
      page: 1,

      limit: 20,

      total: 2,

      totalPages: 1,

      hasPreviousPage: false,

      hasNextPage: false,
    });

    /*
     * Summary response should not include
     * complete replacement item snapshots.
     */

    expect(replacements[0].items).toBeUndefined();

    expect(replacements[0].reservation).toBeUndefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Pagination
  |--------------------------------------------------------------------------
  */

  it("paginates replacement results correctly", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    for (const replacementNumber of [
      "RPL-PAGE-A",
      "RPL-PAGE-B",
      "RPL-PAGE-C",
    ]) {
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber,
      });
    }

    const response = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?page=2&limit=2&sortBy=replacementNumber&sortDirection=asc",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacements).toHaveLength(1);

    expect(response.body.data.replacements[0].replacementNumber).toBe(
      "RPL-PAGE-C",
    );

    expect(response.body.data.pagination).toEqual({
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
  | Status Filter
  |--------------------------------------------------------------------------
  */

  it("filters replacements by status", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-STATUS-RESERVED",

      status: "reserved",
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-STATUS-FAILED",

      status: "failed",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?status=failed",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacements).toHaveLength(1);

    expect(response.body.data.replacements[0]).toMatchObject({
      replacementNumber: "RPL-STATUS-FAILED",

      status: "failed",
    });

    expect(response.body.data.replacements[0].failedAt).toBeTruthy();

    expect(response.body.data.pagination.total).toBe(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  it("searches replacements by replacement, Return, and Order reference numbers", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-SEARCH-ALPHA",

      returnRequestNumber: "RET-SEARCH-BRAVO",

      orderNumber: "ORD-SEARCH-CHARLIE",
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-UNRELATED",

      returnRequestNumber: "RET-UNRELATED",

      orderNumber: "ORD-UNRELATED",
    });

    const replacementSearch = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?search=SEARCH-ALPHA",
    );

    expect(replacementSearch.status).toBe(200);

    expect(replacementSearch.body.data.replacements).toHaveLength(1);

    expect(replacementSearch.body.data.replacements[0].replacementNumber).toBe(
      "RPL-SEARCH-ALPHA",
    );

    const returnSearch = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?search=SEARCH-BRAVO",
    );

    expect(returnSearch.body.data.replacements).toHaveLength(1);

    expect(returnSearch.body.data.replacements[0].returnRequestNumber).toBe(
      "RET-SEARCH-BRAVO",
    );

    const orderSearch = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?search=SEARCH-CHARLIE",
    );

    expect(orderSearch.body.data.replacements).toHaveLength(1);

    expect(orderSearch.body.data.replacements[0].orderNumber).toBe(
      "ORD-SEARCH-CHARLIE",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Customer + Order Filters
  |--------------------------------------------------------------------------
  */

  it("filters replacements by customer and Order IDs", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: firstCustomer } = await createAuthenticatedCustomerAgent();

    const { user: secondCustomer } = await createAuthenticatedCustomerAgent();

    const firstOrderId = new mongoose.Types.ObjectId();

    const secondOrderId = new mongoose.Types.ObjectId();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: firstCustomer._id,

      adminId: admin._id,

      orderId: firstOrderId,

      replacementNumber: "RPL-FILTER-FIRST",
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: secondCustomer._id,

      adminId: admin._id,

      orderId: secondOrderId,

      replacementNumber: "RPL-FILTER-SECOND",
    });

    /*
    |--------------------------------------------------------------------------
    | Customer Filter
    |--------------------------------------------------------------------------
    */

    const customerResponse = await adminAgent.get(
      `/api/v1/admin/order-return-replacements?customerId=${firstCustomer._id}`,
    );

    expect(customerResponse.status).toBe(200);

    expect(customerResponse.body.data.replacements).toHaveLength(1);

    expect(customerResponse.body.data.replacements[0].replacementNumber).toBe(
      "RPL-FILTER-FIRST",
    );

    /*
    |--------------------------------------------------------------------------
    | Order Filter
    |--------------------------------------------------------------------------
    */

    const orderResponse = await adminAgent.get(
      `/api/v1/admin/order-return-replacements?orderId=${secondOrderId}`,
    );

    expect(orderResponse.status).toBe(200);

    expect(orderResponse.body.data.replacements).toHaveLength(1);

    expect(orderResponse.body.data.replacements[0].replacementNumber).toBe(
      "RPL-FILTER-SECOND",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Sorting
  |--------------------------------------------------------------------------
  */

  it("sorts replacement results using the requested field and direction", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    for (const replacementNumber of [
      "RPL-SORT-C",
      "RPL-SORT-A",
      "RPL-SORT-B",
    ]) {
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber,
      });
    }

    const ascending = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?sortBy=replacementNumber&sortDirection=asc",
    );

    expect(ascending.status).toBe(200);

    expect(
      ascending.body.data.replacements.map(
        (replacement) => replacement.replacementNumber,
      ),
    ).toEqual(["RPL-SORT-A", "RPL-SORT-B", "RPL-SORT-C"]);

    const descending = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?sortBy=replacementNumber&sortDirection=desc",
    );

    expect(
      descending.body.data.replacements.map(
        (replacement) => replacement.replacementNumber,
      ),
    ).toEqual(["RPL-SORT-C", "RPL-SORT-B", "RPL-SORT-A"]);
  });

  /*
  |--------------------------------------------------------------------------
  | Strict List Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid replacement list filters", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const invalidStatusResponse = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?status=not-a-real-status",
    );

    expect(invalidStatusResponse.status).toBe(400);

    expect(invalidStatusResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidCustomerResponse = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?customerId=invalid-id",
    );

    expect(invalidCustomerResponse.status).toBe(400);

    const unknownQueryResponse = await adminAgent.get(
      "/api/v1/admin/order-return-replacements?unknownField=value",
    );

    expect(unknownQueryResponse.status).toBe(400);
  });

  /*
  |--------------------------------------------------------------------------
  | Details Authentication / Authorization
  |--------------------------------------------------------------------------
  */

  it("protects replacement details from unauthenticated and customer requests", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const unauthenticatedResponse = await request(app).get(
      `/api/v1/admin/order-return-replacements/${replacementId}`,
    );

    expect(unauthenticatedResponse.status).toBe(401);

    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const customerResponse = await customerAgent.get(
      `/api/v1/admin/order-return-replacements/${replacementId}`,
    );

    expect(customerResponse.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Full Details
  |--------------------------------------------------------------------------
  */

  it("returns full replacement lifecycle details to an admin", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-DETAILS-FAILED",

      returnRequestNumber: "RET-DETAILS-FAILED",

      orderNumber: "ORD-DETAILS-FAILED",

      status: "failed",

      replacementQuantities: [1, 2],
    });

    const response = await adminAgent.get(
      `/api/v1/admin/order-return-replacements/${replacement._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Admin Return replacement retrieved successfully",
    );

    const responseReplacement = response.body.data.replacement;

    expect(responseReplacement).toMatchObject({
      id: String(replacement._id),

      replacementNumber: "RPL-DETAILS-FAILED",

      returnRequestNumber: "RET-DETAILS-FAILED",

      orderNumber: "ORD-DETAILS-FAILED",

      customerId: String(customer._id),

      status: "failed",
    });

    /*
    |--------------------------------------------------------------------------
    | Items
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.items).toHaveLength(2);

    expect(responseReplacement.items[0].replacementQuantity).toBe(1);

    expect(responseReplacement.items[1].replacementQuantity).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Reservation
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.reservation.reservedBy).toBe(String(admin._id));

    expect(responseReplacement.reservation.reservedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Processing
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.processing.processedBy).toBe(String(admin._id));

    expect(responseReplacement.processing.processedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Failure
    |--------------------------------------------------------------------------
    |
    | This also verifies the Part 158 mapper correction:
    |
    | failedBy: normalizeId(failure.failedBy)
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.failure).toMatchObject({
      reason: "Replacement fulfillment failed.",

      note: "Failure test fixture.",

      failedBy: String(admin._id),
    });

    expect(responseReplacement.failure.failedAt).toBeTruthy();

    expect(responseReplacement.createdAt).toBeTruthy();

    expect(responseReplacement.updatedAt).toBeTruthy();
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Details ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when replacement details ID is invalid", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get(
      "/api/v1/admin/order-return-replacements/not-a-valid-object-id",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Details
  |--------------------------------------------------------------------------
  */

  it("returns 404 when replacement details do not exist", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await adminAgent.get(
      `/api/v1/admin/order-return-replacements/${replacementId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Read APIs Must Not Mutate Inventory
  |--------------------------------------------------------------------------
  */

  it("does not mutate Product inventory or inventory Ledger while reading replacements", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
     * Use real replacement creation here because we want
     * a genuine Product reservation + Inventory Ledger.
     */

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Before Reads
    |--------------------------------------------------------------------------
    */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    expect(ledgerBefore).toHaveLength(1);

    expect(ledgerBefore[0].operation).toBe("reserve");

    /*
    |--------------------------------------------------------------------------
    | Read List
    |--------------------------------------------------------------------------
    */

    await adminAgent.get("/api/v1/admin/order-return-replacements").expect(200);

    /*
    |--------------------------------------------------------------------------
    | Read Details
    |--------------------------------------------------------------------------
    */

    await adminAgent
      .get(`/api/v1/admin/order-return-replacements/${replacement.id}`)
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | After Reads
    |--------------------------------------------------------------------------
    */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });
});

/*
|--------------------------------------------------------------------------
| Customer Return Replacement Read APIs
|--------------------------------------------------------------------------
*/

describe("Customer Return replacement read APIs", () => {
  /*
  |--------------------------------------------------------------------------
  | List Authentication
  |--------------------------------------------------------------------------
  */

  it("returns 401 when replacement list is requested without authentication", async () => {
    const response = await request(app).get("/api/v1/orders/replacements");

    expect(response.status).toBe(401);
  });

  /*
  |--------------------------------------------------------------------------
  | Admin Cannot Use Customer Replacement API
  |--------------------------------------------------------------------------
  */

  it("returns 403 when an admin requests the customer replacement list", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get("/api/v1/orders/replacements");

    expect(response.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Customer Ownership + Summary Privacy
  |--------------------------------------------------------------------------
  */

  it("returns only replacements owned by the authenticated customer", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: firstCustomerAgent,

      user: firstCustomer,
    } = await createAuthenticatedCustomerAgent();

    const { user: secondCustomer } = await createAuthenticatedCustomerAgent();

    /*
    |--------------------------------------------------------------------------
    | First Customer Replacements
    |--------------------------------------------------------------------------
    */

    await createAdminOrderReturnReplacementReadFixture({
      customerId: firstCustomer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-OWN-A",

      status: "reserved",

      replacementQuantities: [1, 2],
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: firstCustomer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-OWN-B",

      status: "processing",

      replacementQuantities: [3],
    });

    /*
    |--------------------------------------------------------------------------
    | Another Customer Replacement
    |--------------------------------------------------------------------------
    */

    await createAdminOrderReturnReplacementReadFixture({
      customerId: secondCustomer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-OTHER",

      status: "reserved",
    });

    const response = await firstCustomerAgent.get(
      "/api/v1/orders/replacements?sortBy=replacementNumber&sortDirection=asc",
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacements retrieved successfully",
    );

    const { replacements, pagination } = response.body.data;

    expect(replacements).toHaveLength(2);

    expect(
      replacements.map((replacement) => replacement.replacementNumber),
    ).toEqual(["RPL-CUSTOMER-OWN-A", "RPL-CUSTOMER-OWN-B"]);

    /*
    |--------------------------------------------------------------------------
    | Customer Summary
    |--------------------------------------------------------------------------
    */

    expect(replacements[0]).toMatchObject({
      replacementNumber: "RPL-CUSTOMER-OWN-A",

      status: "reserved",

      itemCount: 2,

      totalReplacementQuantity: 3,
    });

    expect(replacements[1]).toMatchObject({
      replacementNumber: "RPL-CUSTOMER-OWN-B",

      status: "processing",

      itemCount: 1,

      totalReplacementQuantity: 3,
    });

    /*
    |--------------------------------------------------------------------------
    | Internal Information Must Not Be Exposed
    |--------------------------------------------------------------------------
    */

    expect(replacements[0].customerId).toBeUndefined();

    expect(replacements[0].reservation).toBeUndefined();

    expect(replacements[0].processing).toBeUndefined();

    expect(replacements[0].shipment).toBeUndefined();

    expect(replacements[0].items).toBeUndefined();

    expect(pagination.total).toBe(2);
  });

  /*
  |--------------------------------------------------------------------------
  | Pagination
  |--------------------------------------------------------------------------
  */

  it("paginates customer replacement history", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    for (const replacementNumber of [
      "RPL-CUST-PAGE-A",
      "RPL-CUST-PAGE-B",
      "RPL-CUST-PAGE-C",
    ]) {
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber,
      });
    }

    const response = await customerAgent.get(
      "/api/v1/orders/replacements?page=2&limit=2&sortBy=replacementNumber&sortDirection=asc",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacements).toHaveLength(1);

    expect(response.body.data.replacements[0].replacementNumber).toBe(
      "RPL-CUST-PAGE-C",
    );

    expect(response.body.data.pagination).toEqual({
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
  | Status Filter
  |--------------------------------------------------------------------------
  */

  it("filters customer replacements by status without exposing other customers", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { user: otherCustomer } = await createAuthenticatedCustomerAgent();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUST-RESERVED",

      status: "reserved",
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUST-SHIPPED",

      status: "shipped",
    });

    /*
     * Same status but owned by another customer.
     */

    await createAdminOrderReturnReplacementReadFixture({
      customerId: otherCustomer._id,

      adminId: admin._id,

      replacementNumber: "RPL-OTHER-SHIPPED",

      status: "shipped",
    });

    const response = await customerAgent.get(
      "/api/v1/orders/replacements?status=shipped",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacements).toHaveLength(1);

    expect(response.body.data.replacements[0]).toMatchObject({
      replacementNumber: "RPL-CUST-SHIPPED",

      status: "shipped",
    });

    expect(response.body.data.replacements[0].shippedAt).toBeTruthy();
  });

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  it("searches the customer's replacement, Return, and Order references", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUST-SEARCH-ALPHA",

      returnRequestNumber: "RET-CUST-SEARCH-BRAVO",

      orderNumber: "ORD-CUST-SEARCH-CHARLIE",
    });

    const replacementSearch = await customerAgent.get(
      "/api/v1/orders/replacements?search=SEARCH-ALPHA",
    );

    expect(replacementSearch.status).toBe(200);

    expect(replacementSearch.body.data.replacements).toHaveLength(1);

    const returnSearch = await customerAgent.get(
      "/api/v1/orders/replacements?search=SEARCH-BRAVO",
    );

    expect(returnSearch.body.data.replacements).toHaveLength(1);

    const orderSearch = await customerAgent.get(
      "/api/v1/orders/replacements?search=SEARCH-CHARLIE",
    );

    expect(orderSearch.body.data.replacements).toHaveLength(1);
  });

  /*
  |--------------------------------------------------------------------------
  | Order Filter
  |--------------------------------------------------------------------------
  */

  it("filters customer replacements by Order ID", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const firstOrderId = new mongoose.Types.ObjectId();

    const secondOrderId = new mongoose.Types.ObjectId();

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      orderId: firstOrderId,

      replacementNumber: "RPL-CUST-ORDER-A",
    });

    await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      orderId: secondOrderId,

      replacementNumber: "RPL-CUST-ORDER-B",
    });

    const response = await customerAgent.get(
      `/api/v1/orders/replacements?orderId=${secondOrderId}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacements).toHaveLength(1);

    expect(response.body.data.replacements[0].replacementNumber).toBe(
      "RPL-CUST-ORDER-B",
    );
  });

  /*
  |--------------------------------------------------------------------------
  | Strict Query Validation
  |--------------------------------------------------------------------------
  */

  it("rejects invalid customer replacement list filters", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const invalidStatusResponse = await customerAgent.get(
      "/api/v1/orders/replacements?status=invalid-status",
    );

    expect(invalidStatusResponse.status).toBe(400);

    expect(invalidStatusResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    const invalidOrderResponse = await customerAgent.get(
      "/api/v1/orders/replacements?orderId=invalid-id",
    );

    expect(invalidOrderResponse.status).toBe(400);

    const unknownFieldResponse = await customerAgent.get(
      "/api/v1/orders/replacements?customerId=123456789012345678901234",
    );

    /*
     * Customer may not choose customerId.
     *
     * Ownership always comes from request.user._id.
     */

    expect(unknownFieldResponse.status).toBe(400);
  });

  /*
  |--------------------------------------------------------------------------
  | Details Authentication / Authorization
  |--------------------------------------------------------------------------
  */

  it("protects customer replacement details from unauthenticated and admin requests", async () => {
    const replacementId = new mongoose.Types.ObjectId();

    const unauthenticatedResponse = await request(app).get(
      `/api/v1/orders/replacements/${replacementId}`,
    );

    expect(unauthenticatedResponse.status).toBe(401);

    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const adminResponse = await adminAgent.get(
      `/api/v1/orders/replacements/${replacementId}`,
    );

    expect(adminResponse.status).toBe(403);
  });

  /*
  |--------------------------------------------------------------------------
  | Shipped Replacement Details
  |--------------------------------------------------------------------------
  */

  it("returns customer-safe shipment tracking while hiding internal admin information", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-SHIPPED-DETAILS",

      returnRequestNumber: "RET-CUSTOMER-SHIPPED",

      orderNumber: "ORD-CUSTOMER-SHIPPED",

      status: "shipped",

      replacementQuantities: [2],
    });

    const response = await customerAgent.get(
      `/api/v1/orders/replacements/${replacement._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Return replacement retrieved successfully",
    );

    const responseReplacement = response.body.data.replacement;

    expect(responseReplacement).toMatchObject({
      id: String(replacement._id),

      replacementNumber: "RPL-CUSTOMER-SHIPPED-DETAILS",

      returnRequestNumber: "RET-CUSTOMER-SHIPPED",

      orderNumber: "ORD-CUSTOMER-SHIPPED",

      status: "shipped",
    });

    /*
    |--------------------------------------------------------------------------
    | Customer Item Snapshot
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.items).toHaveLength(1);

    expect(responseReplacement.items[0].replacementQuantity).toBe(2);

    /*
    |--------------------------------------------------------------------------
    | Customer Lifecycle
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.reservation.reservedAt).toBeTruthy();

    expect(responseReplacement.processing.processedAt).toBeTruthy();

    expect(responseReplacement.shipment).toMatchObject({
      carrier: "Blue Dart",

      trackingNumber: expect.any(String),

      trackingUrl: expect.any(String),

      deliveredAt: null,
    });

    expect(responseReplacement.shipment.shippedAt).toBeTruthy();

    /*
    |--------------------------------------------------------------------------
    | Internal Fields MUST Be Hidden
    |--------------------------------------------------------------------------
    */

    expect(responseReplacement.customerId).toBeUndefined();

    expect(responseReplacement.reservation.reservedBy).toBeUndefined();

    expect(responseReplacement.processing.processedBy).toBeUndefined();

    expect(responseReplacement.processing.note).toBeUndefined();

    expect(responseReplacement.shipment.shippedBy).toBeUndefined();

    expect(responseReplacement.shipment.deliveredBy).toBeUndefined();

    expect(responseReplacement.shipment.note).toBeUndefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Delivered Replacement
  |--------------------------------------------------------------------------
  */

  it("shows delivered replacement status and delivered timestamp", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-DELIVERED",

      status: "delivered",
    });

    const response = await customerAgent.get(
      `/api/v1/orders/replacements/${replacement._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.data.replacement.status).toBe("delivered");

    expect(response.body.data.replacement.shipment.deliveredAt).toBeTruthy();

    expect(response.body.data.replacement.shipment.deliveredBy).toBeUndefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Cancellation Customer Privacy
  |--------------------------------------------------------------------------
  */

  it("shows customer-safe cancellation information without internal cancellation audit fields", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-CANCELLED",

      status: "cancelled",
    });

    const response = await customerAgent.get(
      `/api/v1/orders/replacements/${replacement._id}`,
    );

    expect(response.status).toBe(200);

    const cancellation = response.body.data.replacement.cancellation;

    expect(cancellation.reason).toBe("Replacement cancelled for read testing.");

    expect(cancellation.cancelledAt).toBeTruthy();

    expect(cancellation.note).toBeUndefined();

    expect(cancellation.cancelledBy).toBeUndefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Failure Customer Privacy
  |--------------------------------------------------------------------------
  */

  it("shows customer-safe failure information without internal failure audit fields", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      replacementNumber: "RPL-CUSTOMER-FAILED",

      status: "failed",
    });

    const response = await customerAgent.get(
      `/api/v1/orders/replacements/${replacement._id}`,
    );

    expect(response.status).toBe(200);

    const failure = response.body.data.replacement.failure;

    expect(failure.reason).toBe("Replacement fulfillment failed.");

    expect(failure.failedAt).toBeTruthy();

    /*
     * Part 158 failedBy is intentionally
     * admin-only.
     */

    expect(failure.note).toBeUndefined();

    expect(failure.failedBy).toBeUndefined();
  });

  /*
  |--------------------------------------------------------------------------
  | Ownership Isolation
  |--------------------------------------------------------------------------
  */

  it("returns 404 when a customer requests another customer's replacement", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const { agent: firstCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const { user: secondCustomer } = await createAuthenticatedCustomerAgent();

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: secondCustomer._id,

      adminId: admin._id,

      replacementNumber: "RPL-OTHER-CUSTOMER-PRIVATE",
    });

    const response = await firstCustomerAgent.get(
      `/api/v1/orders/replacements/${replacement._id}`,
    );

    /*
     * Do not return 403.
     *
     * 404 avoids revealing that another
     * customer's replacement exists.
     */

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Invalid Details ID
  |--------------------------------------------------------------------------
  */

  it("returns 400 when customer replacement details ID is invalid", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get(
      "/api/v1/orders/replacements/not-a-valid-object-id",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
  |--------------------------------------------------------------------------
  | Missing Replacement
  |--------------------------------------------------------------------------
  */

  it("returns 404 when customer replacement details do not exist", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const replacementId = new mongoose.Types.ObjectId();

    const response = await customerAgent.get(
      `/api/v1/orders/replacements/${replacementId}`,
    );

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_RETURN_REPLACEMENT_NOT_FOUND");
  });

  /*
  |--------------------------------------------------------------------------
  | Reads Must Never Mutate Inventory
  |--------------------------------------------------------------------------
  */

  it("does not modify Product inventory or Inventory Ledger when a customer reads replacement data", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    /*
     * Use the real replacement creation flow here
     * because we want genuine reservation state.
     */

    const { replacement, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
    |--------------------------------------------------------------------------
    | Before Read
    |--------------------------------------------------------------------------
    */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    expect(ledgerBefore).toHaveLength(1);

    expect(ledgerBefore[0].operation).toBe("reserve");

    /*
    |--------------------------------------------------------------------------
    | Customer List Read
    |--------------------------------------------------------------------------
    */

    await customerAgent.get("/api/v1/orders/replacements").expect(200);

    /*
    |--------------------------------------------------------------------------
    | Customer Details Read
    |--------------------------------------------------------------------------
    */

    await customerAgent
      .get(`/api/v1/orders/replacements/${replacement.id}`)
      .expect(200);

    /*
    |--------------------------------------------------------------------------
    | After Read
    |--------------------------------------------------------------------------
    */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Cross-Operation Concurrency
|--------------------------------------------------------------------------
*/

describe("Admin Return replacement cross-operation concurrency", () => {
  /*
    |--------------------------------------------------------------------------
    | Ship vs Cancel
    |--------------------------------------------------------------------------
    */

  it("allows only one of shipment or cancellation to win", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Start From Processing
      |--------------------------------------------------------------------------
      |
      | Both:
      |
      | ship
      | cancel
      |
      | are racing against the same reserved inventory.
      |--------------------------------------------------------------------------
      */

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const shipmentUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/ship`;

    const cancellationUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/cancel`;

    /*
      |--------------------------------------------------------------------------
      | Fire Both Simultaneously
      |--------------------------------------------------------------------------
      */

    const [shipmentResponse, cancellationResponse] = await Promise.all([
      firstAdminAgent.post(shipmentUrl).send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-RACE-SHIP-CANCEL",
      }),

      secondAdminAgent.post(cancellationUrl).send({
        reason: "Concurrent cancellation while shipment started.",
      }),
    ]);

    const responses = [shipmentResponse, cancellationResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    /*
      |--------------------------------------------------------------------------
      | Exactly One Winner
      |--------------------------------------------------------------------------
      */

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_REPLACEMENT_SHIPMENT_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_SHIPMENT_CONFLICT",

      "ORDER_RETURN_REPLACEMENT_CANCELLATION_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_CANCELLATION_CONFLICT",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
      |--------------------------------------------------------------------------
      | Final Replacement
      |--------------------------------------------------------------------------
      */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(["shipped", "cancelled"]).toContain(storedReplacement.status);

    /*
      |--------------------------------------------------------------------------
      | Final Product
      |--------------------------------------------------------------------------
      */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    /*
      |--------------------------------------------------------------------------
      | Ledger
      |--------------------------------------------------------------------------
      */

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    /*
     * One original reservation plus exactly
     * one terminal inventory operation.
     */

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries[0].operation).toBe("reserve");

    /*
      |--------------------------------------------------------------------------
      | Shipment Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "shipped") {
      expect(storedVariant.inventory.stock).toBe(8);

      expect(storedVariant.inventory.reservedStock).toBe(0);

      expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
        "reserve",
        "commit",
      ]);

      expect(storedReplacement.shipment.shippedAt).toBeTruthy();

      expect(storedReplacement.cancellation?.cancelledAt ?? null).toBeNull();
    }

    /*
      |--------------------------------------------------------------------------
      | Cancellation Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "cancelled") {
      expect(storedVariant.inventory.stock).toBe(10);

      expect(storedVariant.inventory.reservedStock).toBe(0);

      expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
        "reserve",
        "release",
      ]);

      expect(storedReplacement.cancellation.cancelledAt).toBeTruthy();

      expect(storedReplacement.shipment?.shippedAt ?? null).toBeNull();
    }

    /*
      |--------------------------------------------------------------------------
      | Never Both
      |--------------------------------------------------------------------------
      */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBeLessThanOrEqual(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBeLessThanOrEqual(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Ship vs Fail
    |--------------------------------------------------------------------------
    */

  it("allows only one of shipment or failure to win", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const shipmentUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/ship`;

    const failureUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/fail`;

    const [shipmentResponse, failureResponse] = await Promise.all([
      firstAdminAgent.post(shipmentUrl).send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-RACE-SHIP-FAIL",
      }),

      secondAdminAgent.post(failureUrl).send({
        reason: "Concurrent warehouse fulfillment failure.",
      }),
    ]);

    const responses = [shipmentResponse, failureResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_REPLACEMENT_SHIPMENT_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_SHIPMENT_CONFLICT",

      "ORDER_RETURN_REPLACEMENT_FAILURE_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_FAILURE_CONFLICT",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
      |--------------------------------------------------------------------------
      | Final Replacement State
      |--------------------------------------------------------------------------
      */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(["shipped", "failed"]).toContain(storedReplacement.status);

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries[0].operation).toBe("reserve");

    /*
      |--------------------------------------------------------------------------
      | Shipment Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "shipped") {
      expect(storedVariant.inventory.stock).toBe(8);

      expect(storedVariant.inventory.reservedStock).toBe(0);

      expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
        "reserve",
        "commit",
      ]);

      expect(storedReplacement.shipment.shippedAt).toBeTruthy();

      expect(storedReplacement.failure?.failedAt ?? null).toBeNull();
    }

    /*
      |--------------------------------------------------------------------------
      | Failure Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "failed") {
      expect(storedVariant.inventory.stock).toBe(10);

      expect(storedVariant.inventory.reservedStock).toBe(0);

      expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
        "reserve",
        "release",
      ]);

      expect(storedReplacement.failure.failedAt).toBeTruthy();

      expect(storedReplacement.shipment?.shippedAt ?? null).toBeNull();
    }

    /*
      |--------------------------------------------------------------------------
      | Only One Terminal Inventory Operation
      |--------------------------------------------------------------------------
      */

    const commitCount = await ProductInventoryLedger.countDocuments({
      referenceId: replacement.replacementNumber,

      operation: "commit",
    });

    const releaseCount = await ProductInventoryLedger.countDocuments({
      referenceId: replacement.replacementNumber,

      operation: "release",
    });

    expect(commitCount + releaseCount).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | Cancel vs Fail
    |--------------------------------------------------------------------------
    */

  it("allows only one of cancellation or failure to win and releases inventory once", async () => {
    const {
      agent: firstAdminAgent,

      user: firstAdmin,
    } = await createAuthenticatedAdminAgent();

    const { agent: secondAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
     * Processing is eligible for BOTH:
     *
     * cancel
     * fail
     */

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent: firstAdminAgent,

        adminId: firstAdmin._id,

        customerId: customer._id,
      });

    const cancellationUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/cancel`;

    const failureUrl = `/api/v1/admin/order-return-replacements/${replacement.id}/fail`;

    const [cancellationResponse, failureResponse] = await Promise.all([
      firstAdminAgent.post(cancellationUrl).send({
        reason: "Concurrent replacement cancellation.",
      }),

      secondAdminAgent.post(failureUrl).send({
        reason: "Concurrent replacement fulfillment failure.",
      }),
    ]);

    const responses = [cancellationResponse, failureResponse];

    const successfulResponses = responses.filter(
      (response) => response.status === 200,
    );

    const conflictResponses = responses.filter(
      (response) => response.status === 409,
    );

    /*
      |--------------------------------------------------------------------------
      | One Winner
      |--------------------------------------------------------------------------
      */

    expect(successfulResponses).toHaveLength(1);

    expect(conflictResponses).toHaveLength(1);

    expect([
      "ORDER_RETURN_REPLACEMENT_CANCELLATION_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_CANCELLATION_CONFLICT",

      "ORDER_RETURN_REPLACEMENT_FAILURE_STATUS_INVALID",

      "ORDER_RETURN_REPLACEMENT_FAILURE_CONFLICT",
    ]).toContain(conflictResponses[0].body.errorCode);

    /*
      |--------------------------------------------------------------------------
      | Final State
      |--------------------------------------------------------------------------
      */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(["cancelled", "failed"]).toContain(storedReplacement.status);

    /*
      |--------------------------------------------------------------------------
      | Inventory Released Exactly Once
      |--------------------------------------------------------------------------
      */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(10);

    expect(storedVariant.inventory.reservedStock).toBe(0);

    const ledgerEntries = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerEntries).toHaveLength(2);

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "release",
    ]);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "release",
      }),
    ).toBe(1);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(0);

    /*
      |--------------------------------------------------------------------------
      | Cancellation Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "cancelled") {
      expect(storedReplacement.cancellation.cancelledAt).toBeTruthy();

      expect(storedReplacement.failure?.failedAt ?? null).toBeNull();
    }

    /*
      |--------------------------------------------------------------------------
      | Failure Won
      |--------------------------------------------------------------------------
      */

    if (storedReplacement.status === "failed") {
      expect(storedReplacement.failure.failedAt).toBeTruthy();

      expect(storedReplacement.cancellation?.cancelledAt ?? null).toBeNull();
    }
  });
});

/*
|--------------------------------------------------------------------------
| Return Replacement Final Consistency
|--------------------------------------------------------------------------
*/

describe("Return replacement final consistency", () => {
  /*
    |--------------------------------------------------------------------------
    | Delivered Path
    |--------------------------------------------------------------------------
    */

  it("keeps delivered replacement state, audit history, inventory, and Ledger consistent", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Create -> Reserved -> Processing -> Shipped
      |--------------------------------------------------------------------------
      */

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Deliver
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({})
      .expect(200);

    /*
      |--------------------------------------------------------------------------
      | Stored Replacement
      |--------------------------------------------------------------------------
      */

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(storedReplacement.status).toBe("delivered");

    /*
      |--------------------------------------------------------------------------
      | Required Lifecycle Evidence
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.reservation.reservedBy).toBeTruthy();

    expect(storedReplacement.reservation.reservedAt).toBeTruthy();

    expect(storedReplacement.processing.processedBy).toBeTruthy();

    expect(storedReplacement.processing.processedAt).toBeTruthy();

    expect(storedReplacement.shipment.shippedBy).toBeTruthy();

    expect(storedReplacement.shipment.shippedAt).toBeTruthy();

    expect(storedReplacement.shipment.deliveredBy).toBeTruthy();

    expect(storedReplacement.shipment.deliveredAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Impossible Terminal Audits Must Not Exist
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.cancellation?.cancelledAt ?? null).toBeNull();

    expect(storedReplacement.failure?.failedAt ?? null).toBeNull();

    /*
      |--------------------------------------------------------------------------
      | Audit Ordering
      |--------------------------------------------------------------------------
      */

    expect(
      new Date(storedReplacement.reservation.reservedAt).getTime(),
    ).toBeLessThanOrEqual(
      new Date(storedReplacement.processing.processedAt).getTime(),
    );

    expect(
      new Date(storedReplacement.processing.processedAt).getTime(),
    ).toBeLessThanOrEqual(
      new Date(storedReplacement.shipment.shippedAt).getTime(),
    );

    expect(
      new Date(storedReplacement.shipment.shippedAt).getTime(),
    ).toBeLessThanOrEqual(
      new Date(storedReplacement.shipment.deliveredAt).getTime(),
    );

    /*
      |--------------------------------------------------------------------------
      | Inventory
      |--------------------------------------------------------------------------
      */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(8);

    expect(storedVariant.inventory.reservedStock).toBe(0);

    /*
      |--------------------------------------------------------------------------
      | Ledger
      |--------------------------------------------------------------------------
      */

    const ledgerEntries = await getReplacementInventoryLedger(
      replacement.replacementNumber,
    );

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);

    expect(ledgerEntries).toHaveLength(2);

    const totalReplacementQuantity =
      getTotalReplacementQuantity(storedReplacement);

    expect(totalReplacementQuantity).toBe(2);

    expect(ledgerEntries[0].quantity).toBe(totalReplacementQuantity);

    expect(ledgerEntries[1].quantity).toBe(totalReplacementQuantity);

    expect(ledgerEntries[0].referenceId).toBe(
      storedReplacement.replacementNumber,
    );

    expect(ledgerEntries[1].referenceId).toBe(
      storedReplacement.replacementNumber,
    );
  });

  /*
    |--------------------------------------------------------------------------
    | Cancelled Path
    |--------------------------------------------------------------------------
    */

  it("keeps cancelled replacement state and released inventory consistent", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Replacement cancelled during consistency testing.",
      })
      .expect(200);

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    /*
      |--------------------------------------------------------------------------
      | Terminal State
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.status).toBe("cancelled");

    expect(storedReplacement.cancellation.reason).toBe(
      "Replacement cancelled during consistency testing.",
    );

    expect(storedReplacement.cancellation.cancelledBy).toBeTruthy();

    expect(storedReplacement.cancellation.cancelledAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Previous Valid History Remains
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.reservation.reservedAt).toBeTruthy();

    expect(storedReplacement.processing.processedAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Shipment / Failure Must Not Exist
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.shipment?.shippedAt ?? null).toBeNull();

    expect(storedReplacement.shipment?.deliveredAt ?? null).toBeNull();

    expect(storedReplacement.failure?.failedAt ?? null).toBeNull();

    /*
      |--------------------------------------------------------------------------
      | Audit Ordering
      |--------------------------------------------------------------------------
      */

    expect(
      new Date(storedReplacement.processing.processedAt).getTime(),
    ).toBeLessThanOrEqual(
      new Date(storedReplacement.cancellation.cancelledAt).getTime(),
    );

    /*
      |--------------------------------------------------------------------------
      | Inventory
      |--------------------------------------------------------------------------
      */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(10);

    expect(storedVariant.inventory.reservedStock).toBe(0);

    /*
      |--------------------------------------------------------------------------
      | Ledger
      |--------------------------------------------------------------------------
      */

    const ledgerEntries = await getReplacementInventoryLedger(
      replacement.replacementNumber,
    );

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "release",
    ]);

    expect(ledgerEntries).toHaveLength(2);

    const quantity = getTotalReplacementQuantity(storedReplacement);

    expect(ledgerEntries[0].quantity).toBe(quantity);

    expect(ledgerEntries[1].quantity).toBe(quantity);

    /*
     * Cancellation must never produce a commit.
     */

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Failed Path
    |--------------------------------------------------------------------------
    */

  it("keeps failed replacement state and released inventory consistent", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createProcessingReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Replacement fulfillment failed during consistency testing.",
      })
      .expect(200);

    const storedReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    /*
      |--------------------------------------------------------------------------
      | Terminal State
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.status).toBe("failed");

    expect(storedReplacement.failure.reason).toBe(
      "Replacement fulfillment failed during consistency testing.",
    );

    expect(storedReplacement.failure.failedBy).toBeTruthy();

    expect(storedReplacement.failure.failedAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Valid Earlier State Remains
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.reservation.reservedAt).toBeTruthy();

    expect(storedReplacement.processing.processedAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | No Conflicting Terminal Evidence
      |--------------------------------------------------------------------------
      */

    expect(storedReplacement.shipment?.shippedAt ?? null).toBeNull();

    expect(storedReplacement.shipment?.deliveredAt ?? null).toBeNull();

    expect(storedReplacement.cancellation?.cancelledAt ?? null).toBeNull();

    /*
      |--------------------------------------------------------------------------
      | Audit Ordering
      |--------------------------------------------------------------------------
      */

    expect(
      new Date(storedReplacement.processing.processedAt).getTime(),
    ).toBeLessThanOrEqual(
      new Date(storedReplacement.failure.failedAt).getTime(),
    );

    /*
      |--------------------------------------------------------------------------
      | Inventory
      |--------------------------------------------------------------------------
      */

    const storedProduct = await Product.findById(product._id).lean();

    const storedVariant = findProductVariant(storedProduct, variant._id);

    expect(storedVariant.inventory.stock).toBe(10);

    expect(storedVariant.inventory.reservedStock).toBe(0);

    /*
      |--------------------------------------------------------------------------
      | Ledger
      |--------------------------------------------------------------------------
      */

    const ledgerEntries = await getReplacementInventoryLedger(
      replacement.replacementNumber,
    );

    expect(ledgerEntries.map((entry) => entry.operation)).toEqual([
      "reserve",
      "release",
    ]);

    expect(ledgerEntries).toHaveLength(2);

    expect(
      await ProductInventoryLedger.countDocuments({
        referenceId: replacement.replacementNumber,

        operation: "commit",
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Terminal State Cannot Be Reused
    |--------------------------------------------------------------------------
    */

  it("does not allow a delivered replacement to enter another terminal workflow", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, product, variant } =
      await createShippedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Deliver Successfully
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({})
      .expect(200);

    /*
      |--------------------------------------------------------------------------
      | Snapshot Before Invalid Operations
      |--------------------------------------------------------------------------
      */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const ledgerBefore = await getReplacementInventoryLedger(
      replacement.replacementNumber,
    );

    /*
      |--------------------------------------------------------------------------
      | Cannot Cancel
      |--------------------------------------------------------------------------
      */

    const cancellationResponse = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/cancel`)
      .send({
        reason: "Invalid cancellation after delivery.",
      });

    expect(cancellationResponse.status).toBe(409);

    /*
      |--------------------------------------------------------------------------
      | Cannot Fail
      |--------------------------------------------------------------------------
      */

    const failureResponse = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/fail`)
      .send({
        reason: "Invalid failure after delivery.",
      });

    expect(failureResponse.status).toBe(409);

    /*
      |--------------------------------------------------------------------------
      | Cannot Ship Again
      |--------------------------------------------------------------------------
      */

    const shipmentResponse = await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "INVALID-SECOND-SHIPMENT",
      });

    expect(shipmentResponse.status).toBe(409);

    /*
      |--------------------------------------------------------------------------
      | Final State Still Delivered
      |--------------------------------------------------------------------------
      */

    const finalReplacement = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    expect(finalReplacement.status).toBe("delivered");

    expect(finalReplacement.shipment.deliveredAt).toBeTruthy();

    expect(finalReplacement.cancellation?.cancelledAt ?? null).toBeNull();

    expect(finalReplacement.failure?.failedAt ?? null).toBeNull();

    /*
      |--------------------------------------------------------------------------
      | Inventory Must Not Move Again
      |--------------------------------------------------------------------------
      */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    /*
      |--------------------------------------------------------------------------
      | Ledger Must Remain Unchanged
      |--------------------------------------------------------------------------
      */

    const ledgerAfter = await getReplacementInventoryLedger(
      replacement.replacementNumber,
    );

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual([
      "reserve",
      "commit",
    ]);
  });
});

/*
|--------------------------------------------------------------------------
| Return Replacement Linked Return Details
|--------------------------------------------------------------------------
*/

describe("Return replacement linked Return details", () => {
  /*
    |--------------------------------------------------------------------------
    | Customer - No Replacement Yet
    |--------------------------------------------------------------------------
    */

  it("returns replacement null in customer Return details before replacement creation", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { returnRequest } =
      await createCompletedReturnAwaitingReplacementFixture({
        customerId: customer._id,

        adminId: admin._id,
      });

    const response = await customerAgent.get(
      `/api/v1/orders/returns/${returnRequest._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.status).toBe("completed");

    expect(response.body.data.returnRequest.requestedResolution).toBe(
      "replacement",
    );

    expect(response.body.data.returnRequest.replacement).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Admin - No Replacement Yet
    |--------------------------------------------------------------------------
    */

  it("returns replacement null in admin Return details before replacement creation", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { returnRequest } =
      await createCompletedReturnAwaitingReplacementFixture({
        customerId: customer._id,

        adminId: admin._id,
      });

    const response = await adminAgent.get(
      `/api/v1/admin/order-returns/${returnRequest._id}`,
    );

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.replacement).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Replacement Appears In Both Return Details
    |--------------------------------------------------------------------------
    */

  it("links a newly created replacement into customer and admin Return details", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { returnRequest } =
      await createCompletedReturnAwaitingReplacementFixture({
        customerId: customer._id,

        adminId: admin._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Create Replacement
      |--------------------------------------------------------------------------
      */

    const creationResponse = await adminAgent
      .post(`/api/v1/admin/order-returns/${returnRequest._id}/replacement`)
      .send({})
      .expect(201);

    const replacement = creationResponse.body.data.replacement;

    expect(replacement.status).toBe("reserved");

    /*
      |--------------------------------------------------------------------------
      | Customer Return Details
      |--------------------------------------------------------------------------
      */

    const customerResponse = await customerAgent.get(
      `/api/v1/orders/returns/${returnRequest._id}`,
    );

    expect(customerResponse.status).toBe(200);

    const customerLinkedReplacement =
      customerResponse.body.data.returnRequest.replacement;

    expect(customerLinkedReplacement).toMatchObject({
      id: replacement.id,

      replacementNumber: replacement.replacementNumber,

      returnRequestId: String(returnRequest._id),

      status: "reserved",

      itemCount: 1,

      totalReplacementQuantity: 2,
    });

    expect(customerLinkedReplacement.reservedAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Customer Privacy
      |--------------------------------------------------------------------------
      */

    expect(customerLinkedReplacement.customerId).toBeUndefined();

    expect(customerLinkedReplacement.reservation).toBeUndefined();

    expect(customerLinkedReplacement.processing).toBeUndefined();

    expect(customerLinkedReplacement.shipment).toBeUndefined();

    /*
      |--------------------------------------------------------------------------
      | Admin Return Details
      |--------------------------------------------------------------------------
      */

    const adminResponse = await adminAgent.get(
      `/api/v1/admin/order-returns/${returnRequest._id}`,
    );

    expect(adminResponse.status).toBe(200);

    const adminLinkedReplacement =
      adminResponse.body.data.returnRequest.replacement;

    expect(adminLinkedReplacement).toMatchObject({
      id: replacement.id,

      replacementNumber: replacement.replacementNumber,

      status: "reserved",

      customerId: String(customer._id),

      itemCount: 1,

      totalReplacementQuantity: 2,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Live Replacement Status
    |--------------------------------------------------------------------------
    */

  it("always reflects the current replacement lifecycle status in Return details", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { replacement, returnRequest } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    const returnUrl = `/api/v1/orders/returns/${returnRequest._id}`;

    /*
      |--------------------------------------------------------------------------
      | Reserved
      |--------------------------------------------------------------------------
      */

    let response = await customerAgent.get(returnUrl);

    expect(response.status).toBe(200);

    expect(response.body.data.returnRequest.replacement.status).toBe(
      "reserved",
    );

    /*
      |--------------------------------------------------------------------------
      | Processing
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/process`)
      .send({
        note: "Preparing replacement for linked Return test.",
      })
      .expect(200);

    response = await customerAgent.get(returnUrl);

    expect(response.body.data.returnRequest.replacement.status).toBe(
      "processing",
    );

    expect(
      response.body.data.returnRequest.replacement.processedAt,
    ).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Shipped
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/ship`)
      .send({
        carrier: "Blue Dart",

        trackingNumber: "RPL-LINK-STATUS-001",
      })
      .expect(200);

    response = await customerAgent.get(returnUrl);

    expect(response.body.data.returnRequest.replacement.status).toBe("shipped");

    expect(response.body.data.returnRequest.replacement.shippedAt).toBeTruthy();

    /*
      |--------------------------------------------------------------------------
      | Delivered
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .post(`/api/v1/admin/order-return-replacements/${replacement.id}/deliver`)
      .send({})
      .expect(200);

    response = await customerAgent.get(returnUrl);

    const deliveredSummary = response.body.data.returnRequest.replacement;

    expect(deliveredSummary.status).toBe("delivered");

    expect(deliveredSummary.deliveredAt).toBeTruthy();

    /*
     * Same Replacement relationship throughout.
     */

    expect(deliveredSummary.id).toBe(replacement.id);
  });

  /*
    |--------------------------------------------------------------------------
    | Refund Resolution Never Links Replacement
    |--------------------------------------------------------------------------
    */

  it("returns replacement null for a refund-resolution Return", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { returnRequest } =
      await createCompletedReturnAwaitingReplacementFixture({
        customerId: customer._id,

        adminId: admin._id,

        requestedResolution: "refund",
      });

    /*
      |--------------------------------------------------------------------------
      | Customer
      |--------------------------------------------------------------------------
      */

    const customerResponse = await customerAgent.get(
      `/api/v1/orders/returns/${returnRequest._id}`,
    );

    expect(customerResponse.status).toBe(200);

    expect(customerResponse.body.data.returnRequest.requestedResolution).toBe(
      "refund",
    );

    expect(customerResponse.body.data.returnRequest.replacement).toBeNull();

    /*
      |--------------------------------------------------------------------------
      | Admin
      |--------------------------------------------------------------------------
      */

    const adminResponse = await adminAgent.get(
      `/api/v1/admin/order-returns/${returnRequest._id}`,
    );

    expect(adminResponse.status).toBe(200);

    expect(adminResponse.body.data.returnRequest.replacement).toBeNull();
  });

  /*
    |--------------------------------------------------------------------------
    | Ownership Isolation
    |--------------------------------------------------------------------------
    */

  it("does not reveal a linked replacement when another customer requests the Return", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { agent: firstCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const { user: secondCustomer } = await createAuthenticatedCustomerAgent();

    /*
     * Second customer owns both Return + Replacement.
     */

    const { returnRequest } = await createReservedReplacementFixture({
      adminAgent,

      adminId: admin._id,

      customerId: secondCustomer._id,
    });

    /*
     * First customer tries to access the Return.
     */

    const response = await firstCustomerAgent.get(
      `/api/v1/orders/returns/${returnRequest._id}`,
    );

    expect(response.status).toBe(404);

    /*
     * The API must not expose any linked replacement payload.
     */

    expect(response.body.data?.returnRequest?.replacement).toBeUndefined();
  });

  /*
    |--------------------------------------------------------------------------
    | Linked Reads Must Not Mutate Inventory
    |--------------------------------------------------------------------------
    */

  it("does not mutate Product inventory or replacement Ledger when Return details include a replacement", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const { replacement, returnRequest, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Before Reads
      |--------------------------------------------------------------------------
      */

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerBefore.map((entry) => entry.operation)).toEqual(["reserve"]);

    /*
      |--------------------------------------------------------------------------
      | Customer Linked Read
      |--------------------------------------------------------------------------
      */

    await customerAgent
      .get(`/api/v1/orders/returns/${returnRequest._id}`)
      .expect(200);

    /*
      |--------------------------------------------------------------------------
      | Admin Linked Read
      |--------------------------------------------------------------------------
      */

    await adminAgent
      .get(`/api/v1/admin/order-returns/${returnRequest._id}`)
      .expect(200);

    /*
      |--------------------------------------------------------------------------
      | Inventory After Reads
      |--------------------------------------------------------------------------
      */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    /*
      |--------------------------------------------------------------------------
      | Ledger After Reads
      |--------------------------------------------------------------------------
      */

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Operational Metrics
|--------------------------------------------------------------------------
*/

describe("Admin Return operational metrics", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when Return metrics are requested without authentication", async () => {
    const response = await request(app).get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Customer Cannot Access Admin Metrics
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer requests admin Return metrics", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Empty Database
    |--------------------------------------------------------------------------
    */

  it("returns a stable zero-filled metrics contract when there are no Returns or replacements", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Admin Return operational metrics retrieved successfully",
    );

    const metrics = response.body.data.metrics;

    expect(metrics.returns.total).toBe(0);

    expect(metrics.returns.byStatus).toEqual({
      requested: 0,

      approved: 0,

      rejected: 0,

      "in-transit": 0,

      received: 0,

      inspected: 0,

      completed: 0,

      cancelled: 0,
    });

    expect(metrics.returns.byResolution).toEqual({
      refund: 0,

      replacement: 0,
    });

    expect(metrics.returns.refunds).toEqual({
      processedCount: 0,

      refundedQuantity: 0,

      amount: 0,
    });

    expect(metrics.replacements.total).toBe(0);

    expect(metrics.replacements.byStatus).toEqual({
      pending: 0,

      reserved: 0,

      processing: 0,

      shipped: 0,

      delivered: 0,

      failed: 0,

      cancelled: 0,
    });

    expect(metrics.actionRequired).toEqual({
      returnsAwaitingDecision: 0,

      returnsAwaitingRefund: 0,

      returnsAwaitingReplacementCreation: 0,

      replacementsAwaitingProcessing: 0,

      replacementsProcessing: 0,

      replacementsAwaitingDelivery: 0,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Return + Refund Metrics
    |--------------------------------------------------------------------------
    */

  it("aggregates Return status, resolution, refund, and Return action-required metrics", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const { agent: metricsAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Requested Refund
      |--------------------------------------------------------------------------
      */

    await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",

      requestedResolution: "refund",
    });

    /*
      |--------------------------------------------------------------------------
      | Approved Replacement
      |--------------------------------------------------------------------------
      */

    await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "approved",

      requestedResolution: "replacement",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    /*
      |--------------------------------------------------------------------------
      | Completed Refund #1 - processed
      |--------------------------------------------------------------------------
      */

    const firstRefundReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "refund",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    await markReturnRefundedForMetrics({
      returnRequestId: firstRefundReturn._id,

      adminId: admin._id,

      refundedQuantity: 1,

      amount: 700,
    });

    /*
      |--------------------------------------------------------------------------
      | Completed Refund #2 - processed
      |--------------------------------------------------------------------------
      */

    const secondRefundReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "refund",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    await markReturnRefundedForMetrics({
      returnRequestId: secondRefundReturn._id,

      adminId: admin._id,

      refundedQuantity: 2,

      amount: 1400,
    });

    /*
      |--------------------------------------------------------------------------
      | Completed Refund #3 - waiting for refund
      |--------------------------------------------------------------------------
      */

    await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "refund",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    /*
      |--------------------------------------------------------------------------
      | Metrics
      |--------------------------------------------------------------------------
      */

    const response = await metricsAdminAgent.get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    /*
      |--------------------------------------------------------------------------
      | Total
      |--------------------------------------------------------------------------
      */

    expect(metrics.returns.total).toBe(5);

    /*
      |--------------------------------------------------------------------------
      | Statuses
      |--------------------------------------------------------------------------
      */

    expect(metrics.returns.byStatus).toEqual({
      requested: 1,

      approved: 1,

      rejected: 0,

      "in-transit": 0,

      received: 0,

      inspected: 0,

      completed: 3,

      cancelled: 0,
    });

    /*
      |--------------------------------------------------------------------------
      | Resolution
      |--------------------------------------------------------------------------
      */

    expect(metrics.returns.byResolution).toEqual({
      refund: 4,

      replacement: 1,
    });

    /*
      |--------------------------------------------------------------------------
      | Refund Metrics
      |--------------------------------------------------------------------------
      */

    expect(metrics.returns.refunds).toEqual({
      processedCount: 2,

      refundedQuantity: 3,

      amount: 2100,
    });

    /*
      |--------------------------------------------------------------------------
      | Action Required
      |--------------------------------------------------------------------------
      |
      | requested = 1
      |
      | completed refund Returns = 3
      | actual refunded Returns   = 2
      |
      | waiting refund = 1
      |--------------------------------------------------------------------------
      */

    expect(metrics.actionRequired.returnsAwaitingDecision).toBe(1);

    expect(metrics.actionRequired.returnsAwaitingRefund).toBe(1);

    /*
     * The only replacement-resolution Return
     * is approved, not completed.
     */

    expect(metrics.actionRequired.returnsAwaitingReplacementCreation).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Replacement Metrics
    |--------------------------------------------------------------------------
    */

  it("aggregates replacement statuses and replacement action-required queues", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    /*
      |--------------------------------------------------------------------------
      | Four Completed Replacement Returns
      |--------------------------------------------------------------------------
      */

    const returnRequests = [];

    for (let index = 0; index < 4; index += 1) {
      const returnRequest = await createCompletedReplacementReturnFixture({
        customerId: customer._id,

        adminId: admin._id,

        requestedResolution: "replacement",

        items: [
          {
            product,

            variant,

            quantity: 2,

            resellableQuantity: 1,

            damagedQuantity: 1,

            rejectedQuantity: 0,
          },
        ],
      });

      returnRequests.push(returnRequest);
    }

    /*
      |--------------------------------------------------------------------------
      | Only Three Have Replacement Documents
      |--------------------------------------------------------------------------
      |
      | #1 reserved
      | #2 processing
      | #3 shipped
      | #4 has no replacement yet
      |--------------------------------------------------------------------------
      */

    const replacementStatuses = ["reserved", "processing", "shipped"];

    for (let index = 0; index < replacementStatuses.length; index += 1) {
      const returnRequest = returnRequests[index];

      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        returnRequestId: returnRequest._id,

        returnRequestNumber: returnRequest.returnRequestNumber,

        orderId: returnRequest.order,

        orderNumber: returnRequest.orderNumber,

        status: replacementStatuses[index],

        replacementQuantities: [2],
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Metrics
      |--------------------------------------------------------------------------
      */

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    expect(metrics.returns.total).toBe(4);

    expect(metrics.returns.byStatus.completed).toBe(4);

    expect(metrics.returns.byResolution.replacement).toBe(4);

    /*
      |--------------------------------------------------------------------------
      | Replacement Counts
      |--------------------------------------------------------------------------
      */

    expect(metrics.replacements.total).toBe(3);

    expect(metrics.replacements.byStatus).toEqual({
      pending: 0,

      reserved: 1,

      processing: 1,

      shipped: 1,

      delivered: 0,

      failed: 0,

      cancelled: 0,
    });

    /*
      |--------------------------------------------------------------------------
      | Operational Queues
      |--------------------------------------------------------------------------
      */

    expect(metrics.actionRequired.returnsAwaitingReplacementCreation).toBe(1);

    expect(metrics.actionRequired.replacementsAwaitingProcessing).toBe(1);

    expect(metrics.actionRequired.replacementsProcessing).toBe(1);

    expect(metrics.actionRequired.replacementsAwaitingDelivery).toBe(1);

    expect(metrics.actionRequired.returnsAwaitingDecision).toBe(0);

    expect(metrics.actionRequired.returnsAwaitingRefund).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Strict Validation
    |--------------------------------------------------------------------------
    */

  it("rejects unsupported query parameters on the metrics endpoint", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?status=completed",
    );

    expect(response.status).toBe(400);

    expect(response.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Metrics Must Be Read Only
    |--------------------------------------------------------------------------
    */

  it("does not mutate Returns, replacements, Product inventory, or Inventory Ledger", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Use Real Reservation Flow
      |--------------------------------------------------------------------------
      */

    const { replacement, returnRequest, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Before
      |--------------------------------------------------------------------------
      */

    const returnBefore = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    const replacementBefore = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(replacementBefore.status).toBe("reserved");

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    expect(ledgerBefore.map((entry) => entry.operation)).toEqual(["reserve"]);

    /*
      |--------------------------------------------------------------------------
      | Metrics Read
      |--------------------------------------------------------------------------
      */

    await adminAgent.get("/api/v1/admin/order-returns/metrics").expect(200);

    /*
      |--------------------------------------------------------------------------
      | After
      |--------------------------------------------------------------------------
      */

    const returnAfter = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    const replacementAfter = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    /*
      |--------------------------------------------------------------------------
      | Return Unchanged
      |--------------------------------------------------------------------------
      */

    expect(returnAfter.status).toBe(returnBefore.status);

    expect(new Date(returnAfter.updatedAt).getTime()).toBe(
      new Date(returnBefore.updatedAt).getTime(),
    );

    /*
      |--------------------------------------------------------------------------
      | Replacement Unchanged
      |--------------------------------------------------------------------------
      */

    expect(replacementAfter.status).toBe(replacementBefore.status);

    expect(new Date(replacementAfter.updatedAt).getTime()).toBe(
      new Date(replacementBefore.updatedAt).getTime(),
    );

    /*
      |--------------------------------------------------------------------------
      | Product Unchanged
      |--------------------------------------------------------------------------
      */

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    /*
      |--------------------------------------------------------------------------
      | Ledger Unchanged
      |--------------------------------------------------------------------------
      */

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Date-Range Operational Metrics
|--------------------------------------------------------------------------
*/

describe("Admin Return date-range operational metrics", () => {
  /*
    |--------------------------------------------------------------------------
    | All-Time Behavior
    |--------------------------------------------------------------------------
    */

  it("preserves all-time metrics when from and to are omitted", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const firstReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",

      requestedResolution: "refund",
    });

    const secondReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "replacement",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: firstReturn._id,

      createdAt: "2026-07-01T10:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: secondReturn._id,

      createdAt: "2026-08-15T10:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    expect(metrics.period).toEqual({
      from: null,

      to: null,

      timezone: "UTC",

      field: "createdAt",
    });

    expect(metrics.returns.total).toBe(2);

    expect(metrics.returns.byStatus.requested).toBe(1);

    expect(metrics.returns.byStatus.completed).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | From Only
    |--------------------------------------------------------------------------
    */

  it("includes only records created on or after the from date", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const oldReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",
    });

    const recentReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "approved",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: oldReturn._id,

      createdAt: "2026-08-05T12:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: recentReturn._id,

      createdAt: "2026-08-15T12:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-08-10",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    expect(metrics.period).toEqual({
      from: "2026-08-10",

      to: null,

      timezone: "UTC",

      field: "createdAt",
    });

    expect(metrics.returns.total).toBe(1);

    expect(metrics.returns.byStatus.requested).toBe(0);

    expect(metrics.returns.byStatus.approved).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | To Only
    |--------------------------------------------------------------------------
    */

  it("includes only records created on or before the to date", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const earlyReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",
    });

    const lateReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "rejected",

      rejection: {
        reason: "Metrics test rejection",

        rejectedBy: admin._id,

        rejectedAt: new Date(),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: earlyReturn._id,

      createdAt: "2026-08-05T12:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: lateReturn._id,

      createdAt: "2026-08-20T12:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?to=2026-08-10",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    expect(metrics.period.from).toBeNull();

    expect(metrics.period.to).toBe("2026-08-10");

    expect(metrics.returns.total).toBe(1);

    expect(metrics.returns.byStatus.requested).toBe(1);

    expect(metrics.returns.byStatus.rejected).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Inclusive UTC Boundaries
    |--------------------------------------------------------------------------
    */

  it("includes the full UTC from and to calendar-day boundaries", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const beforeRange = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",
    });

    const exactStart = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "approved",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    const exactEnd = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    const afterRange = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "cancelled",

      cancellation: {
        reason: "Boundary test",

        cancelledBy: customer._id,

        cancelledAt: new Date(),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: beforeRange._id,

      createdAt: "2026-08-09T23:59:59.999Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: exactStart._id,

      createdAt: "2026-08-10T00:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: exactEnd._id,

      createdAt: "2026-08-10T23:59:59.999Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: afterRange._id,

      createdAt: "2026-08-11T00:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-08-10&to=2026-08-10",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    /*
     * Exact beginning and exact end of
     * August 10 must both be included.
     */

    expect(metrics.returns.total).toBe(2);

    expect(metrics.returns.byStatus.approved).toBe(1);

    expect(metrics.returns.byStatus.completed).toBe(1);

    /*
     * Adjacent days must be excluded.
     */

    expect(metrics.returns.byStatus.requested).toBe(0);

    expect(metrics.returns.byStatus.cancelled).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Return + Replacement Date Cohorts
    |--------------------------------------------------------------------------
    */

  it("filters Return and Replacement totals independently by their own createdAt values", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Return inside range
      |--------------------------------------------------------------------------
      */

    const insideReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "replacement",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    /*
      |--------------------------------------------------------------------------
      | Return outside range
      |--------------------------------------------------------------------------
      */

    const outsideReturn = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "replacement",

      completion: {
        completedBy: admin._id,

        completedAt: new Date(),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: insideReturn._id,

      createdAt: "2026-08-10T10:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: outsideReturn._id,

      createdAt: "2026-08-20T10:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Replacement inside range
      |--------------------------------------------------------------------------
      */

    const insideReplacement =
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        returnRequestId: insideReturn._id,

        returnRequestNumber: insideReturn.returnRequestNumber,

        orderId: insideReturn.order,

        orderNumber: insideReturn.orderNumber,

        replacementNumber: "RPL-METRICS-IN-RANGE",

        status: "reserved",
      });

    /*
      |--------------------------------------------------------------------------
      | Replacement outside range
      |--------------------------------------------------------------------------
      */

    const outsideReplacement =
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        returnRequestId: outsideReturn._id,

        returnRequestNumber: outsideReturn.returnRequestNumber,

        orderId: outsideReturn.order,

        orderNumber: outsideReturn.orderNumber,

        replacementNumber: "RPL-METRICS-OUT-RANGE",

        status: "processing",
      });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: insideReplacement._id,

      createdAt: "2026-08-10T12:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: outsideReplacement._id,

      createdAt: "2026-08-20T12:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-08-10&to=2026-08-10",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    expect(metrics.returns.total).toBe(1);

    expect(metrics.replacements.total).toBe(1);

    expect(metrics.replacements.byStatus.reserved).toBe(1);

    expect(metrics.replacements.byStatus.processing).toBe(0);

    expect(metrics.actionRequired.replacementsAwaitingProcessing).toBe(1);

    expect(metrics.actionRequired.replacementsProcessing).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | Invalid Dates
    |--------------------------------------------------------------------------
    */

  it("rejects malformed, impossible, and reversed metric date ranges", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
      |--------------------------------------------------------------------------
      | Wrong Format
      |--------------------------------------------------------------------------
      */

    const malformedResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=10-08-2026",
    );

    expect(malformedResponse.status).toBe(400);

    expect(malformedResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
      |--------------------------------------------------------------------------
      | Impossible Calendar Date
      |--------------------------------------------------------------------------
      */

    const impossibleDateResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-02-31",
    );

    expect(impossibleDateResponse.status).toBe(400);

    expect(impossibleDateResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
      |--------------------------------------------------------------------------
      | From After To
      |--------------------------------------------------------------------------
      */

    const reversedResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-08-20&to=2026-08-10",
    );

    expect(reversedResponse.status).toBe(400);

    expect(reversedResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Cross-Day Replacement Relationship
    |--------------------------------------------------------------------------
    */

  it("does not mark an in-range Return as awaiting replacement when its linked Replacement was created outside the range", async () => {
    const { user: admin } = await createAuthenticatedAdminAgent();

    const { agent: metricsAdminAgent } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Return Created August 10
      |--------------------------------------------------------------------------
      */

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "replacement",

      completion: {
        completedBy: admin._id,

        completedAt: new Date("2026-08-10T14:00:00.000Z"),
      },
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: returnRequest._id,

      createdAt: "2026-08-10T10:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Linked Replacement Created August 11
      |--------------------------------------------------------------------------
      |
      | It is outside the requested metric period.
      |--------------------------------------------------------------------------
      */

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      returnRequestId: returnRequest._id,

      returnRequestNumber: returnRequest.returnRequestNumber,

      orderId: returnRequest.order,

      orderNumber: returnRequest.orderNumber,

      replacementNumber: "RPL-CROSS-DAY-METRICS",

      status: "reserved",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: replacement._id,

      createdAt: "2026-08-11T09:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Metrics For August 10 Only
      |--------------------------------------------------------------------------
      */

    const response = await metricsAdminAgent.get(
      "/api/v1/admin/order-returns/metrics?from=2026-08-10&to=2026-08-10",
    );

    expect(response.status).toBe(200);

    const metrics = response.body.data.metrics;

    /*
     * Return belongs to the August 10 cohort.
     */

    expect(metrics.returns.total).toBe(1);

    expect(metrics.returns.byResolution.replacement).toBe(1);

    /*
     * Replacement itself was created August 11,
     * so it is not part of the August 10
     * Replacement metric cohort.
     */

    expect(metrics.replacements.total).toBe(0);

    /*
     * BUT the August 10 Return already has a
     * linked Replacement.
     *
     * Therefore it is NOT awaiting creation.
     *
     * This is exactly why Part 173 replaced
     * subtraction with $lookup.
     */

    expect(metrics.actionRequired.returnsAwaitingReplacementCreation).toBe(0);
  });
});

/*
|--------------------------------------------------------------------------
| Admin Return Daily Operational Metrics Trend
|--------------------------------------------------------------------------
*/

describe("Admin Return daily operational metrics trend", () => {
  /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when metrics trend is requested without authentication", async () => {
    const response = await request(app).get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-01&to=2026-08-07",
    );

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | Customer Cannot Access Admin Trend
    |--------------------------------------------------------------------------
    */

  it("returns 403 when a customer requests admin metrics trend", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const response = await customerAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-01&to=2026-08-07",
    );

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | Required / Invalid Date Validation
    |--------------------------------------------------------------------------
    */

  it("requires valid from and to dates and rejects invalid trend ranges", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
      |--------------------------------------------------------------------------
      | Missing Both
      |--------------------------------------------------------------------------
      */

    const missingBothResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends",
    );

    expect(missingBothResponse.status).toBe(400);

    expect(missingBothResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
      |--------------------------------------------------------------------------
      | Missing To
      |--------------------------------------------------------------------------
      */

    const missingToResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-01",
    );

    expect(missingToResponse.status).toBe(400);

    /*
      |--------------------------------------------------------------------------
      | Invalid Calendar Date
      |--------------------------------------------------------------------------
      */

    const impossibleDateResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-02-31&to=2026-03-01",
    );

    expect(impossibleDateResponse.status).toBe(400);

    /*
      |--------------------------------------------------------------------------
      | Reversed Range
      |--------------------------------------------------------------------------
      */

    const reversedResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-10&to=2026-08-01",
    );

    expect(reversedResponse.status).toBe(400);

    /*
      |--------------------------------------------------------------------------
      | More Than 90 Days
      |--------------------------------------------------------------------------
      |
      | Jan 1 -> Apr 1 = 91 inclusive calendar days.
      |--------------------------------------------------------------------------
      */

    const tooLargeResponse = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-01-01&to=2026-04-01",
    );

    expect(tooLargeResponse.status).toBe(400);

    expect(tooLargeResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");
  });

  /*
    |--------------------------------------------------------------------------
    | Exactly 90 Days Is Allowed
    |--------------------------------------------------------------------------
    */

  it("allows a trend range of exactly 90 inclusive calendar days", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    /*
     * 2026:
     *
     * January  = 31
     * February = 28
     * March    = 31
     *
     * Total = 90 days.
     */

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-01-01&to=2026-03-31",
    );

    expect(response.status).toBe(200);

    const trend = response.body.data.trend;

    expect(trend.points).toHaveLength(90);

    expect(trend.points[0].date).toBe("2026-01-01");

    expect(trend.points[89].date).toBe("2026-03-31");
  });

  /*
    |--------------------------------------------------------------------------
    | Daily Grouping + Zero Filling
    |--------------------------------------------------------------------------
    */

  it("groups Returns and replacements by UTC day and zero-fills missing dates", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | August 1 Returns = 2
      |--------------------------------------------------------------------------
      */

    const august1ReturnA = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "requested",
    });

    const august1ReturnB = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "approved",

      approval: {
        approvedBy: admin._id,

        approvedAt: new Date(),
      },
    });

    /*
      |--------------------------------------------------------------------------
      | August 3 Return = 1
      |--------------------------------------------------------------------------
      */

    const august3Return = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: august1ReturnA._id,

      createdAt: "2026-08-01T05:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: august1ReturnB._id,

      createdAt: "2026-08-01T18:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: august3Return._id,

      createdAt: "2026-08-03T08:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | August 2 Replacement = 1
      |--------------------------------------------------------------------------
      */

    const august2Replacement =
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber: "RPL-TREND-AUG-02",

        status: "reserved",
      });

    /*
      |--------------------------------------------------------------------------
      | August 3 Replacement = 1
      |--------------------------------------------------------------------------
      */

    const august3Replacement =
      await createAdminOrderReturnReplacementReadFixture({
        customerId: customer._id,

        adminId: admin._id,

        replacementNumber: "RPL-TREND-AUG-03",

        status: "processing",
      });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: august2Replacement._id,

      createdAt: "2026-08-02T11:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: august3Replacement._id,

      createdAt: "2026-08-03T20:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Request Four Days
      |--------------------------------------------------------------------------
      |
      | August 4 has no records in either collection.
      |--------------------------------------------------------------------------
      */

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-01&to=2026-08-04",
    );

    expect(response.status).toBe(200);

    expect(response.body.message).toBe(
      "Admin Return operational metrics trend retrieved successfully",
    );

    const trend = response.body.data.trend;

    expect(trend.period).toEqual({
      from: "2026-08-01",

      to: "2026-08-04",

      timezone: "UTC",

      field: "createdAt",

      granularity: "day",
    });

    expect(trend.points).toEqual([
      {
        date: "2026-08-01",

        returns: 2,

        replacements: 0,
      },

      {
        date: "2026-08-02",

        returns: 0,

        replacements: 1,
      },

      {
        date: "2026-08-03",

        returns: 1,

        replacements: 1,
      },

      {
        date: "2026-08-04",

        returns: 0,

        replacements: 0,
      },
    ]);

    expect(trend.totals).toEqual({
      returns: 3,

      replacements: 2,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | UTC Boundary Inclusion
    |--------------------------------------------------------------------------
    */

  it("uses inclusive UTC calendar-day boundaries for trend grouping", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const before = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,
    });

    const exactStart = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,
    });

    const exactEnd = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,
    });

    const after = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: before._id,

      createdAt: "2026-08-09T23:59:59.999Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: exactStart._id,

      createdAt: "2026-08-10T00:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: exactEnd._id,

      createdAt: "2026-08-10T23:59:59.999Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: after._id,

      createdAt: "2026-08-11T00:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-10&to=2026-08-10",
    );

    expect(response.status).toBe(200);

    const trend = response.body.data.trend;

    expect(trend.points).toEqual([
      {
        date: "2026-08-10",

        returns: 2,

        replacements: 0,
      },
    ]);

    expect(trend.totals).toEqual({
      returns: 2,

      replacements: 0,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Independent Collection Totals
    |--------------------------------------------------------------------------
    */

  it("counts Return and Replacement creation independently even when they occur on different dates", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Return Created August 5
      |--------------------------------------------------------------------------
      */

    const returnRequest = await createAdminOrderReturnReadFixture({
      customerId: customer._id,

      updatedBy: admin._id,

      status: "completed",

      requestedResolution: "replacement",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: returnRequest._id,

      createdAt: "2026-08-05T10:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Its Replacement Created August 7
      |--------------------------------------------------------------------------
      */

    const replacement = await createAdminOrderReturnReplacementReadFixture({
      customerId: customer._id,

      adminId: admin._id,

      returnRequestId: returnRequest._id,

      returnRequestNumber: returnRequest.returnRequestNumber,

      orderId: returnRequest.order,

      orderNumber: returnRequest.orderNumber,

      replacementNumber: "RPL-TREND-CROSS-DAY",

      status: "reserved",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: replacement._id,

      createdAt: "2026-08-07T10:00:00.000Z",
    });

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-05&to=2026-08-07",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.trend.points).toEqual([
      {
        date: "2026-08-05",

        returns: 1,

        replacements: 0,
      },

      {
        date: "2026-08-06",

        returns: 0,

        replacements: 0,
      },

      {
        date: "2026-08-07",

        returns: 0,

        replacements: 1,
      },
    ]);

    expect(response.body.data.trend.totals).toEqual({
      returns: 1,

      replacements: 1,
    });
  });

  /*
    |--------------------------------------------------------------------------
    | Trend Endpoint Must Be Read Only
    |--------------------------------------------------------------------------
    */

  it("does not mutate Return, Replacement, Product inventory, or Inventory Ledger", async () => {
    const {
      agent: adminAgent,

      user: admin,
    } = await createAuthenticatedAdminAgent();

    const { user: customer } = await createAuthenticatedCustomerAgent();

    const { replacement, returnRequest, product, variant } =
      await createReservedReplacementFixture({
        adminAgent,

        adminId: admin._id,

        customerId: customer._id,
      });

    /*
      |--------------------------------------------------------------------------
      | Put Fixture Inside Trend Range
      |--------------------------------------------------------------------------
      */

    await setMetricsFixtureCreatedAt({
      model: OrderReturnRequest,

      documentId: returnRequest._id,

      createdAt: "2026-08-10T10:00:00.000Z",
    });

    await setMetricsFixtureCreatedAt({
      model: OrderReturnReplacement,

      documentId: replacement.id,

      createdAt: "2026-08-10T11:00:00.000Z",
    });

    /*
      |--------------------------------------------------------------------------
      | Before
      |--------------------------------------------------------------------------
      */

    const returnBefore = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    const replacementBefore = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    expect(ledgerBefore.map((entry) => entry.operation)).toEqual(["reserve"]);

    /*
      |--------------------------------------------------------------------------
      | Trend Read
      |--------------------------------------------------------------------------
      */

    const response = await adminAgent.get(
      "/api/v1/admin/order-returns/metrics/trends?from=2026-08-10&to=2026-08-10",
    );

    expect(response.status).toBe(200);

    expect(response.body.data.trend.totals).toEqual({
      returns: 1,

      replacements: 1,
    });

    /*
      |--------------------------------------------------------------------------
      | After
      |--------------------------------------------------------------------------
      */

    const returnAfter = await OrderReturnRequest.findById(
      returnRequest._id,
    ).lean();

    const replacementAfter = await OrderReturnReplacement.findById(
      replacement.id,
    ).lean();

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: replacement.replacementNumber,
    })
      .sort({
        createdAt: 1,
      })
      .lean();

    /*
      |--------------------------------------------------------------------------
      | Return Unchanged
      |--------------------------------------------------------------------------
      */

    expect(returnAfter.status).toBe(returnBefore.status);

    /*
      |--------------------------------------------------------------------------
      | Replacement Unchanged
      |--------------------------------------------------------------------------
      */

    expect(replacementAfter.status).toBe(replacementBefore.status);

    /*
      |--------------------------------------------------------------------------
      | Inventory Unchanged
      |--------------------------------------------------------------------------
      */

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    /*
      |--------------------------------------------------------------------------
      | Ledger Unchanged
      |--------------------------------------------------------------------------
      */

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });
});

/*
|--------------------------------------------------------------------------
| Customer Online Payment Initiation
|--------------------------------------------------------------------------
*/

describe("Customer online Payment initiation", () => {
  /*
    |--------------------------------------------------------------------------
    | 1. Authentication
    |--------------------------------------------------------------------------
    */

  it("returns 401 when Payment initiation is requested without authentication", async () => {
    const orderId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(401);
  });

  /*
    |--------------------------------------------------------------------------
    | 2. Admin Cannot Use Customer Payment Endpoint
    |--------------------------------------------------------------------------
    */

  it("returns 403 when an admin attempts to initiate a customer Payment", async () => {
    const { agent: adminAgent } = await createAuthenticatedAdminAgent();

    const orderId = new mongoose.Types.ObjectId();

    const response = await adminAgent
      .post(`/api/v1/orders/${orderId}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(403);
  });

  /*
    |--------------------------------------------------------------------------
    | 3. Strict Validation
    |--------------------------------------------------------------------------
    */

  it("validates Order ID, provider, and rejects customer-controlled Payment fields", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    /*
      |--------------------------------------------------------------------------
      | Invalid Order ID
      |--------------------------------------------------------------------------
      */

    const invalidOrderResponse = await customerAgent
      .post("/api/v1/orders/not-an-object-id/payments")
      .send({
        provider: "razorpay",
      });

    expect(invalidOrderResponse.status).toBe(400);

    expect(invalidOrderResponse.body.errorCode).toBe(
      "REQUEST_VALIDATION_FAILED",
    );

    /*
      |--------------------------------------------------------------------------
      | Invalid Provider
      |--------------------------------------------------------------------------
      */

    const orderId = new mongoose.Types.ObjectId();

    const invalidProviderResponse = await customerAgent
      .post(`/api/v1/orders/${orderId}/payments`)
      .send({
        provider: "fake-provider",
      });

    expect(invalidProviderResponse.status).toBe(400);

    /*
      |--------------------------------------------------------------------------
      | Customer-Controlled Amount
      |--------------------------------------------------------------------------
      */

    const amountResponse = await customerAgent
      .post(`/api/v1/orders/${orderId}/payments`)
      .send({
        provider: "razorpay",

        amount: 1,
      });

    expect(amountResponse.status).toBe(400);

    expect(amountResponse.body.errorCode).toBe("REQUEST_VALIDATION_FAILED");

    /*
      |--------------------------------------------------------------------------
      | Customer-Controlled Status
      |--------------------------------------------------------------------------
      */

    const statusResponse = await customerAgent
      .post(`/api/v1/orders/${orderId}/payments`)
      .send({
        provider: "razorpay",

        status: "paid",
      });

    expect(statusResponse.status).toBe(400);
  });

  /*
    |--------------------------------------------------------------------------
    | 4. Ownership
    |--------------------------------------------------------------------------
    */

  it("returns 404 when a customer attempts Payment on another customer's Order", async () => {
    const { agent: ownerAgent } = await createAuthenticatedCustomerAgent();

    const { agent: otherCustomerAgent } =
      await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent: ownerAgent,

      product,
    });

    const response = await otherCustomerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(404);

    expect(response.body.errorCode).toBe("ORDER_NOT_FOUND");

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 5. COD Order Cannot Start Online Payment
    |--------------------------------------------------------------------------
    */

  it("rejects online Payment initiation for a cash-on-delivery Order", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    /*
     * Existing fixture creates COD Order.
     */

    const order = await createCustomerOrderFixture({
      customerAgent,

      product,
    });

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_ONLINE_PAYMENT_METHOD_INVALID");

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 6. First Payment Attempt
    |--------------------------------------------------------------------------
    */

  it("creates the first Payment attempt from trusted Order data without mutating inventory", async () => {
    const {
      agent: customerAgent,

      user: customer,
    } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const variant = product.variants[0];

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,

      variant,

      quantity: 2,
    });

    /*
      |--------------------------------------------------------------------------
      | Trusted Order Before Payment
      |--------------------------------------------------------------------------
      */

    const storedOrderBefore = await Order.findById(order.id).lean();

    expect(storedOrderBefore.status).toBe("pending");

    expect(storedOrderBefore.payment.method).toBe("online");

    expect(storedOrderBefore.payment.status).toBe("pending");

    expect(storedOrderBefore.inventoryStatus).toBe("reserved");

    const productBefore = await Product.findById(product._id).lean();

    const variantBefore = findProductVariant(productBefore, variant._id);

    expect(variantBefore.inventory.stock).toBe(10);

    expect(variantBefore.inventory.reservedStock).toBe(2);

    const ledgerBefore = await ProductInventoryLedger.find({
      referenceId: order.orderNumber,
    }).lean();

    expect(ledgerBefore).toHaveLength(1);

    expect(ledgerBefore[0].operation).toBe("reserve");

    /*
      |--------------------------------------------------------------------------
      | Initiate Payment
      |--------------------------------------------------------------------------
      */

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    expect(response.body.message).toBe(
      "Online Payment attempt created successfully",
    );

    expect(response.body.data.action).toBe("create");

    const responsePayment = response.body.data.payment;

    /*
      |--------------------------------------------------------------------------
      | Trusted Payment Data
      |--------------------------------------------------------------------------
      */

    expect(responsePayment.paymentNumber).toMatch(/^PAY-\d{8}-[A-F0-9]{12}$/);

    expect(responsePayment.orderId).toBe(String(order.id));

    expect(responsePayment.orderNumber).toBe(order.orderNumber);

    expect(responsePayment.provider).toBe("razorpay");

    /*
     * The amount comes from Order.totals.grandTotal.
     */

    expect(responsePayment.amount).toBe(storedOrderBefore.totals.grandTotal);

    expect(responsePayment.currency).toBe(storedOrderBefore.totals.currency);

    expect(responsePayment.status).toBe("pending");

    expect(responsePayment.providerReference.orderId).toMatch(/^order_test_/);

    expect(response.body.data.checkout).toEqual({
      keyId: "rzp_test_integration_key",

      orderId: responsePayment.providerReference.orderId,

      amount: storedOrderBefore.totals.grandTotal * 100,

      currency: storedOrderBefore.totals.currency,
    });

    expect(responsePayment.attemptNumber).toBe(1);

    /*
      |--------------------------------------------------------------------------
      | Customer-Safe Response
      |--------------------------------------------------------------------------
      */

    expect(responsePayment.createdBy).toBeUndefined();

    expect(responsePayment.failure).toBeUndefined();

    expect(responsePayment.providerReference.signature).toBeUndefined();

    /*
      |--------------------------------------------------------------------------
      | Stored Payment
      |--------------------------------------------------------------------------
      */

    const storedPayments = await PaymentTransaction.find({
      order: order.id,
    }).lean();

    expect(storedPayments).toHaveLength(1);

    expect(String(storedPayments[0].customer)).toBe(String(customer._id));

    expect(storedPayments[0].amount).toBe(storedOrderBefore.totals.grandTotal);

    expect(storedPayments[0].attemptNumber).toBe(1);

    /*
      |--------------------------------------------------------------------------
      | Order Must NOT Be Marked Paid Yet
      |--------------------------------------------------------------------------
      */

    const storedOrderAfter = await Order.findById(order.id).lean();

    expect(storedOrderAfter.payment.status).toBe("pending");

    /*
      |--------------------------------------------------------------------------
      | Inventory Must Remain Reserved
      |--------------------------------------------------------------------------
      */

    const productAfter = await Product.findById(product._id).lean();

    const variantAfter = findProductVariant(productAfter, variant._id);

    expect(variantAfter.inventory.stock).toBe(variantBefore.inventory.stock);

    expect(variantAfter.inventory.reservedStock).toBe(
      variantBefore.inventory.reservedStock,
    );

    const ledgerAfter = await ProductInventoryLedger.find({
      referenceId: order.orderNumber,
    }).lean();

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    expect(ledgerAfter.map((entry) => entry.operation)).toEqual(["reserve"]);
  });

  /*
    |--------------------------------------------------------------------------
    | 7. Same Provider Reuse
    |--------------------------------------------------------------------------
    */

  it("reuses the existing active Payment attempt for the same provider", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    const url = `/api/v1/orders/${order.id}/payments`;

    /*
      |--------------------------------------------------------------------------
      | First Request
      |--------------------------------------------------------------------------
      */

    const firstResponse = await customerAgent.post(url).send({
      provider: "razorpay",
    });

    expect(firstResponse.status).toBe(201);

    expect(firstResponse.body.data.action).toBe("create");

    /*
      |--------------------------------------------------------------------------
      | Second Request
      |--------------------------------------------------------------------------
      */

    const secondResponse = await customerAgent.post(url).send({
      provider: "razorpay",
    });

    expect(secondResponse.status).toBe(200);

    expect(secondResponse.body.data.action).toBe("reuse");

    expect(secondResponse.body.data.payment.id).toBe(
      firstResponse.body.data.payment.id,
    );

    expect(secondResponse.body.data.payment.paymentNumber).toBe(
      firstResponse.body.data.payment.paymentNumber,
    );

    expect(secondResponse.body.data.payment.attemptNumber).toBe(1);

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | 8. Different Provider Conflict
    |--------------------------------------------------------------------------
    */

  it("rejects a different provider while another Payment attempt is active", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    const url = `/api/v1/orders/${order.id}/payments`;

    await customerAgent
      .post(url)
      .send({
        provider: "razorpay",
      })
      .expect(201);

    const response = await customerAgent.post(url).send({
      provider: "stripe",
    });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_PAYMENT_ATTEMPT_ALREADY_ACTIVE",
    );

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | 9. Order Status Invalid
    |--------------------------------------------------------------------------
    */

  it("rejects Payment initiation when the Order is no longer pending", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    /*
     * Deliberately alter persisted state directly.
     *
     * We are testing the Payment service guard,
     * not Order transition behavior.
     */

    await Order.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(String(order.id)),
      },

      {
        $set: {
          status: "confirmed",
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_ONLINE_PAYMENT_STATUS_INVALID");

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 10. Payment State Invalid
    |--------------------------------------------------------------------------
    */

  it("rejects Payment initiation when the Order payment state is already paid", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    await Order.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(String(order.id)),
      },

      {
        $set: {
          "payment.status": "paid",

          "payment.paidAt": new Date(),
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_ONLINE_PAYMENT_STATE_INVALID");

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 11. Inventory Reservation Invalid
    |--------------------------------------------------------------------------
    */

  it("rejects Payment initiation when Order inventory is no longer reserved", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    await Order.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(String(order.id)),
      },

      {
        $set: {
          inventoryStatus: "released",
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe(
      "ORDER_ONLINE_PAYMENT_INVENTORY_STATE_INVALID",
    );

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(0);
  });

  /*
    |--------------------------------------------------------------------------
    | 12. Successful Transaction / Order State Conflict
    |--------------------------------------------------------------------------
    */

  it("blocks another Payment when a successful PaymentTransaction exists but Order payment still says pending", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    /*
      |--------------------------------------------------------------------------
      | Create Attempt
      |--------------------------------------------------------------------------
      */

    const firstResponse = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(firstResponse.status).toBe(201);

    /*
      |--------------------------------------------------------------------------
      | Simulate Provider-Success Transaction
      |--------------------------------------------------------------------------
      |
      | Order.payment deliberately remains pending.
      |
      | This represents a reconciliation mismatch that must
      | NEVER trigger another charge.
      |--------------------------------------------------------------------------
      */

    await PaymentTransaction.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(firstResponse.body.data.payment.id),
      },

      {
        $set: {
          status: "paid",

          paidAt: new Date(),
        },
      },
    );

    const response = await customerAgent
      .post(`/api/v1/orders/${order.id}/payments`)
      .send({
        provider: "razorpay",
      });

    expect(response.status).toBe(409);

    expect(response.body.errorCode).toBe("ORDER_PAYMENT_STATE_CONFLICT");

    expect(
      await PaymentTransaction.countDocuments({
        order: order.id,
      }),
    ).toBe(1);
  });

  /*
    |--------------------------------------------------------------------------
    | 13. Failed Attempt → Retry
    |--------------------------------------------------------------------------
    */

  it("creates the next attempt number after a failed Payment attempt", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    const url = `/api/v1/orders/${order.id}/payments`;

    /*
      |--------------------------------------------------------------------------
      | Attempt #1
      |--------------------------------------------------------------------------
      */

    const firstResponse = await customerAgent.post(url).send({
      provider: "razorpay",
    });

    expect(firstResponse.status).toBe(201);

    expect(firstResponse.body.data.payment.attemptNumber).toBe(1);

    /*
      |--------------------------------------------------------------------------
      | Mark Attempt #1 Failed
      |--------------------------------------------------------------------------
      */

    await PaymentTransaction.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(firstResponse.body.data.payment.id),
      },

      {
        $set: {
          status: "failed",

          "failure.code": "TEST_PAYMENT_FAILED",

          "failure.message": "Payment failed during integration test.",

          "failure.reason": "test-failure",

          "failure.failedAt": new Date(),
        },
      },
    );

    /*
      |--------------------------------------------------------------------------
      | Retry
      |--------------------------------------------------------------------------
      */

    const secondResponse = await customerAgent.post(url).send({
      provider: "razorpay",
    });

    expect(secondResponse.status).toBe(201);

    expect(secondResponse.body.data.action).toBe("create");

    expect(secondResponse.body.data.payment.attemptNumber).toBe(2);

    expect(secondResponse.body.data.payment.paymentNumber).not.toBe(
      firstResponse.body.data.payment.paymentNumber,
    );

    const payments = await PaymentTransaction.find({
      order: order.id,
    })
      .sort({
        attemptNumber: 1,
      })
      .lean();

    expect(payments).toHaveLength(2);

    expect(payments.map((payment) => payment.attemptNumber)).toEqual([1, 2]);

    expect(payments.map((payment) => payment.status)).toEqual([
      "failed",
      "pending",
    ]);
  });

  /*
    |--------------------------------------------------------------------------
    | 14. Concurrent Double Click
    |--------------------------------------------------------------------------
    */

  it("creates only one PaymentTransaction when the same customer initiates Payment concurrently", async () => {
    const { agent: customerAgent } = await createAuthenticatedCustomerAgent();

    const category = await createActiveCategoryFixture();

    const product = await createActiveProductFixture({
      category: category._id,
    });

    const order = await createOnlinePaymentOrderFixture({
      customerAgent,

      product,
    });

    const url = `/api/v1/orders/${order.id}/payments`;

    /*
      |--------------------------------------------------------------------------
      | Fire Both Requests Together
      |--------------------------------------------------------------------------
      */

    const [firstResponse, secondResponse] = await Promise.all([
      customerAgent.post(url).send({
        provider: "razorpay",
      }),

      customerAgent.post(url).send({
        provider: "razorpay",
      }),
    ]);

    /*
      |--------------------------------------------------------------------------
      | One Creates, One Reuses
      |--------------------------------------------------------------------------
      */

    const statuses = [firstResponse.status, secondResponse.status].sort(
      (first, second) => first - second,
    );

    expect(statuses).toEqual([200, 201]);

    const actions = [
      firstResponse.body.data.action,

      secondResponse.body.data.action,
    ].sort();

    expect(actions).toEqual(["create", "reuse"]);

    /*
      |--------------------------------------------------------------------------
      | Both Responses Refer To Same Payment
      |--------------------------------------------------------------------------
      */

    expect(firstResponse.body.data.payment.id).toBe(
      secondResponse.body.data.payment.id,
    );

    expect(firstResponse.body.data.payment.paymentNumber).toBe(
      secondResponse.body.data.payment.paymentNumber,
    );

    expect(firstResponse.body.data.payment.attemptNumber).toBe(1);

    expect(secondResponse.body.data.payment.attemptNumber).toBe(1);

    /*
      |--------------------------------------------------------------------------
      | Database Has Exactly One Attempt
      |--------------------------------------------------------------------------
      */

    const payments = await PaymentTransaction.find({
      order: order.id,
    }).lean();

    expect(payments).toHaveLength(1);

    expect(payments[0].attemptNumber).toBe(1);

    expect(payments[0].status).toBe("pending");

    expect(firstResponse.body.data.payment.providerReference.orderId).toBe(
      secondResponse.body.data.payment.providerReference.orderId,
    );

    expect(firstResponse.body.data.checkout.orderId).toBe(
      secondResponse.body.data.checkout.orderId,
    );
  });
});
