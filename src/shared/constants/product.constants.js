/*
|--------------------------------------------------------------------------
| Product Statuses
|--------------------------------------------------------------------------
*/

export const PRODUCT_STATUSES = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  INACTIVE: "inactive",
  ARCHIVED: "archived",
});

export const PRODUCT_STATUS_VALUES = Object.freeze(
  Object.values(PRODUCT_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Supported Currencies
|--------------------------------------------------------------------------
|
| The initial application will use INR.
|--------------------------------------------------------------------------
*/

export const PRODUCT_CURRENCIES = Object.freeze({
  INR: "INR",
});

export const PRODUCT_CURRENCY_VALUES = Object.freeze(
  Object.values(PRODUCT_CURRENCIES),
);

/*
|--------------------------------------------------------------------------
| Product Limits
|--------------------------------------------------------------------------
*/

export const PRODUCT_LIMITS = Object.freeze({
  MAX_IMAGES: 12,
  MAX_VARIANTS: 100,
  MAX_TAGS: 20,
  MAX_ATTRIBUTES: 30,
  MAX_CARE_INSTRUCTIONS: 20,
});
