import mongoose from "mongoose";

import AppError from "../../shared/errors/app-error.js";

import { findProductsForCheckout } from "../products/product.repository.js";

import { RECENTLY_VIEWED_LIMITS } from "./recently-viewed.constants.js";

import {
  findRecentlyViewedByUserId,
  findOrCreateRecentlyViewedByUserId,
  saveRecentlyViewedDocument,
} from "./recently-viewed.repository.js";

/*
|--------------------------------------------------------------------------
| Recently Viewed Errors
|--------------------------------------------------------------------------
*/

const createRecentlyViewedProductNotFoundError = () => {
  return new AppError("Product was not found", 404, {
    errorCode: "RECENTLY_VIEWED_PRODUCT_NOT_FOUND",
  });
};

/*
|--------------------------------------------------------------------------
| Sort History Items
|--------------------------------------------------------------------------
| Most recent viewing time first.
| Equal timestamps use Product ID ascending as a deterministic tie-breaker.
| Returns a new array without changing the input array.
|--------------------------------------------------------------------------
*/

const sortRecentlyViewedItems = (items) => {
  return [...items].sort((first, second) => {
    const timeDifference = second.viewedAt.getTime() - first.viewedAt.getTime();

    if (timeDifference !== 0) {
      return timeDifference;
    }

    return first.product.toString().localeCompare(second.product.toString());
  });
};

/*
|--------------------------------------------------------------------------
| Record Product View
|--------------------------------------------------------------------------
| Validate public visibility before creating or modifying history.
| Repeated views refresh viewedAt and retain one entry for the Product.
| Trim the oldest entries before saving.
|--------------------------------------------------------------------------
*/

const recordRecentlyViewedOnce = async (userId, productId) => {
  // Reuse Product visibility rules without reserving inventory.
  const [product] = await findProductsForCheckout([productId]);

  if (!product) {
    throw createRecentlyViewedProductNotFoundError();
  }

  const history = await findOrCreateRecentlyViewedByUserId(userId);

  const normalizedProductId = product._id.toString();

  // Remove previous entries for this Product before recording its new view.
  const remainingItems = history.items.filter(
    (item) => item.product.toString() !== normalizedProductId,
  );

  const updatedItems = [
    ...remainingItems,
    {
      product: product._id,
      viewedAt: new Date(),
    },
  ];

  history.items = sortRecentlyViewedItems(updatedItems).slice(
    0,
    RECENTLY_VIEWED_LIMITS.MAX_ITEMS,
  );

  return saveRecentlyViewedDocument(history);
};

/*
|--------------------------------------------------------------------------
| Get Recently Viewed
|--------------------------------------------------------------------------
| Load current public Product data in one batch.
| Preserve missing or unavailable Product references.
| Reading never refreshes viewedAt or modifies stored history.
|--------------------------------------------------------------------------
*/

const getRecentlyViewed = async (userId) => {
  const history = await findRecentlyViewedByUserId(userId);

  if (!history) {
    return null;
  }

  const result = history.toObject();

  if (result.items.length === 0) {
    return result;
  }

  const sortedItems = sortRecentlyViewedItems(result.items);

  const productIds = sortedItems.map((item) => item.product);

  const products = await findProductsForCheckout(productIds);

  const productsById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );

  result.items = sortedItems.map((item) => {
    const productId = item.product.toString();

    const product = productsById.get(productId) ?? null;

    return {
      productId,

      viewedAt: item.viewedAt,

      isAvailable: product !== null,

      product,
    };
  });

  return result;
};

/*
|--------------------------------------------------------------------------
| Delete Recently Viewed Item
|--------------------------------------------------------------------------
| Removal does not require the Product to exist or be available.
| Removing an unsaved Product is a successful no-op.
|--------------------------------------------------------------------------
*/

const deleteRecentlyViewedItemOnce = async (userId, productId) => {
  const history = await findRecentlyViewedByUserId(userId);

  if (!history) {
    return null;
  }

  const normalizedProductId = productId.toString();

  const remainingItems = history.items.filter(
    (item) => item.product.toString() !== normalizedProductId,
  );

  if (remainingItems.length === history.items.length) {
    return history;
  }

  history.items = remainingItems;

  return saveRecentlyViewedDocument(history);
};

/*
|--------------------------------------------------------------------------
| Clear Recently Viewed
|--------------------------------------------------------------------------
| Keep the existing history document.
| Do not create a document when no history exists.
|--------------------------------------------------------------------------
*/

const clearRecentlyViewedOnce = async (userId) => {
  const history = await findRecentlyViewedByUserId(userId);

  if (!history) {
    return null;
  }

  if (history.items.length === 0) {
    return history;
  }

  history.items = [];

  return saveRecentlyViewedDocument(history);
};

/*
|--------------------------------------------------------------------------
| Retry Recently Viewed Version Conflicts
|--------------------------------------------------------------------------
|
| Reload the history and repeat the complete operation after a
| rejected stale save. Recording then recalculates viewedAt,
| ordering, and eviction using the latest history.
|--------------------------------------------------------------------------
*/

const RECENTLY_VIEWED_WRITE_MAX_ATTEMPTS = 5;

const executeRecentlyViewedWriteWithRetry = async (operation) => {
  for (
    let attempt = 1;
    attempt <= RECENTLY_VIEWED_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof mongoose.Error.VersionError)) {
        throw error;
      }

      if (attempt === RECENTLY_VIEWED_WRITE_MAX_ATTEMPTS) {
        throw new AppError(
          "Recently viewed history changed repeatedly while processing your request. Please try again.",
          409,
          {
            errorCode: "RECENTLY_VIEWED_WRITE_CONFLICT",
          },
        );
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| Public Recently Viewed Write Operations
|--------------------------------------------------------------------------
*/

const recordRecentlyViewed = async (userId, productId) => {
  return executeRecentlyViewedWriteWithRetry(() => {
    return recordRecentlyViewedOnce(userId, productId);
  });
};

const deleteRecentlyViewedItem = async (userId, productId) => {
  return executeRecentlyViewedWriteWithRetry(() => {
    return deleteRecentlyViewedItemOnce(userId, productId);
  });
};

const clearRecentlyViewed = async (userId) => {
  return executeRecentlyViewedWriteWithRetry(() => {
    return clearRecentlyViewedOnce(userId);
  });
};

export {
  clearRecentlyViewed,
  deleteRecentlyViewedItem,
  getRecentlyViewed,
  recordRecentlyViewed,
};
