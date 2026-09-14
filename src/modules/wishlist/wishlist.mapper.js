import { toPublicProductSummary } from "../products/product.mapper.js";

/*
|--------------------------------------------------------------------------
| Map Wishlist Product
|--------------------------------------------------------------------------
| Reuse Product's existing public pricing and availability calculations.
| Return only fields needed for a Wishlist Product card.
|--------------------------------------------------------------------------
*/

const toWishlistProduct = (product) => {
  const summary = toPublicProductSummary(product);

  if (!summary) {
    return null;
  }

  return {
    id: summary.id,

    name: summary.name,

    slug: summary.slug,

    primaryImage: summary.primaryImage,

    priceRange: summary.priceRange,

    availability: summary.availability,
  };
};

/*
|--------------------------------------------------------------------------
| Map Wishlist Item
|--------------------------------------------------------------------------
| Expects the enriched item returned by getWishlist().
| Product visibility is resolved by the service.
| Stock availability remains separate from Product visibility.
|--------------------------------------------------------------------------
*/

const toWishlistItem = (item) => {
  const product =
    item.isAvailable === true && item.product
      ? toWishlistProduct(item.product)
      : null;

  return {
    productId: item.productId?.toString() ?? null,

    addedAt: item.addedAt ?? null,

    isAvailable: product !== null,

    product,
  };
};

/*
|--------------------------------------------------------------------------
| Empty Wishlist
|--------------------------------------------------------------------------
*/

const createEmptyWishlistResponse = () => {
  return {
    id: null,

    items: [],

    itemCount: 0,
  };
};

/*
|--------------------------------------------------------------------------
| Map Wishlist
|--------------------------------------------------------------------------
| Preserves the newest-first order supplied by getWishlist().
| Unavailable entries still count toward the Wishlist limit.
|--------------------------------------------------------------------------
*/

const toWishlistResponse = (wishlist) => {
  if (!wishlist) {
    return createEmptyWishlistResponse();
  }

  const items = (wishlist.items ?? []).map(toWishlistItem);

  return {
    id: wishlist._id?.toString() ?? null,

    items,

    itemCount: items.length,
  };
};

export { createEmptyWishlistResponse, toWishlistItem, toWishlistResponse };
