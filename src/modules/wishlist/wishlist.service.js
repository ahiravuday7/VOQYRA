import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import { findProductsForCheckout } from "../products/product.repository.js";

import { WISHLIST_LIMITS } from "./wishlist.constants.js";

import {
  findWishlistByUserId,
  findOrCreateWishlistByUserId,
  saveWishlistDocument,
} from "./wishlist.repository.js";

/*
|--------------------------------------------------------------------------
| Wishlist Errors
|--------------------------------------------------------------------------
*/

const createWishlistProductNotFoundError = () => {
  return new AppError("Product was not found", 404, {
    errorCode: "WISHLIST_PRODUCT_NOT_FOUND",
  });
};

const createWishlistItemLimitExceededError = () => {
  return new AppError("Wishlist item limit has been reached", 409, {
    errorCode: "WISHLIST_ITEM_LIMIT_EXCEEDED",

    details: {
      maxItems: WISHLIST_LIMITS.MAX_ITEMS,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Find Existing Item
|--------------------------------------------------------------------------
| Used only with unpopulated Wishlist documents.
|--------------------------------------------------------------------------
*/

const findWishlistItem = (wishlist, productId) => {
  return wishlist.items.find(
    (item) => item.product.toString() === productId.toString(),
  );
};

/*
|--------------------------------------------------------------------------
| Add Wishlist Item
|--------------------------------------------------------------------------
| An already-saved Product is a successful no-op, even if unavailable.
| New entries must pass existing public Product visibility rules.
| Out-of-stock Products are allowed.
|--------------------------------------------------------------------------
*/

const addWishlistItemOnce = async (userId, { productId }) => {
  let wishlist = await findWishlistByUserId(userId);

  if (wishlist && findWishlistItem(wishlist, productId)) {
    return wishlist;
  }

  // This repository function reads Products without reserving inventory.
  const [product] = await findProductsForCheckout([productId]);

  if (!product) {
    throw createWishlistProductNotFoundError();
  }

  // Validate the Product before creating the customer's first Wishlist.
  if (!wishlist) {
    wishlist = await findOrCreateWishlistByUserId(userId);
  }

  // The upsert may return a Wishlist created by another request.
  if (findWishlistItem(wishlist, product._id)) {
    return wishlist;
  }

  if (wishlist.items.length >= WISHLIST_LIMITS.MAX_ITEMS) {
    throw createWishlistItemLimitExceededError();
  }

  wishlist.items.push({
    product: product._id,
    addedAt: new Date(),
  });

  return saveWishlistDocument(wishlist);
};

/*
|--------------------------------------------------------------------------
| Get Wishlist
|--------------------------------------------------------------------------
| Read current publicly available Products in one batch.
| Preserve stored Product IDs when Products are missing or unavailable.
| Build a response source without modifying the stored Wishlist.
|--------------------------------------------------------------------------
*/

const getWishlist = async (userId) => {
  const wishlist = await findWishlistByUserId(userId);

  if (!wishlist) {
    return null;
  }

  const result = wishlist.toObject();

  if (result.items.length === 0) {
    return result;
  }

  const productIds = result.items.map((item) => item.product);

  const products = await findProductsForCheckout(productIds);

  const productsById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );

  result.items = result.items
    .map((item) => {
      const productId = item.product.toString();
      const product = productsById.get(productId) ?? null;

      return {
        productId,
        addedAt: item.addedAt,
        isAvailable: product !== null,
        product,
      };
    })
    .sort(
      (first, second) => second.addedAt.getTime() - first.addedAt.getTime(),
    );

  return result;
};

/*
|--------------------------------------------------------------------------
| Delete Wishlist Item
|--------------------------------------------------------------------------
| Removal does not require the Product to exist or be available.
| Removing an unsaved Product is a successful no-op.
|--------------------------------------------------------------------------
*/

const deleteWishlistItemOnce = async (userId, productId) => {
  const wishlist = await findWishlistByUserId(userId);

  if (!wishlist) {
    return null;
  }

  const remainingItems = wishlist.items.filter(
    (item) => item.product.toString() !== productId.toString(),
  );

  if (remainingItems.length === wishlist.items.length) {
    return wishlist;
  }

  wishlist.items = remainingItems;

  return saveWishlistDocument(wishlist);
};

/*
|--------------------------------------------------------------------------
| Clear Wishlist
|--------------------------------------------------------------------------
| Keep the Wishlist document.
| Do not create a document when no Wishlist exists.
|--------------------------------------------------------------------------
*/

const clearWishlistOnce = async (userId) => {
  const wishlist = await findWishlistByUserId(userId);

  if (!wishlist) {
    return null;
  }

  if (wishlist.items.length === 0) {
    return wishlist;
  }

  wishlist.items = [];

  return saveWishlistDocument(wishlist);
};

/*
|--------------------------------------------------------------------------
| Retry Wishlist Version Conflicts
|--------------------------------------------------------------------------
|
| A conflicting save did not apply its changes.
|
| Reload through the complete operation so duplicate detection,
| Product validation, and the item limit use fresh Wishlist data.
|--------------------------------------------------------------------------
*/

const WISHLIST_WRITE_MAX_ATTEMPTS = 5;

const executeWishlistWriteWithRetry = async (operation) => {
  for (let attempt = 1; attempt <= WISHLIST_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof mongoose.Error.VersionError)) {
        throw error;
      }

      if (attempt === WISHLIST_WRITE_MAX_ATTEMPTS) {
        throw new AppError(
          "Wishlist changed repeatedly while processing your request. Please try again.",
          409,
          {
            errorCode: "WISHLIST_WRITE_CONFLICT",
          },
        );
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| Public Wishlist Write Operations
|--------------------------------------------------------------------------
*/

const addWishlistItem = async (userId, input) => {
  return executeWishlistWriteWithRetry(() => {
    return addWishlistItemOnce(userId, input);
  });
};

const deleteWishlistItem = async (userId, productId) => {
  return executeWishlistWriteWithRetry(() => {
    return deleteWishlistItemOnce(userId, productId);
  });
};

const clearWishlist = async (userId) => {
  return executeWishlistWriteWithRetry(() => {
    return clearWishlistOnce(userId);
  });
};

export { addWishlistItem, clearWishlist, deleteWishlistItem, getWishlist };
