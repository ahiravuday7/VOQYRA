/*
|--------------------------------------------------------------------------
| Normalize Return Request
|--------------------------------------------------------------------------
*/

const normalizeReturnRequest = (returnRequest) => {
  if (returnRequest && typeof returnRequest.toObject === "function") {
    return returnRequest.toObject();
  }

  return returnRequest;
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

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Customer Return Inspection
|--------------------------------------------------------------------------
|
| Internal warehouse actor IDs are not exposed to customers.
|--------------------------------------------------------------------------
*/

const mapCustomerReturnInspection = (inspection) => {
  return {
    status: inspection?.status ?? "pending",

    resellableQuantity: inspection?.resellableQuantity ?? 0,

    damagedQuantity: inspection?.damagedQuantity ?? 0,

    rejectedQuantity: inspection?.rejectedQuantity ?? 0,

    note: inspection?.note ?? null,

    inspectedAt: inspection?.inspectedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Return Item
|--------------------------------------------------------------------------
*/

const mapCustomerReturnItem = (item) => {
  return {
    id: normalizeIdentifier(item._id),

    orderItemId: normalizeIdentifier(item.orderItemId),

    productId: normalizeIdentifier(item.product),

    variantId: normalizeIdentifier(item.variantId),

    sku: item.sku,

    productName: item.productName,

    size: item.size ?? null,

    color: {
      name: item.color?.name ?? null,

      code: item.color?.code ?? null,
    },

    quantity: item.quantity,

    reason: item.reason,

    details: item.details ?? null,

    inspection: mapCustomerReturnInspection(item.inspection),
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Return Request Summary
|--------------------------------------------------------------------------
*/

export const toCustomerOrderReturnRequestSummary = (returnRequest) => {
  const normalizedReturnRequest = normalizeReturnRequest(returnRequest);

  const items = normalizedReturnRequest.items ?? [];

  const totalQuantity = items.reduce((total, item) => {
    return total + Number(item.quantity ?? 0);
  }, 0);

  return {
    id: normalizeIdentifier(normalizedReturnRequest._id),

    returnRequestNumber: normalizedReturnRequest.returnRequestNumber,

    orderId: normalizeIdentifier(normalizedReturnRequest.order),

    orderNumber: normalizedReturnRequest.orderNumber,

    requestedResolution: normalizedReturnRequest.requestedResolution,

    status: normalizedReturnRequest.status,

    itemCount: items.length,

    totalQuantity,

    createdAt: normalizedReturnRequest.createdAt,

    updatedAt: normalizedReturnRequest.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Customer Return Request
|--------------------------------------------------------------------------
|
| Hidden customer fields:
|
| - adminNote
| - approvedBy
| - rejectedBy
| - receivedBy
| - completedBy
| - inspectedBy
| - createdBy
| - updatedBy
|--------------------------------------------------------------------------
*/

export const toCustomerOrderReturnRequest = (returnRequest) => {
  const normalizedReturnRequest = normalizeReturnRequest(returnRequest);

  return {
    id: normalizeIdentifier(normalizedReturnRequest._id),

    returnRequestNumber: normalizedReturnRequest.returnRequestNumber,

    orderId: normalizeIdentifier(normalizedReturnRequest.order),

    orderNumber: normalizedReturnRequest.orderNumber,

    requestedResolution: normalizedReturnRequest.requestedResolution,

    status: normalizedReturnRequest.status,

    items: (normalizedReturnRequest.items ?? []).map(mapCustomerReturnItem),

    customerNote: normalizedReturnRequest.customerNote ?? null,

    approval: {
      approvedAt: normalizedReturnRequest.approval?.approvedAt ?? null,
    },

    rejection: {
      reason: normalizedReturnRequest.rejection?.reason ?? null,

      rejectedAt: normalizedReturnRequest.rejection?.rejectedAt ?? null,
    },

    shipment: {
      carrier: normalizedReturnRequest.shipment?.carrier ?? null,

      trackingNumber: normalizedReturnRequest.shipment?.trackingNumber ?? null,

      trackingUrl: normalizedReturnRequest.shipment?.trackingUrl ?? null,

      markedInTransitAt:
        normalizedReturnRequest.shipment?.markedInTransitAt ?? null,
    },

    receipt: {
      receivedAt: normalizedReturnRequest.receipt?.receivedAt ?? null,
    },

    completion: {
      completedAt: normalizedReturnRequest.completion?.completedAt ?? null,
    },

    cancellation: {
      reason: normalizedReturnRequest.cancellation?.reason ?? null,

      cancelledAt: normalizedReturnRequest.cancellation?.cancelledAt ?? null,
    },

    createdAt: normalizedReturnRequest.createdAt,

    updatedAt: normalizedReturnRequest.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Return Item Inspection
|--------------------------------------------------------------------------
*/

const mapAdminReturnInspection = (inspection) => {
  return {
    status: inspection?.status ?? "pending",

    resellableQuantity: inspection?.resellableQuantity ?? 0,

    damagedQuantity: inspection?.damagedQuantity ?? 0,

    rejectedQuantity: inspection?.rejectedQuantity ?? 0,

    note: inspection?.note ?? null,

    inspectedBy: normalizeIdentifier(inspection?.inspectedBy),

    inspectedAt: inspection?.inspectedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Return Item
|--------------------------------------------------------------------------
*/

const mapAdminReturnItem = (item) => {
  return {
    id: normalizeIdentifier(item._id),

    orderItemId: normalizeIdentifier(item.orderItemId),

    productId: normalizeIdentifier(item.product),

    variantId: normalizeIdentifier(item.variantId),

    sku: item.sku,

    productName: item.productName,

    size: item.size ?? null,

    color: {
      name: item.color?.name ?? null,

      code: item.color?.code ?? null,
    },

    quantity: item.quantity,

    reason: item.reason,

    details: item.details ?? null,

    inspection: mapAdminReturnInspection(item.inspection),
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Order Return Summary
|--------------------------------------------------------------------------
*/

export const toAdminOrderReturnRequestSummary = (returnRequest) => {
  const normalizedReturnRequest = normalizeReturnRequest(returnRequest);

  const items = normalizedReturnRequest.items ?? [];

  const totalQuantity = items.reduce((total, item) => {
    return total + Number(item.quantity ?? 0);
  }, 0);

  return {
    id: normalizeIdentifier(normalizedReturnRequest._id),

    returnRequestNumber: normalizedReturnRequest.returnRequestNumber,

    orderId: normalizeIdentifier(normalizedReturnRequest.order),

    orderNumber: normalizedReturnRequest.orderNumber,

    customerId: normalizeIdentifier(normalizedReturnRequest.customer),

    requestedResolution: normalizedReturnRequest.requestedResolution,

    status: normalizedReturnRequest.status,

    itemCount: items.length,

    totalQuantity,

    customerNote: normalizedReturnRequest.customerNote ?? null,

    adminNote: normalizedReturnRequest.adminNote ?? null,

    createdAt: normalizedReturnRequest.createdAt,

    updatedAt: normalizedReturnRequest.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Map Admin Order Return Request
|--------------------------------------------------------------------------
*/

export const toAdminOrderReturnRequest = (returnRequest) => {
  const normalizedReturnRequest = normalizeReturnRequest(returnRequest);

  return {
    id: normalizeIdentifier(normalizedReturnRequest._id),

    returnRequestNumber: normalizedReturnRequest.returnRequestNumber,

    orderId: normalizeIdentifier(normalizedReturnRequest.order),

    orderNumber: normalizedReturnRequest.orderNumber,

    customerId: normalizeIdentifier(normalizedReturnRequest.customer),

    requestedResolution: normalizedReturnRequest.requestedResolution,

    status: normalizedReturnRequest.status,

    items: (normalizedReturnRequest.items ?? []).map(mapAdminReturnItem),

    customerNote: normalizedReturnRequest.customerNote ?? null,

    adminNote: normalizedReturnRequest.adminNote ?? null,

    approval: {
      approvedBy: normalizeIdentifier(
        normalizedReturnRequest.approval?.approvedBy,
      ),

      approvedAt: normalizedReturnRequest.approval?.approvedAt ?? null,
    },

    rejection: {
      reason: normalizedReturnRequest.rejection?.reason ?? null,

      rejectedBy: normalizeIdentifier(
        normalizedReturnRequest.rejection?.rejectedBy,
      ),

      rejectedAt: normalizedReturnRequest.rejection?.rejectedAt ?? null,
    },

    shipment: {
      carrier: normalizedReturnRequest.shipment?.carrier ?? null,

      trackingNumber: normalizedReturnRequest.shipment?.trackingNumber ?? null,

      trackingUrl: normalizedReturnRequest.shipment?.trackingUrl ?? null,

      note: normalizedReturnRequest.shipment?.note ?? null,

      markedInTransitBy: normalizeIdentifier(
        normalizedReturnRequest.shipment?.markedInTransitBy,
      ),

      markedInTransitAt:
        normalizedReturnRequest.shipment?.markedInTransitAt ?? null,
    },

    receipt: {
      note: normalizedReturnRequest.receipt?.note ?? null,

      receivedBy: normalizeIdentifier(
        normalizedReturnRequest.receipt?.receivedBy,
      ),

      receivedAt: normalizedReturnRequest.receipt?.receivedAt ?? null,
    },

    completion: {
      completedBy: normalizeIdentifier(
        normalizedReturnRequest.completion?.completedBy,
      ),

      completedAt: normalizedReturnRequest.completion?.completedAt ?? null,
    },

    cancellation: {
      reason: normalizedReturnRequest.cancellation?.reason ?? null,

      cancelledBy: normalizeIdentifier(
        normalizedReturnRequest.cancellation?.cancelledBy,
      ),

      cancelledAt: normalizedReturnRequest.cancellation?.cancelledAt ?? null,
    },

    createdBy: normalizeIdentifier(normalizedReturnRequest.createdBy),

    updatedBy: normalizeIdentifier(normalizedReturnRequest.updatedBy),

    createdAt: normalizedReturnRequest.createdAt,

    updatedAt: normalizedReturnRequest.updatedAt,
  };
};
