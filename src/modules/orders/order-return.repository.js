import mongoose from "mongoose";

import { ORDER_RETURN_QUANTITY_CONSUMING_STATUS_VALUES } from "../../shared/constants/order.constants.js";

import OrderReturnRequest from "./order-return.model.js";

/*
|--------------------------------------------------------------------------
| Normalize Return Repository Object ID
|--------------------------------------------------------------------------
*/

const normalizeReturnObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
};

/*
|--------------------------------------------------------------------------
| Find Consumed Return Quantities
|--------------------------------------------------------------------------
|
| Returns the quantity already used by active or completed return requests
| for each requested Order item.
|--------------------------------------------------------------------------
*/

export const findConsumedOrderReturnQuantities = async ({
  orderId,
  orderItemIds,
  session = null,
}) => {
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return [];
  }

  const normalizedOrderId = normalizeReturnObjectId(orderId);

  const normalizedOrderItemIds = orderItemIds.map(normalizeReturnObjectId);

  const aggregation = OrderReturnRequest.aggregate([
    {
      $match: {
        order: normalizedOrderId,

        status: {
          $in: ORDER_RETURN_QUANTITY_CONSUMING_STATUS_VALUES,
        },
      },
    },

    {
      $unwind: "$items",
    },

    {
      $match: {
        "items.orderItemId": {
          $in: normalizedOrderItemIds,
        },
      },
    },

    {
      $group: {
        _id: "$items.orderItemId",

        consumedQuantity: {
          $sum: "$items.quantity",
        },
      },
    },

    {
      $project: {
        _id: 0,

        orderItemId: "$_id",

        consumedQuantity: 1,
      },
    },
  ]);

  if (session) {
    aggregation.session(session);
  }

  return aggregation;
};
