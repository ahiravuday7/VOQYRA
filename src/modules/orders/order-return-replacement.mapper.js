/*
|--------------------------------------------------------------------------
| Normalize Document
|--------------------------------------------------------------------------
*/

const normalizeReplacement = (replacement) => {
  if (!replacement) {
    return null;
  }

  if (typeof replacement.toObject === "function") {
    return replacement.toObject();
  }

  return replacement;
};

/*
|--------------------------------------------------------------------------
| Normalize ID
|--------------------------------------------------------------------------
*/

const normalizeId = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Map Color Snapshot
|--------------------------------------------------------------------------
*/

const mapReplacementColor = (color) => {
  if (!color) {
    return null;
  }

  return {
    name: color.name ?? null,

    code: color.code ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Replacement Item
|--------------------------------------------------------------------------
*/

const mapReplacementItem = (item) => {
  return {
    id: normalizeId(item._id),

    returnItemId: normalizeId(item.returnItemId),

    orderItemId: normalizeId(item.orderItemId),

    productId: normalizeId(item.product),

    variantId: normalizeId(item.variantId),

    productName: item.productName,

    sku: item.sku,

    size: item.size ?? null,

    color: mapReplacementColor(item.color),

    returnedQuantity: item.returnedQuantity,

    replacementQuantity: item.replacementQuantity,
  };
};

/*
|--------------------------------------------------------------------------
| Map Reservation
|--------------------------------------------------------------------------
*/

const mapReplacementReservation = (reservation) => {
  if (!reservation) {
    return null;
  }

  return {
    reservedBy: normalizeId(reservation.reservedBy),

    reservedAt: reservation.reservedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Processing
|--------------------------------------------------------------------------
*/

const mapReplacementProcessing = (processing) => {
  if (!processing) {
    return null;
  }

  return {
    note: processing.note ?? null,

    processedBy: normalizeId(processing.processedBy),

    processedAt: processing.processedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Shipment
|--------------------------------------------------------------------------
*/

const mapReplacementShipment = (shipment) => {
  if (!shipment) {
    return null;
  }

  return {
    carrier: shipment.carrier ?? null,

    trackingNumber: shipment.trackingNumber ?? null,

    trackingUrl: shipment.trackingUrl ?? null,

    note: shipment.note ?? null,

    shippedBy: normalizeId(shipment.shippedBy),

    shippedAt: shipment.shippedAt ?? null,

    deliveredBy: normalizeId(shipment.deliveredBy),

    deliveredAt: shipment.deliveredAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Cancellation
|--------------------------------------------------------------------------
*/

const mapReplacementCancellation = (cancellation) => {
  if (!cancellation) {
    return null;
  }

  return {
    reason: cancellation.reason ?? null,

    note: cancellation.note ?? null,

    cancelledBy: normalizeId(cancellation.cancelledBy),

    cancelledAt: cancellation.cancelledAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Map Failure
|--------------------------------------------------------------------------
*/

const mapReplacementFailure = (failure) => {
  if (!failure) {
    return null;
  }

  return {
    reason: failure.reason ?? null,

    note: failure.note ?? null,

    failedBy: normalizeId(failure.failedBy),

    failedAt: failure.failedAt ?? null,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Mapper
|--------------------------------------------------------------------------
*/

export const mapAdminOrderReturnReplacement = (replacement) => {
  const normalizedReplacement = normalizeReplacement(replacement);

  if (!normalizedReplacement) {
    return null;
  }

  return {
    id: normalizeId(normalizedReplacement._id),

    replacementNumber: normalizedReplacement.replacementNumber,

    returnRequestId: normalizeId(normalizedReplacement.returnRequest),

    returnRequestNumber: normalizedReplacement.returnRequestNumber,

    orderId: normalizeId(normalizedReplacement.order),

    orderNumber: normalizedReplacement.orderNumber,

    customerId: normalizeId(normalizedReplacement.customer),

    status: normalizedReplacement.status,

    items: (normalizedReplacement.items ?? []).map(mapReplacementItem),

    reservation: mapReplacementReservation(normalizedReplacement.reservation),

    processing: mapReplacementProcessing(normalizedReplacement.processing),

    shipment: mapReplacementShipment(normalizedReplacement.shipment),

    cancellation: mapReplacementCancellation(
      normalizedReplacement.cancellation,
    ),

    failure: mapReplacementFailure(normalizedReplacement.failure),

    createdAt: normalizedReplacement.createdAt,

    updatedAt: normalizedReplacement.updatedAt,
  };
};

/*
|--------------------------------------------------------------------------
| Admin Return Replacement Summary Mapper
|--------------------------------------------------------------------------
*/

export const mapAdminOrderReturnReplacementSummary = (replacement) => {
  const normalizedReplacement = normalizeReplacement(replacement);

  if (!normalizedReplacement) {
    return null;
  }

  const items = normalizedReplacement.items ?? [];

  const totalReplacementQuantity = items.reduce((total, item) => {
    const quantity = Number(item.replacementQuantity);

    return total + (Number.isSafeInteger(quantity) ? quantity : 0);
  }, 0);

  return {
    id: normalizeId(normalizedReplacement._id),

    replacementNumber: normalizedReplacement.replacementNumber,

    returnRequestId: normalizeId(normalizedReplacement.returnRequest),

    returnRequestNumber: normalizedReplacement.returnRequestNumber,

    orderId: normalizeId(normalizedReplacement.order),

    orderNumber: normalizedReplacement.orderNumber,

    customerId: normalizeId(normalizedReplacement.customer),

    status: normalizedReplacement.status,

    itemCount: items.length,

    totalReplacementQuantity,

    reservedAt: normalizedReplacement.reservation?.reservedAt ?? null,

    processedAt: normalizedReplacement.processing?.processedAt ?? null,

    shippedAt: normalizedReplacement.shipment?.shippedAt ?? null,

    deliveredAt: normalizedReplacement.shipment?.deliveredAt ?? null,

    cancelledAt: normalizedReplacement.cancellation?.cancelledAt ?? null,

    failedAt: normalizedReplacement.failure?.failedAt ?? null,

    createdAt: normalizedReplacement.createdAt,

    updatedAt: normalizedReplacement.updatedAt,
  };
};
