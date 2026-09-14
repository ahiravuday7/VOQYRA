import {
  clearRecentlyViewed,
  deleteRecentlyViewedItem,
  getRecentlyViewed,
  recordRecentlyViewed,
} from "./recently-viewed.service.js";

import { toRecentlyViewedResponse } from "./recently-viewed.mapper.js";

/*
|--------------------------------------------------------------------------
| Get Recently Viewed
|--------------------------------------------------------------------------
| GET /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

export const getRecentlyViewedController = async (request, response) => {
  const customerId = request.user._id;

  const history = await getRecentlyViewed(customerId);

  return response.status(200).json({
    success: true,

    message: "Recently viewed history retrieved successfully",

    data: {
      recentlyViewed: toRecentlyViewedResponse(history),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Record Product View
|--------------------------------------------------------------------------
| POST /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
| Returns 200 for both a new entry and a refreshed viewing time.
|--------------------------------------------------------------------------
*/

export const recordRecentlyViewedController = async (request, response) => {
  const customerId = request.user._id;

  const { productId } = request.validated.params;

  await recordRecentlyViewed(customerId, productId);

  const history = await getRecentlyViewed(customerId);

  const mappedHistory = toRecentlyViewedResponse(history);

  request.log?.info(
    {
      customerId: String(customerId),

      productId,

      itemCount: mappedHistory.itemCount,
    },
    "Product view recorded",
  );

  return response.status(200).json({
    success: true,

    message: "Product view recorded successfully",

    data: {
      recentlyViewed: mappedHistory,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Recently Viewed Item
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed/:productId
|--------------------------------------------------------------------------
*/

export const deleteRecentlyViewedItemController = async (request, response) => {
  const customerId = request.user._id;

  const { productId } = request.validated.params;

  await deleteRecentlyViewedItem(customerId, productId);

  const history = await getRecentlyViewed(customerId);

  const mappedHistory = toRecentlyViewedResponse(history);

  request.log?.info(
    {
      customerId: String(customerId),

      productId,

      remainingItemCount: mappedHistory.itemCount,
    },
    "Recently viewed removal request completed",
  );

  return response.status(200).json({
    success: true,

    message: "Product removed from recently viewed history successfully",

    data: {
      recentlyViewed: mappedHistory,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Clear Recently Viewed
|--------------------------------------------------------------------------
| DELETE /api/v1/recently-viewed
|--------------------------------------------------------------------------
*/

export const clearRecentlyViewedController = async (request, response) => {
  const customerId = request.user._id;

  await clearRecentlyViewed(customerId);

  const history = await getRecentlyViewed(customerId);

  const mappedHistory = toRecentlyViewedResponse(history);

  request.log?.info(
    {
      customerId: String(customerId),

      itemCount: mappedHistory.itemCount,
    },
    "Recently viewed clear request completed",
  );

  return response.status(200).json({
    success: true,

    message: "Recently viewed history cleared successfully",

    data: {
      recentlyViewed: mappedHistory,
    },
  });
};
