/*
|--------------------------------------------------------------------------
| Size Guide Statuses
|--------------------------------------------------------------------------
*/

export const SIZE_GUIDE_STATUSES = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
});

export const SIZE_GUIDE_STATUS_VALUES = Object.freeze(
  Object.values(SIZE_GUIDE_STATUSES),
);

/*
|--------------------------------------------------------------------------
| Size Guide Measurement Units
|--------------------------------------------------------------------------
|
| Initial supported units:
|
| cm → centimetres
| in → inches
|--------------------------------------------------------------------------
*/

export const SIZE_GUIDE_UNITS = Object.freeze({
  CENTIMETER: "cm",
  INCH: "in",
});

export const SIZE_GUIDE_UNIT_VALUES = Object.freeze(
  Object.values(SIZE_GUIDE_UNITS),
);
