/*
|--------------------------------------------------------------------------
| Normalize Order Object
|--------------------------------------------------------------------------
|
| Supports:
|
| - Mongoose documents
| - Lean objects
| - Aggregation results
|--------------------------------------------------------------------------
*/

const normalizeOrderObject = (order) => {
  if (order && typeof order.toObject === "function") {
    return order.toObject();
  }

  return order;
};

/*
|--------------------------------------------------------------------------
| Normalize Identifier
|--------------------------------------------------------------------------
*/

const normalizeIdentifier = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Order Item Pricing
|--------------------------------------------------------------------------
*/

const mapOrderItemPricing = (pricing) => {
  return {
    currency: pricing.currency,

    unitSellingPrice: pricing.unitSellingPrice,

    unitDiscountPrice: pricing.unitDiscountPrice ?? null,

    unitFinalPrice: pricing.unitFinalPrice,

    discountPerUnit: pricing.discountPerUnit,

    lineSubtotal: pricing.lineSubtotal,
  };
};

/*
|--------------------------------------------------------------------------
| Map Order Item Inventory
|--------------------------------------------------------------------------
*/

const mapOrderItemInventory = (inventory) => {
  return {
    status: inventory.status,

    reservedQuantity: inventory.reservedQuantity,

    committedQuantity: inventory.committedQuantity,

    releasedQuantity: inventory.releasedQuantity,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Order Item
|--------------------------------------------------------------------------
*/

const mapCustomerOrderItem = (item) => {
  return {
    id: normalizeIdentifier(item._id),

    productId: normalizeIdentifier(item.product),

    variantId: normalizeIdentifier(item.variantId),

    sku: item.sku,

    productName: item.productName,

    productSlug: item.productSlug,

    size: item.size,

    color: {
      name: item.color.name,

      code: item.color.code ?? null,
    },

    image: {
      url: item.image.url,

      altText: item.image.altText ?? null,
    },

    quantity: item.quantity,

    pricing: mapOrderItemPricing(item.pricing),

    inventory: mapOrderItemInventory(item.inventory),
  };
};

/*
|--------------------------------------------------------------------------
| Map Shipping Address
|--------------------------------------------------------------------------
*/

const mapOrderShippingAddress = (address) => {
  return {
    fullName: address.fullName,

    phone: address.phone,

    alternatePhone: address.alternatePhone ?? null,

    email: address.email ?? null,

    addressLine1: address.addressLine1,

    addressLine2: address.addressLine2 ?? null,

    landmark: address.landmark ?? null,

    city: address.city,

    state: address.state,

    postalCode: address.postalCode,

    country: address.country,
  };
};

/*
|--------------------------------------------------------------------------
| Map Order Totals
|--------------------------------------------------------------------------
*/

const mapOrderTotals = (totals) => {
  return {
    currency: totals.currency,

    itemsSubtotal: totals.itemsSubtotal,

    discountAmount: totals.discountAmount,

    shippingAmount: totals.shippingAmount,

    taxAmount: totals.taxAmount,

    grandTotal: totals.grandTotal,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Payment
|--------------------------------------------------------------------------
|
| Provider internals and transaction identifiers are not
| exposed during initial Order creation.
|--------------------------------------------------------------------------
*/

const mapCustomerOrderPayment = (payment) => {
  return {
    method: payment.method,

    status: payment.status,

    paidAt: payment.paidAt ?? null,

    failedAt: payment.failedAt ?? null,

    refundedAt: payment.refundedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Shipment
|--------------------------------------------------------------------------
*/

const mapCustomerOrderShipment = (shipment) => {
  return {
    carrier: shipment?.carrier ?? null,

    trackingNumber: shipment?.trackingNumber ?? null,

    trackingUrl: shipment?.trackingUrl ?? null,

    shippedAt: shipment?.shippedAt ?? null,

    deliveredAt: shipment?.deliveredAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Status History
|--------------------------------------------------------------------------
|
| changedBy is intentionally hidden from customer responses.
|--------------------------------------------------------------------------
*/

const mapCustomerOrderStatusHistory = (statusHistory = []) => {
  return statusHistory.map((historyEntry) => {
    return {
      id: normalizeIdentifier(historyEntry._id),

      status: historyEntry.status,

      note: historyEntry.note ?? null,

      changedAt: historyEntry.changedAt,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Map Customer Cancellation
|--------------------------------------------------------------------------
*/

const mapCustomerOrderCancellation = (cancellation) => {
  return {
    reason: cancellation?.reason ?? null,

    cancelledAt: cancellation?.cancelledAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Order Summary Item
|--------------------------------------------------------------------------
*/

const mapCustomerOrderSummaryItem = (item) => {
  return {
    id: normalizeIdentifier(item._id),

    productId: normalizeIdentifier(item.product),

    variantId: normalizeIdentifier(item.variantId),

    sku: item.sku,

    productName: item.productName,

    productSlug: item.productSlug,

    size: item.size,

    color: {
      name: item.color?.name ?? null,

      code: item.color?.code ?? null,
    },

    image: {
      url: item.image?.url ?? null,

      altText: item.image?.altText ?? null,
    },

    quantity: item.quantity,

    unitFinalPrice: item.pricing?.unitFinalPrice ?? 0,

    lineSubtotal: item.pricing?.lineSubtotal ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Order Summary
|--------------------------------------------------------------------------
*/

export const toCustomerOrderSummary = (order) => {
  const normalizedOrder = normalizeOrderObject(order);

  const items = normalizedOrder.items ?? [];

  const totalQuantity = items.reduce((total, item) => {
    return total + item.quantity;
  }, 0);

  return {
    id: normalizeIdentifier(normalizedOrder._id),

    orderNumber: normalizedOrder.orderNumber,

    items: items.map(mapCustomerOrderSummaryItem),

    distinctItemCount: items.length,

    totalQuantity,

    totals: mapOrderTotals(normalizedOrder.totals),

    payment: {
      method: normalizedOrder.payment?.method,

      status: normalizedOrder.payment?.status,
    },

    shipment: mapCustomerOrderShipment(normalizedOrder.shipment),

    status: normalizedOrder.status,

    inventoryStatus: normalizedOrder.inventoryStatus,

    cancellation: mapCustomerOrderCancellation(normalizedOrder.cancellation),

    createdAt: normalizedOrder.createdAt,

    updatedAt: normalizedOrder.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Order
|--------------------------------------------------------------------------
|
| Hidden internal fields:
|
| - createdBy
| - updatedBy
| - adminNote
| - cancellation.cancelledBy
| - statusHistory.changedBy
| - payment provider internals
|--------------------------------------------------------------------------
*/

export const toCustomerOrder = (order) => {
  const normalizedOrder = normalizeOrderObject(order);

  return {
    id: normalizeIdentifier(normalizedOrder._id),

    orderNumber: normalizedOrder.orderNumber,

    items: (normalizedOrder.items ?? []).map(mapCustomerOrderItem),

    shippingAddress: mapOrderShippingAddress(normalizedOrder.shippingAddress),

    totals: mapOrderTotals(normalizedOrder.totals),

    payment: mapCustomerOrderPayment(normalizedOrder.payment),

    shipment: mapCustomerOrderShipment(normalizedOrder.shipment),

    status: normalizedOrder.status,

    inventoryStatus: normalizedOrder.inventoryStatus,

    statusHistory: mapCustomerOrderStatusHistory(normalizedOrder.statusHistory),

    customerNote: normalizedOrder.customerNote ?? null,

    cancellation: mapCustomerOrderCancellation(normalizedOrder.cancellation),

    createdAt: normalizedOrder.createdAt,

    updatedAt: normalizedOrder.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Order Cancellation
|--------------------------------------------------------------------------
*/

const mapAdminOrderCancellation = (cancellation) => {
  return {
    reason: cancellation?.reason ?? null,

    cancelledBy: normalizeIdentifier(cancellation?.cancelledBy),

    cancelledAt: cancellation?.cancelledAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Order Summary
|--------------------------------------------------------------------------
|
| Admin responses include:
|
| - Customer identifier
| - Shipping details
| - Product snapshots
| - Pricing and inventory states
| - Customer and admin notes
| - Internal audit identifiers
|--------------------------------------------------------------------------
*/

export const toAdminOrderSummary = (order) => {
  const normalizedOrder = normalizeOrderObject(order);

  const items = normalizedOrder.items ?? [];

  const totalQuantity = items.reduce((total, item) => {
    return total + item.quantity;
  }, 0);

  return {
    id: normalizeIdentifier(normalizedOrder._id),

    orderNumber: normalizedOrder.orderNumber,

    customerId: normalizeIdentifier(normalizedOrder.customer),

    items: items.map(mapCustomerOrderItem),

    distinctItemCount: items.length,

    totalQuantity,

    shippingAddress: mapOrderShippingAddress(normalizedOrder.shippingAddress),

    totals: mapOrderTotals(normalizedOrder.totals),

    payment: mapCustomerOrderPayment(normalizedOrder.payment),

    shipment: mapCustomerOrderShipment(normalizedOrder.shipment),

    status: normalizedOrder.status,

    inventoryStatus: normalizedOrder.inventoryStatus,

    cancellation: mapAdminOrderCancellation(normalizedOrder.cancellation),

    customerNote: normalizedOrder.customerNote ?? null,

    adminNote: normalizedOrder.adminNote ?? null,

    createdBy: normalizeIdentifier(normalizedOrder.createdBy),

    updatedBy: normalizeIdentifier(normalizedOrder.updatedBy),

    createdAt: normalizedOrder.createdAt,

    updatedAt: normalizedOrder.updatedAt,
  };
};
