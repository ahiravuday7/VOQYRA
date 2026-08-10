import OrderReturnReplacement, {
  ORDER_RETURN_REPLACEMENT_STATUS,
} from "./order-return-replacement.model.js";

/*
|--------------------------------------------------------------------------
| Create Order Return Replacement
|--------------------------------------------------------------------------
*/

export const createOrderReturnReplacementDocument = async (
  replacementData,
  { session = null } = {},
) => {
  const replacement = new OrderReturnReplacement(replacementData);

  return replacement.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Replacement by Return Request
|--------------------------------------------------------------------------
*/

export const findOrderReturnReplacementByReturnRequest = (
  returnRequestId,
  { session = null } = {},
) => {
  const query = OrderReturnReplacement.findOne({
    returnRequest: returnRequestId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Save Replacement
|--------------------------------------------------------------------------
*/

export const saveOrderReturnReplacementDocument = (
  replacement,
  { session = null } = {},
) => {
  return replacement.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Replacement by ID
|--------------------------------------------------------------------------
*/

export const findOrderReturnReplacementById = (
  replacementId,
  { session = null } = {},
) => {
  const query = OrderReturnReplacement.findById(replacementId);

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Mark Replacement Processing Atomically
|--------------------------------------------------------------------------
|
| Only:
|
| reserved -> processing
|
| This atomic filter also protects against two admins processing the same
| replacement concurrently.
|--------------------------------------------------------------------------
*/

export const markOrderReturnReplacementProcessingAtomically = ({
  replacementId,
  adminId,
  note = null,
  processedAt,
}) => {
  return OrderReturnReplacement.findOneAndUpdate(
    {
      _id: replacementId,

      status: ORDER_RETURN_REPLACEMENT_STATUS.RESERVED,

      /*
       * Reservation evidence must exist.
       */
      "reservation.reservedBy": {
        $ne: null,
      },

      "reservation.reservedAt": {
        $ne: null,
      },

      /*
       * No later fulfillment evidence may exist.
       */
      "processing.processedAt": null,

      "shipment.shippedAt": null,

      "cancellation.cancelledAt": null,

      "failure.failedAt": null,
    },

    {
      $set: {
        status: ORDER_RETURN_REPLACEMENT_STATUS.PROCESSING,

        processing: {
          note,

          processedBy: adminId,

          processedAt,
        },
      },
    },

    {
      new: true,

      runValidators: true,
    },
  );
};
