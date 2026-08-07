import { z } from "zod";

import {
  MAX_ORDER_ITEMS,
  MAX_ORDER_ITEM_QUANTITY,
  ORDER_PAYMENT_METHOD_VALUES,
  ORDER_INVENTORY_STATUS_VALUES,
  ORDER_PAYMENT_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  ORDER_RETURN_REASON_VALUES,
  ORDER_RETURN_RESOLUTION_VALUES,
  ORDER_RETURN_STATUS_VALUES,
} from "../../shared/constants/order.constants.js";

/*
|--------------------------------------------------------------------------
| Order Validation Values
|--------------------------------------------------------------------------
*/

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const INDIAN_POSTAL_CODE_PATTERN = /^[1-9][0-9]{5}$/;

const PHONE_NUMBER_PATTERN = /^\+?[1-9][0-9]{9,14}$/;

/*
|--------------------------------------------------------------------------
| Customer Order List Values
|--------------------------------------------------------------------------
*/

const CUSTOMER_ORDER_SORT_FIELD_VALUES = Object.freeze([
  "createdAt",
  "updatedAt",
  "orderNumber",
  "grandTotal",
]);

/*
|--------------------------------------------------------------------------
| Admin Order List Values
|--------------------------------------------------------------------------
*/

const ADMIN_ORDER_SORT_FIELD_VALUES = Object.freeze([
  "createdAt",
  "updatedAt",
  "orderNumber",
  "grandTotal",
  "status",
  "paymentStatus",
]);

const SORT_DIRECTION_VALUES = Object.freeze(["asc", "desc"]);

/*
|--------------------------------------------------------------------------
| ObjectId Schema
|--------------------------------------------------------------------------
*/

const objectIdSchema = z
  .string({
    error: "ID must be a string",
  })
  .trim()
  .regex(OBJECT_ID_PATTERN, {
    error: "ID must be a valid ObjectId",
  });

/*
|--------------------------------------------------------------------------
| Empty Request Object
|--------------------------------------------------------------------------
|
| GET requests normally do not contain a body.
| Convert undefined or null into an empty object.
|--------------------------------------------------------------------------
*/

const emptyObjectSchema = z.preprocess((value) => {
  return value ?? {};
}, z.strictObject({}));

/*
|--------------------------------------------------------------------------
| Query Integer
|--------------------------------------------------------------------------
|
| Express query values arrive as strings.
|
| "1"  → 1
| "20" → 20
|--------------------------------------------------------------------------
*/

const createQueryIntegerSchema = ({ fieldName, minimum, maximum }) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalizedValue = value.trim();

      if (!/^\d+$/.test(normalizedValue)) {
        return Number.NaN;
      }

      return Number(normalizedValue);
    },

    z
      .number({
        error: `${fieldName} must be a number`,
      })
      .int({
        error: `${fieldName} must be a whole number`,
      })
      .min(minimum, {
        error: `${fieldName} must be at least ${minimum}`,
      })
      .max(maximum, {
        error: `${fieldName} cannot exceed ${maximum}`,
      }),
  );
};

/*
|--------------------------------------------------------------------------
| Admin Order Date Query
|--------------------------------------------------------------------------
|
| Supports:
|
| 2026-08-01
| 2026-08-01T10:30:00.000Z
|--------------------------------------------------------------------------
*/

const createOrderDateQuerySchema = ({ fieldName, endOfDay = false }) => {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const normalizedValue = value.trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return new Date(
          `${normalizedValue}` +
            (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"),
        );
      }

      const parsedDate = new Date(normalizedValue);

      if (Number.isNaN(parsedDate.getTime())) {
        return value;
      }

      return parsedDate;
    },

    z.date({
      error: `${fieldName} must be a valid date`,
    }),
  );
};

/*
|--------------------------------------------------------------------------
| Admin Order Total Query
|--------------------------------------------------------------------------
*/

const createOrderTotalQuerySchema = (fieldName) => {
  return createQueryIntegerSchema({
    fieldName,

    minimum: 0,

    maximum: 1_000_000_000,
  });
};

/*
|--------------------------------------------------------------------------
| Admin Order List Query
|--------------------------------------------------------------------------
*/

const adminOrderListQuerySchema = z
  .strictObject({
    page: createQueryIntegerSchema({
      fieldName: "Page",

      minimum: 1,

      maximum: 100000,
    })
      .optional()
      .default(1),

    limit: createQueryIntegerSchema({
      fieldName: "Limit",

      minimum: 1,

      maximum: 100,
    })
      .optional()
      .default(20),

    search: z
      .string({
        error: "Search must be text",
      })
      .trim()
      .min(1, {
        error: "Search cannot be empty",
      })
      .max(100, {
        error: "Search cannot exceed 100 characters",
      })
      .optional(),

    customerId: objectIdSchema.optional(),

    status: z
      .enum(ORDER_STATUS_VALUES, {
        error: "Invalid Order status",
      })
      .optional(),

    paymentStatus: z
      .enum(ORDER_PAYMENT_STATUS_VALUES, {
        error: "Invalid Order payment status",
      })
      .optional(),

    paymentMethod: z
      .enum(ORDER_PAYMENT_METHOD_VALUES, {
        error: "Invalid Order payment method",
      })
      .optional(),

    inventoryStatus: z
      .enum(ORDER_INVENTORY_STATUS_VALUES, {
        error: "Invalid Order inventory status",
      })
      .optional(),

    dateFrom: createOrderDateQuerySchema({
      fieldName: "Date from",
    }).optional(),

    dateTo: createOrderDateQuerySchema({
      fieldName: "Date to",

      endOfDay: true,
    }).optional(),

    minTotal: createOrderTotalQuerySchema("Minimum total").optional(),

    maxTotal: createOrderTotalQuerySchema("Maximum total").optional(),

    sortBy: z
      .enum(ADMIN_ORDER_SORT_FIELD_VALUES, {
        error: "Invalid admin Order sorting field",
      })
      .optional()
      .default("createdAt"),

    sortDirection: z
      .enum(SORT_DIRECTION_VALUES, {
        error: "Order sort direction must be asc or desc",
      })
      .optional()
      .default("desc"),
  })
  .superRefine((query, context) => {
    /*
        |--------------------------------------------------------------------------
        | Validate Date Range
        |--------------------------------------------------------------------------
        */

    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      context.addIssue({
        code: "custom",

        path: ["dateTo"],

        message: "Date to must be greater than or equal to date from",
      });
    }

    /*
        |--------------------------------------------------------------------------
        | Validate Total Range
        |--------------------------------------------------------------------------
        */

    if (
      query.minTotal !== undefined &&
      query.maxTotal !== undefined &&
      query.minTotal > query.maxTotal
    ) {
      context.addIssue({
        code: "custom",

        path: ["maxTotal"],

        message: "Maximum total must be greater than or equal to minimum total",
      });
    }
  });

/*
|--------------------------------------------------------------------------
| Admin Order Return List Query
|--------------------------------------------------------------------------
*/

const adminOrderReturnListQuerySchema = z.strictObject({
  page: z.coerce
    .number({
      error: "Page must be a number",
    })
    .int({
      error: "Page must be a whole number",
    })
    .min(1, {
      error: "Page must be at least 1",
    })
    .default(1),

  limit: z.coerce
    .number({
      error: "Limit must be a number",
    })
    .int({
      error: "Limit must be a whole number",
    })
    .min(1, {
      error: "Limit must be at least 1",
    })
    .max(100, {
      error: "Limit cannot exceed 100",
    })
    .default(20),

  search: z
    .string({
      error: "Search must be text",
    })
    .trim()
    .min(1, {
      error: "Search cannot be empty",
    })
    .max(100, {
      error: "Search cannot exceed 100 characters",
    })
    .optional(),

  status: z
    .enum(ORDER_RETURN_STATUS_VALUES, {
      error: "Invalid Return Request status",
    })
    .optional(),

  requestedResolution: z
    .enum(ORDER_RETURN_RESOLUTION_VALUES, {
      error: "Invalid requested resolution",
    })
    .optional(),

  customerId: objectIdSchema.optional(),

  orderId: objectIdSchema.optional(),

  sortBy: z
    .enum(["createdAt", "updatedAt", "returnRequestNumber", "status"], {
      error: "Invalid Return Request sort field",
    })
    .default("createdAt"),

  sortDirection: z
    .enum(["asc", "desc"], {
      error: "Sort direction must be asc or desc",
    })
    .default("desc"),
});

/*
|--------------------------------------------------------------------------
| Customer Return List Query
|--------------------------------------------------------------------------
*/

const customerOrderReturnListQuerySchema = z.strictObject({
  page: z.coerce
    .number({
      error: "Page must be a number",
    })
    .int({
      error: "Page must be a whole number",
    })
    .min(1, {
      error: "Page must be at least 1",
    })
    .default(1),

  limit: z.coerce
    .number({
      error: "Limit must be a number",
    })
    .int({
      error: "Limit must be a whole number",
    })
    .min(1, {
      error: "Limit must be at least 1",
    })
    .max(100, {
      error: "Limit cannot exceed 100",
    })
    .default(20),

  status: z
    .enum(ORDER_RETURN_STATUS_VALUES, {
      error: "Invalid return-request status",
    })
    .optional(),

  requestedResolution: z
    .enum(ORDER_RETURN_RESOLUTION_VALUES, {
      error: "Invalid requested return resolution",
    })
    .optional(),

  sortDirection: z
    .enum(["asc", "desc"], {
      error: "Sort direction must be asc or desc",
    })
    .default("desc"),
});

/*
|--------------------------------------------------------------------------
| Customer Return Request Parameters
|--------------------------------------------------------------------------
*/

const customerOrderReturnParamsSchema = z.strictObject({
  returnRequestId: objectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Phone Number Schema
|--------------------------------------------------------------------------
|
| Accepted examples:
|
| 9876543210
| +919876543210
| 98765 43210
| +91-98765-43210
|--------------------------------------------------------------------------
*/

const phoneNumberSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    return value.trim().replace(/[\s()-]/g, "");
  },

  z
    .string({
      error: "Phone number must be a string",
    })
    .regex(PHONE_NUMBER_PATTERN, {
      error: "Phone number must be valid",
    }),
);

/*
|--------------------------------------------------------------------------
| Customer Order Parameters
|--------------------------------------------------------------------------
*/

const customerOrderParamsSchema = z.strictObject({
  orderId: objectIdSchema,
});

/*
|--------------------------------------------------------------------------
| Create Order Item
|--------------------------------------------------------------------------
|
| Product details and prices are not accepted from the customer.
|
| The service will load:
|
| - Product name
| - Product slug
| - SKU
| - Size
| - Colour
| - Image
| - Current selling price
| - Current discount price
|--------------------------------------------------------------------------
*/

const createOrderItemSchema = z.strictObject({
  productId: objectIdSchema,

  variantId: objectIdSchema,

  quantity: z
    .number({
      error: "Order item quantity must be a number",
    })
    .int({
      error: "Order item quantity must be a whole number",
    })
    .min(1, {
      error: "Order item quantity must be at least 1",
    })
    .max(MAX_ORDER_ITEM_QUANTITY, {
      error: `Order item quantity cannot exceed ${MAX_ORDER_ITEM_QUANTITY}`,
    }),
});

/*
|--------------------------------------------------------------------------
| Create Order Items
|--------------------------------------------------------------------------
*/

const createOrderItemsSchema = z
  .array(createOrderItemSchema, {
    error: "Order items must be an array",
  })
  .min(1, {
    error: "Order must contain at least one item",
  })
  .max(MAX_ORDER_ITEMS, {
    error: `Order cannot contain more than ${MAX_ORDER_ITEMS} items`,
  })
  .superRefine((items, context) => {
    const seenVariants = new Map();

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      const itemKey = `${item.productId}:${item.variantId}`;

      if (seenVariants.has(itemKey)) {
        context.addIssue({
          code: "custom",

          path: [index, "variantId"],

          message: "Order cannot contain duplicate Product variants",
        });

        continue;
      }

      seenVariants.set(itemKey, index);
    }
  });

/*
|--------------------------------------------------------------------------
| Create Order Shipping Address
|--------------------------------------------------------------------------
*/

const createOrderShippingAddressSchema = z.strictObject({
  fullName: z
    .string({
      error: "Shipping full name must be a string",
    })
    .trim()
    .min(2, {
      error: "Shipping full name must contain at least 2 characters",
    })
    .max(150, {
      error: "Shipping full name cannot exceed 150 characters",
    }),

  phone: phoneNumberSchema,

  alternatePhone: phoneNumberSchema.optional(),

  email: z
    .string({
      error: "Shipping email must be a string",
    })
    .trim()
    .toLowerCase()
    .email({
      error: "Shipping email must be valid",
    })
    .max(254, {
      error: "Shipping email cannot exceed 254 characters",
    })
    .optional(),

  addressLine1: z
    .string({
      error: "Shipping address line 1 must be a string",
    })
    .trim()
    .min(5, {
      error: "Shipping address line 1 must contain at least 5 characters",
    })
    .max(250, {
      error: "Shipping address line 1 cannot exceed 250 characters",
    }),

  addressLine2: z
    .string({
      error: "Shipping address line 2 must be a string",
    })
    .trim()
    .min(1, {
      error: "Shipping address line 2 cannot be empty",
    })
    .max(250, {
      error: "Shipping address line 2 cannot exceed 250 characters",
    })
    .optional(),

  landmark: z
    .string({
      error: "Shipping landmark must be a string",
    })
    .trim()
    .min(1, {
      error: "Shipping landmark cannot be empty",
    })
    .max(150, {
      error: "Shipping landmark cannot exceed 150 characters",
    })
    .optional(),

  city: z
    .string({
      error: "Shipping city must be a string",
    })
    .trim()
    .min(2, {
      error: "Shipping city must contain at least 2 characters",
    })
    .max(100, {
      error: "Shipping city cannot exceed 100 characters",
    }),

  state: z
    .string({
      error: "Shipping state must be a string",
    })
    .trim()
    .min(2, {
      error: "Shipping state must contain at least 2 characters",
    })
    .max(100, {
      error: "Shipping state cannot exceed 100 characters",
    }),

  postalCode: z
    .string({
      error: "Shipping postal code must be a string",
    })
    .trim()
    .regex(INDIAN_POSTAL_CODE_PATTERN, {
      error: "Shipping postal code must be a valid 6-digit Indian PIN code",
    }),

  country: z
    .string({
      error: "Shipping country must be a string",
    })
    .trim()
    .refine(
      (value) => {
        return value.toLowerCase() === "india";
      },
      {
        error: "Shipping country must be India",
      },
    )
    .transform(() => {
      return "India";
    })
    .optional()
    .default("India"),
});

/*
|--------------------------------------------------------------------------
| Create Order Body
|--------------------------------------------------------------------------
*/

const createOrderBodySchema = z.strictObject({
  items: createOrderItemsSchema,

  shippingAddress: createOrderShippingAddressSchema,

  paymentMethod: z.enum(ORDER_PAYMENT_METHOD_VALUES, {
    error: "Invalid Order payment method",
  }),

  customerNote: z
    .string({
      error: "Customer note must be a string",
    })
    .trim()
    .min(1, {
      error: "Customer note cannot be empty",
    })
    .max(500, {
      error: "Customer note cannot exceed 500 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Customer Order Return Item
|--------------------------------------------------------------------------
|
| Only orderItemId is accepted from the customer.
|
| Product ID, variant ID, SKU and product name will be copied from
| the trusted Order item snapshot by the service layer.
|--------------------------------------------------------------------------
*/

const customerOrderReturnItemSchema = z.strictObject({
  orderItemId: objectIdSchema,

  quantity: z.coerce
    .number({
      error: "Return quantity must be a number",
    })
    .int({
      error: "Return quantity must be a whole number",
    })
    .min(1, {
      error: "Return quantity must be at least 1",
    })
    .max(MAX_ORDER_ITEM_QUANTITY, {
      error: `Return quantity cannot exceed ${MAX_ORDER_ITEM_QUANTITY}`,
    }),

  reason: z.enum(ORDER_RETURN_REASON_VALUES, {
    error: "Invalid return reason",
  }),

  details: z
    .string({
      error: "Return details must be text",
    })
    .trim()
    .min(5, {
      error: "Return details must contain at least 5 characters",
    })
    .max(500, {
      error: "Return details cannot exceed 500 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Customer Order Return Body
|--------------------------------------------------------------------------
*/

const customerOrderReturnBodySchema = z
  .strictObject({
    requestedResolution: z.enum(ORDER_RETURN_RESOLUTION_VALUES, {
      error: "Invalid requested return resolution",
    }),

    items: z
      .array(customerOrderReturnItemSchema, {
        error: "Return items are required",
      })
      .min(1, {
        error: "At least one return item is required",
      })
      .max(MAX_ORDER_ITEMS, {
        error: `A return request cannot contain more than ${MAX_ORDER_ITEMS} items`,
      }),

    customerNote: z
      .string({
        error: "Customer note must be text",
      })
      .trim()
      .max(1000, {
        error: "Customer note cannot exceed 1000 characters",
      })
      .optional(),
  })
  .superRefine((value, context) => {
    const seenOrderItemIds = new Set();

    value.items.forEach((item, index) => {
      if (seenOrderItemIds.has(item.orderItemId)) {
        context.addIssue({
          code: "custom",

          path: ["items", index, "orderItemId"],

          message: "The same Order item cannot appear more than once",
        });

        return;
      }

      seenOrderItemIds.add(item.orderItemId);
    });
  });

/*
|--------------------------------------------------------------------------
| Customer Return Cancellation Body
|--------------------------------------------------------------------------
*/

const customerOrderReturnCancellationBodySchema = z.strictObject({
  reason: z
    .string({
      error: "Cancellation reason is required",
    })
    .trim()
    .min(5, {
      error: "Cancellation reason must contain at least 5 characters",
    })
    .max(500, {
      error: "Cancellation reason cannot exceed 500 characters",
    }),
});

/*
|--------------------------------------------------------------------------
| Admin Return Mark-In-Transit Body
|--------------------------------------------------------------------------
*/

const adminOrderReturnMarkInTransitBodySchema = z.strictObject({
  carrier: z
    .string({
      error: "Return carrier is required",
    })
    .trim()
    .min(2, {
      error: "Return carrier must contain at least 2 characters",
    })
    .max(100, {
      error: "Return carrier cannot exceed 100 characters",
    }),

  trackingNumber: z
    .string({
      error: "Return tracking number is required",
    })
    .trim()
    .min(3, {
      error: "Return tracking number must contain at least 3 characters",
    })
    .max(100, {
      error: "Return tracking number cannot exceed 100 characters",
    }),

  trackingUrl: z
    .string({
      error: "Return tracking URL must be text",
    })
    .trim()
    .url({
      error: "Return tracking URL must be valid",
    })
    .max(500, {
      error: "Return tracking URL cannot exceed 500 characters",
    })
    .optional(),

  note: z
    .string({
      error: "Return shipment note must be text",
    })
    .trim()
    .max(1000, {
      error: "Return shipment note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Return Warehouse Receipt Body
|--------------------------------------------------------------------------
*/

const adminOrderReturnReceiptBodySchema = z.strictObject({
  note: z
    .string({
      error: "Warehouse receipt note must be text",
    })
    .trim()
    .max(1000, {
      error: "Warehouse receipt note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Return Approval Body
|--------------------------------------------------------------------------
|
| Approval itself does not require customer-controlled data.
|
| The backend generates:
|
| - status
| - approvedBy
| - approvedAt
| - updatedBy
|--------------------------------------------------------------------------
*/

const adminOrderReturnApprovalBodySchema = z.strictObject({
  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Return Rejection Body
|--------------------------------------------------------------------------
*/

const adminOrderReturnRejectionBodySchema = z.strictObject({
  reason: z
    .string({
      error: "Rejection reason is required",
    })
    .trim()
    .min(5, {
      error: "Rejection reason must contain at least 5 characters",
    })
    .max(500, {
      error: "Rejection reason cannot exceed 500 characters",
    }),

  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Return Inspection Item
|--------------------------------------------------------------------------
*/

const adminOrderReturnInspectionItemSchema = z.strictObject({
  orderItemId: objectIdSchema,

  resellableQuantity: z.coerce
    .number({
      error: "Resellable quantity must be a number",
    })
    .int({
      error: "Resellable quantity must be a whole number",
    })
    .min(0, {
      error: "Resellable quantity cannot be negative",
    }),

  damagedQuantity: z.coerce
    .number({
      error: "Damaged quantity must be a number",
    })
    .int({
      error: "Damaged quantity must be a whole number",
    })
    .min(0, {
      error: "Damaged quantity cannot be negative",
    }),

  rejectedQuantity: z.coerce
    .number({
      error: "Rejected quantity must be a number",
    })
    .int({
      error: "Rejected quantity must be a whole number",
    })
    .min(0, {
      error: "Rejected quantity cannot be negative",
    }),

  note: z
    .string({
      error: "Inspection note must be text",
    })
    .trim()
    .max(1000, {
      error: "Inspection note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Return Inspection Body
|--------------------------------------------------------------------------
*/

const adminOrderReturnInspectionBodySchema = z
  .strictObject({
    items: z.array(adminOrderReturnInspectionItemSchema).min(1, {
      error: "At least one Return item must be inspected",
    }),
  })
  .superRefine((value, context) => {
    const seenOrderItemIds = new Set();

    value.items.forEach((item, index) => {
      const orderItemId = String(item.orderItemId);

      if (seenOrderItemIds.has(orderItemId)) {
        context.addIssue({
          code: "custom",

          path: ["items", index, "orderItemId"],

          message: "The same Order item cannot be inspected more than once",
        });

        return;
      }

      seenOrderItemIds.add(orderItemId);
    });
  });

/*
|--------------------------------------------------------------------------
| Admin Return Completion Body
|--------------------------------------------------------------------------
|
| Inventory quantities are NOT accepted here.
|
| They come exclusively from the trusted warehouse inspection.
|--------------------------------------------------------------------------
*/

const adminOrderReturnCompletionBodySchema = z.strictObject({
  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Customer Order Cancellation Body
|--------------------------------------------------------------------------
*/

const customerOrderCancellationBodySchema = z.strictObject({
  reason: z
    .string({
      error: "Cancellation reason is required",
    })
    .trim()
    .min(5, {
      error: "Cancellation reason must contain at least 5 characters",
    })
    .max(500, {
      error: "Cancellation reason cannot exceed 500 characters",
    }),
});

/*
|--------------------------------------------------------------------------
| Customer Order List Query
|--------------------------------------------------------------------------
*/

const customerOrderListQuerySchema = z.strictObject({
  page: createQueryIntegerSchema({
    fieldName: "Page",

    minimum: 1,

    maximum: 100000,
  })
    .optional()
    .default(1),

  limit: createQueryIntegerSchema({
    fieldName: "Limit",

    minimum: 1,

    maximum: 50,
  })
    .optional()
    .default(20),

  status: z
    .enum(ORDER_STATUS_VALUES, {
      error: "Invalid Order status",
    })
    .optional(),

  paymentStatus: z
    .enum(ORDER_PAYMENT_STATUS_VALUES, {
      error: "Invalid Order payment status",
    })
    .optional(),

  inventoryStatus: z
    .enum(ORDER_INVENTORY_STATUS_VALUES, {
      error: "Invalid Order inventory status",
    })
    .optional(),

  sortBy: z
    .enum(CUSTOMER_ORDER_SORT_FIELD_VALUES, {
      error: "Invalid Order sorting field",
    })
    .optional()
    .default("createdAt"),

  sortDirection: z
    .enum(SORT_DIRECTION_VALUES, {
      error: "Order sort direction must be asc or desc",
    })
    .optional()
    .default("desc"),
});

/*
|--------------------------------------------------------------------------
| Admin Order Status Update Body
|--------------------------------------------------------------------------
*/

const adminOrderStatusUpdateBodySchema = z.strictObject({
  status: z.enum(ORDER_STATUS_VALUES, {
    error: "Invalid Order status",
  }),

  note: z
    .string({
      error: "Status note must be text",
    })
    .trim()
    .min(3, {
      error: "Status note must contain at least 3 characters",
    })
    .max(500, {
      error: "Status note cannot exceed 500 characters",
    })
    .optional(),

  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Order Shipment Body
|--------------------------------------------------------------------------
*/

const adminOrderShipmentBodySchema = z.strictObject({
  carrier: z
    .string({
      error: "Shipment carrier is required",
    })
    .trim()
    .min(2, {
      error: "Shipment carrier must contain at least 2 characters",
    })
    .max(100, {
      error: "Shipment carrier cannot exceed 100 characters",
    }),

  trackingNumber: z
    .string({
      error: "Tracking number is required",
    })
    .trim()
    .min(3, {
      error: "Tracking number must contain at least 3 characters",
    })
    .max(100, {
      error: "Tracking number cannot exceed 100 characters",
    }),

  trackingUrl: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }

      return value;
    },

    z
      .string({
        error: "Tracking URL must be text",
      })
      .trim()
      .url({
        error: "Tracking URL must be a valid URL",
      })
      .max(2048, {
        error: "Tracking URL cannot exceed 2048 characters",
      })
      .optional(),
  ),

  note: z
    .string({
      error: "Shipment note must be text",
    })
    .trim()
    .min(3, {
      error: "Shipment note must contain at least 3 characters",
    })
    .max(500, {
      error: "Shipment note cannot exceed 500 characters",
    })
    .optional(),

  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Order Delivery Body
|--------------------------------------------------------------------------
*/

const adminOrderDeliveryBodySchema = z.strictObject({
  note: z
    .string({
      error: "Delivery note must be text",
    })
    .trim()
    .min(3, {
      error: "Delivery note must contain at least 3 characters",
    })
    .max(500, {
      error: "Delivery note cannot exceed 500 characters",
    })
    .optional(),

  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Admin Order Refund Body
|--------------------------------------------------------------------------
|
| This endpoint records a completed full refund.
|
| The refund amount, currency, timestamp, Order status and payment status
| are generated by the backend.
|--------------------------------------------------------------------------
*/

const adminOrderRefundBodySchema = z.strictObject({
  reason: z
    .string({
      error: "Refund reason is required",
    })
    .trim()
    .min(5, {
      error: "Refund reason must contain at least 5 characters",
    })
    .max(500, {
      error: "Refund reason cannot exceed 500 characters",
    }),

  referenceId: z
    .string({
      error: "Refund reference ID is required",
    })
    .trim()
    .min(3, {
      error: "Refund reference ID must contain at least 3 characters",
    })
    .max(200, {
      error: "Refund reference ID cannot exceed 200 characters",
    }),

  note: z
    .string({
      error: "Refund note must be text",
    })
    .trim()
    .min(3, {
      error: "Refund note must contain at least 3 characters",
    })
    .max(500, {
      error: "Refund note cannot exceed 500 characters",
    })
    .optional(),

  adminNote: z
    .string({
      error: "Admin note must be text",
    })
    .trim()
    .max(1000, {
      error: "Admin note cannot exceed 1000 characters",
    })
    .optional(),
});

/*
|--------------------------------------------------------------------------
| Create Order Request
|--------------------------------------------------------------------------
|
| POST
| /api/v1/orders
|--------------------------------------------------------------------------
*/

export const createOrderRequestSchema = z.strictObject({
  body: createOrderBodySchema,

  params: emptyObjectSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Customer Order Cancellation Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/cancel
|--------------------------------------------------------------------------
*/

export const cancelCustomerOrderRequestSchema = z.strictObject({
  body: customerOrderCancellationBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Customer Order List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/orders
|--------------------------------------------------------------------------
*/

export const customerOrderListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: customerOrderListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Customer Order Details Request
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/:orderId
|--------------------------------------------------------------------------
*/

export const customerOrderDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/orders
|--------------------------------------------------------------------------
*/

export const adminOrderListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminOrderListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Details Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/orders/:orderId
|--------------------------------------------------------------------------
*/

export const adminOrderDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Status Update Request
|--------------------------------------------------------------------------
|
| PATCH /api/v1/admin/orders/:orderId/status
|--------------------------------------------------------------------------
*/

export const adminOrderStatusUpdateRequestSchema = z.strictObject({
  body: adminOrderStatusUpdateBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Shipment Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/orders/:orderId/ship
|--------------------------------------------------------------------------
*/

export const adminOrderShipmentRequestSchema = z.strictObject({
  body: adminOrderShipmentBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Delivery Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/orders/:orderId/deliver
|--------------------------------------------------------------------------
*/

export const adminOrderDeliveryRequestSchema = z.strictObject({
  body: adminOrderDeliveryBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Refund Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/orders/:orderId/refund
|--------------------------------------------------------------------------
*/

export const adminOrderRefundRequestSchema = z.strictObject({
  body: adminOrderRefundBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Customer Order Return Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/returns
|--------------------------------------------------------------------------
*/

export const customerOrderReturnRequestSchema = z.strictObject({
  body: customerOrderReturnBodySchema,

  params: customerOrderParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Customer Return List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns
|--------------------------------------------------------------------------
*/

export const customerOrderReturnListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: customerOrderReturnListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Customer Return Details Request
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const customerOrderReturnDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Customer Return Cancellation Request
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/returns/:returnRequestId/cancel
|--------------------------------------------------------------------------
*/

export const customerOrderReturnCancellationRequestSchema = z.strictObject({
  body: customerOrderReturnCancellationBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Return List Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/order-returns
|--------------------------------------------------------------------------
*/

export const adminOrderReturnListRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: emptyObjectSchema,

  query: adminOrderReturnListQuerySchema,
});

/*
|--------------------------------------------------------------------------
| Admin Order Return Details Request
|--------------------------------------------------------------------------
|
| GET /api/v1/admin/order-returns/:returnRequestId
|--------------------------------------------------------------------------
*/

export const adminOrderReturnDetailsRequestSchema = z.strictObject({
  body: emptyObjectSchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Approval Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/approve
|--------------------------------------------------------------------------
*/

export const adminOrderReturnApprovalRequestSchema = z.strictObject({
  body: adminOrderReturnApprovalBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Rejection Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/reject
|--------------------------------------------------------------------------
*/

export const adminOrderReturnRejectionRequestSchema = z.strictObject({
  body: adminOrderReturnRejectionBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Mark-In-Transit Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/mark-in-transit
|--------------------------------------------------------------------------
*/

export const adminOrderReturnMarkInTransitRequestSchema = z.strictObject({
  body: adminOrderReturnMarkInTransitBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Warehouse Receipt Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/receive
|--------------------------------------------------------------------------
*/

export const adminOrderReturnReceiptRequestSchema = z.strictObject({
  body: adminOrderReturnReceiptBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Inspection Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/inspect
|--------------------------------------------------------------------------
*/

export const adminOrderReturnInspectionRequestSchema = z.strictObject({
  body: adminOrderReturnInspectionBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});

/*
|--------------------------------------------------------------------------
| Admin Return Completion Request
|--------------------------------------------------------------------------
|
| POST /api/v1/admin/order-returns/:returnRequestId/complete
|--------------------------------------------------------------------------
*/

export const adminOrderReturnCompletionRequestSchema = z.strictObject({
  body: adminOrderReturnCompletionBodySchema,

  params: customerOrderReturnParamsSchema,

  query: emptyObjectSchema,
});
