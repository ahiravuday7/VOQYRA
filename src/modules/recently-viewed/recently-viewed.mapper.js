import { toPublicProductSummary } from "../products/product.mapper.js";

/*
|--------------------------------------------------------------------------
| Map Recently Viewed Product
|--------------------------------------------------------------------------
| Reuse Product's public pricing, image, and availability calculations.
|--------------------------------------------------------------------------
*/

const toRecentlyViewedProduct = (product) => {
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
| Map Recently Viewed Item
|--------------------------------------------------------------------------
| Expects an enriched item returned by getRecentlyViewed().
| Product visibility is resolved by the service.
|--------------------------------------------------------------------------
*/

const toRecentlyViewedItem = (item) => {
  const product =
    item.isAvailable === true && item.product
      ? toRecentlyViewedProduct(item.product)
      : null;

  return {
    productId: item.productId?.toString() ?? null,

    viewedAt: item.viewedAt ?? null,

    isAvailable: product !== null,

    product,
  };
};

/*
|--------------------------------------------------------------------------
| Empty Recently Viewed Response
|--------------------------------------------------------------------------
*/

const createEmptyRecentlyViewedResponse = () => {
  return {
    id: null,

    items: [],

    itemCount: 0,
  };
};

/*
|--------------------------------------------------------------------------
| Map Recently Viewed History
|--------------------------------------------------------------------------
| Preserves the order supplied by the service.
| Unavailable entries remain included in itemCount.
|--------------------------------------------------------------------------
*/

const toRecentlyViewedResponse = (history) => {
  if (!history) {
    return createEmptyRecentlyViewedResponse();
  }

  const items = (history.items ?? []).map(toRecentlyViewedItem);

  return {
    id: history._id?.toString() ?? null,

    items,

    itemCount: items.length,
  };
};

export {
  createEmptyRecentlyViewedResponse,
  toRecentlyViewedItem,
  toRecentlyViewedResponse,
};
