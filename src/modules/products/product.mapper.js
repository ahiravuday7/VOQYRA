/*
|--------------------------------------------------------------------------
| Object ID Mapper
|--------------------------------------------------------------------------
*/

const mapObjectId = (value) => {
  if (!value) {
    return null;
  }

  if (value._id) {
    return String(value._id);
  }

  return String(value);
};

/*
|--------------------------------------------------------------------------
| Product Image Mapper
|--------------------------------------------------------------------------
*/

const mapProductImage = (image) => {
  return {
    id: mapObjectId(image?._id),

    url: image?.url ?? "",

    publicId: image?.publicId ?? "",

    altText: image?.altText ?? "",

    sortOrder: image?.sortOrder ?? 0,

    isPrimary: image?.isPrimary ?? false,
  };
};

/*
|--------------------------------------------------------------------------
| Product Colour Mapper
|--------------------------------------------------------------------------
*/

const mapProductColor = (color) => {
  return {
    name: color?.name ?? "",

    code: color?.code ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Variant Pricing Mapper
|--------------------------------------------------------------------------
*/

const mapVariantPricing = (pricing) => {
  return {
    buyingPrice: pricing?.buyingPrice ?? 0,

    sellingPrice: pricing?.sellingPrice ?? 0,

    discountPrice: pricing?.discountPrice ?? null,

    currency: pricing?.currency ?? "INR",
  };
};

/*
|--------------------------------------------------------------------------
| Variant Inventory Mapper
|--------------------------------------------------------------------------
*/

const mapVariantInventory = (inventory) => {
  const stock = inventory?.stock ?? 0;

  const reservedStock = inventory?.reservedStock ?? 0;

  return {
    stock,

    reservedStock,

    availableStock: Math.max(stock - reservedStock, 0),

    lowStockThreshold: inventory?.lowStockThreshold ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Shipping Dimensions Mapper
|--------------------------------------------------------------------------
*/

const mapPackageDimensions = (dimensions) => {
  return {
    lengthCm: dimensions?.lengthCm ?? 0,

    widthCm: dimensions?.widthCm ?? 0,

    heightCm: dimensions?.heightCm ?? 0,
  };
};

/*
|--------------------------------------------------------------------------
| Variant Shipping Mapper
|--------------------------------------------------------------------------
*/

const mapVariantShipping = (shipping) => {
  return {
    weightInGrams: shipping?.weightInGrams ?? 0,

    dimensions: mapPackageDimensions(shipping?.dimensions),
  };
};

/*
|--------------------------------------------------------------------------
| Product Variant Mapper
|--------------------------------------------------------------------------
*/

const mapProductVariant = (variant) => {
  const pricing = mapVariantPricing(variant?.pricing);

  const inventory = mapVariantInventory(variant?.inventory);

  const effectivePrice = pricing.discountPrice ?? pricing.sellingPrice;

  const isLowStock = inventory.availableStock <= inventory.lowStockThreshold;

  return {
    id: mapObjectId(variant?._id),

    sku: variant?.sku ?? "",

    barcode: variant?.barcode ?? "",

    size: variant?.size ?? "",

    color: mapProductColor(variant?.color),

    pricing,

    inventory,

    shipping: mapVariantShipping(variant?.shipping),

    isActive: variant?.isActive ?? true,

    effectivePrice,

    availableStock: inventory.availableStock,

    isLowStock,
  };
};

/*
|--------------------------------------------------------------------------
| Product Attribute Mapper
|--------------------------------------------------------------------------
*/

const mapProductAttribute = (attribute) => {
  return {
    name: attribute?.name ?? "",

    value: attribute?.value ?? "",
  };
};

/*
|--------------------------------------------------------------------------
| Product SEO Mapper
|--------------------------------------------------------------------------
*/

const mapProductSeo = (seo) => {
  return {
    metaTitle: seo?.metaTitle ?? "",

    metaDescription: seo?.metaDescription ?? "",

    keywords: seo?.keywords ?? [],
  };
};

/*
|--------------------------------------------------------------------------
| Calculate Product Totals
|--------------------------------------------------------------------------
*/

const calculateProductTotals = (variants) => {
  return variants.reduce(
    (result, variant) => {
      result.totalStock += variant.inventory.stock;

      result.reservedStock += variant.inventory.reservedStock;

      result.availableStock += variant.availableStock;

      if (variant.isActive) {
        result.activeVariantCount += 1;
      }

      return result;
    },
    {
      totalStock: 0,
      reservedStock: 0,
      availableStock: 0,
      activeVariantCount: 0,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Calculate Product Price Range
|--------------------------------------------------------------------------
*/

const calculatePriceRange = (variants) => {
  const activeVariants = variants.filter((variant) => variant.isActive);

  const prices = activeVariants
    .map((variant) => variant.effectivePrice)
    .filter((price) => Number.isFinite(price));

  if (!prices.length) {
    return {
      minimum: null,
      maximum: null,
      currency: "INR",
    };
  }

  return {
    minimum: Math.min(...prices),

    maximum: Math.max(...prices),

    currency: activeVariants[0]?.pricing.currency ?? "INR",
  };
};

/*
|--------------------------------------------------------------------------
| Admin Product Mapper
|--------------------------------------------------------------------------
|
| Includes admin-only information such as:
|
| - Buying price
| - Inventory
| - Product status
| - Audit fields
| - Deletion information
|--------------------------------------------------------------------------
*/

export const toAdminProduct = (product) => {
  if (!product) {
    return null;
  }

  /*
   * Product creation returns a Mongoose document.
   * Read queries may later return plain objects.
   */
  const productObject =
    typeof product.toObject === "function"
      ? product.toObject({
          virtuals: true,
        })
      : product;

  const variants = (productObject.variants ?? []).map(mapProductVariant);

  const totals = calculateProductTotals(variants);

  return {
    id: mapObjectId(productObject._id),

    name: productObject.name,

    slug: productObject.slug,

    shortDescription: productObject.shortDescription ?? "",

    description: productObject.description ?? "",

    category: mapObjectId(productObject.category),

    brand: productObject.brand,

    attributes: (productObject.attributes ?? []).map(mapProductAttribute),

    materials: productObject.materials ?? [],

    careInstructions: productObject.careInstructions ?? [],

    countryOfOrigin: productObject.countryOfOrigin ?? "India",

    tags: productObject.tags ?? [],

    images: (productObject.images ?? []).map(mapProductImage),

    variants,

    seo: mapProductSeo(productObject.seo),

    status: productObject.status,

    isFeatured: productObject.isFeatured ?? false,

    isNewArrival: productObject.isNewArrival ?? false,

    isBestSeller: productObject.isBestSeller ?? false,

    publishedAt: productObject.publishedAt ?? null,

    activeVariantCount: totals.activeVariantCount,

    totalStock: totals.totalStock,

    reservedStock: totals.reservedStock,

    availableStock: totals.availableStock,

    priceRange: calculatePriceRange(variants),

    isDeleted: Boolean(productObject.deletedAt),

    createdBy: mapObjectId(productObject.createdBy),

    updatedBy: mapObjectId(productObject.updatedBy),

    deletedAt: productObject.deletedAt ?? null,

    deletedBy: mapObjectId(productObject.deletedBy),

    createdAt: productObject.createdAt,

    updatedAt: productObject.updatedAt,
  };
};
