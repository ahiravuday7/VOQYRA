import Wishlist from "./wishlist.model.js";

/*
|--------------------------------------------------------------------------
| Find Wishlist By User
|--------------------------------------------------------------------------
| Returns an unpopulated document.
| The service resolves current public Product data separately.
| Reading does not create a Wishlist document.
|--------------------------------------------------------------------------
*/

const findWishlistByUserId = async (userId) => {
  return Wishlist.findOne({
    user: userId,
  });
};

/*
|--------------------------------------------------------------------------
| Find Or Create Wishlist
|--------------------------------------------------------------------------
| Uses the same atomic upsert pattern as Cart.
| The unique user index enforces one Wishlist per customer.
|--------------------------------------------------------------------------
*/

const findOrCreateWishlistByUserId = async (userId) => {
  return Wishlist.findOneAndUpdate(
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
| Save Wishlist Document
|--------------------------------------------------------------------------
| Used with unpopulated documents after modifying Wishlist items.
|--------------------------------------------------------------------------
*/

const saveWishlistDocument = async (wishlist) => {
  return wishlist.save();
};

export {
  findWishlistByUserId,
  findOrCreateWishlistByUserId,
  saveWishlistDocument,
};
