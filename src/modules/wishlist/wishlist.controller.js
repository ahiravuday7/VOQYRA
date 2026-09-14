import {
  addWishlistItem,
  clearWishlist,
  deleteWishlistItem,
  getWishlist,
} from "./wishlist.service.js";

import { toWishlistResponse } from "./wishlist.mapper.js";

/*
|--------------------------------------------------------------------------
| Get Customer Wishlist
|--------------------------------------------------------------------------
| GET /api/v1/wishlist
|--------------------------------------------------------------------------
*/

export const getWishlistController = async (request, response) => {
  const customerId = request.user._id;

  const wishlist = await getWishlist(customerId);

  return response.status(200).json({
    success: true,

    message: "Wishlist retrieved successfully",

    data: {
      wishlist: toWishlistResponse(wishlist),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Add Wishlist Item
|--------------------------------------------------------------------------
| POST /api/v1/wishlist/items
|--------------------------------------------------------------------------
| Returns 200 for both a new addition and an already-saved Product.
|--------------------------------------------------------------------------
*/

export const addWishlistItemController = async (request, response) => {
  const customerId = request.user._id;

  const wishlistItemData = request.validated.body;

  await addWishlistItem(customerId, wishlistItemData);

  const wishlist = await getWishlist(customerId);

  const mappedWishlist = toWishlistResponse(wishlist);

  request.log?.info(
    {
      customerId: String(customerId),

      productId: wishlistItemData.productId,

      itemCount: mappedWishlist.itemCount,
    },
    "Wishlist add request completed",
  );

  return response.status(200).json({
    success: true,

    message: "Product saved to Wishlist successfully",

    data: {
      wishlist: mappedWishlist,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Wishlist Item
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist/items/:productId
|--------------------------------------------------------------------------
*/

export const deleteWishlistItemController = async (request, response) => {
  const customerId = request.user._id;

  const { productId } = request.validated.params;

  await deleteWishlistItem(customerId, productId);

  const wishlist = await getWishlist(customerId);

  const mappedWishlist = toWishlistResponse(wishlist);

  request.log?.info(
    {
      customerId: String(customerId),

      productId,

      remainingItemCount: mappedWishlist.itemCount,
    },
    "Wishlist removal request completed",
  );

  return response.status(200).json({
    success: true,

    message: "Product removed from Wishlist successfully",

    data: {
      wishlist: mappedWishlist,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Clear Wishlist
|--------------------------------------------------------------------------
| DELETE /api/v1/wishlist
|--------------------------------------------------------------------------
*/

export const clearWishlistController = async (request, response) => {
  const customerId = request.user._id;

  await clearWishlist(customerId);

  const wishlist = await getWishlist(customerId);

  const mappedWishlist = toWishlistResponse(wishlist);

  request.log?.info(
    {
      customerId: String(customerId),

      itemCount: mappedWishlist.itemCount,
    },
    "Wishlist clear request completed",
  );

  return response.status(200).json({
    success: true,

    message: "Wishlist cleared successfully",

    data: {
      wishlist: mappedWishlist,
    },
  });
};
