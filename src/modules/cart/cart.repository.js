import Cart from "./cart.model.js";

/*
|--------------------------------------------------------------------------
| Find Cart By User
|--------------------------------------------------------------------------
*/

const findCartByUserId = async (userId, options = {}) => {
  const { populateProducts = false } = options;

  let query = Cart.findOne({
    user: userId,
  });

  /*
  |--------------------------------------------------------------------------
  | Populate Current Product Data
  |--------------------------------------------------------------------------
  |
  | Cart itself stores only:
  |
  | product
  | variantId
  | quantity
  |
  | Current Product/Variant data is loaded when the Cart is read.
  |--------------------------------------------------------------------------
  */

  if (populateProducts) {
    query = query.populate({
      path: "items.product",

      select: {
        name: 1,
        slug: 1,
        status: 1,
        deletedAt: 1,
        images: 1,
        variants: 1,
      },
    });
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Find Or Create Cart
|--------------------------------------------------------------------------
|
| One User → One Cart.
|
| We use an atomic upsert instead of:
|
| find cart
|   ↓
| if missing → create
|
| because two concurrent requests could otherwise attempt to create
| two carts for the same User.
|--------------------------------------------------------------------------
*/

const findOrCreateCartByUserId = async (userId) => {
  return Cart.findOneAndUpdate(
    {
      user: userId,
    },

    {
      $setOnInsert: {
        user: userId,
        items: [],
      },
    },

    {
      upsert: true,

      returnDocument: "after",

      runValidators: true,

      setDefaultsOnInsert: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Save Cart Document
|--------------------------------------------------------------------------
|
| Used after adding, updating or removing Cart items.
|--------------------------------------------------------------------------
*/

const saveCartDocument = async (cart) => {
  return cart.save();
};

export { findCartByUserId, findOrCreateCartByUserId, saveCartDocument };
