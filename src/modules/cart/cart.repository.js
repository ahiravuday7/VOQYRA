import Cart from "./cart.model.js";

/*
|--------------------------------------------------------------------------
| Find Cart By User
|--------------------------------------------------------------------------
*/

const findCartByUserId = async (userId) => {
  return Cart.findOne({
    user: userId,
  });
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

/*
|--------------------------------------------------------------------------
| Delete Cart By User
|--------------------------------------------------------------------------
|
| This physically removes the Cart document.
|
| We may use this later if we decide DELETE /cart should completely
| remove the document instead of only setting items: [].
|--------------------------------------------------------------------------
*/

const deleteCartByUserId = async (userId) => {
  return Cart.findOneAndDelete({
    user: userId,
  });
};

export {
  deleteCartByUserId,
  findCartByUserId,
  findOrCreateCartByUserId,
  saveCartDocument,
};
