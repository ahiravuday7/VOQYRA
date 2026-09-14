import Wishlist from "./wishlist.model.js";

/*
|--------------------------------------------------------------------------
| Find Wishlist By User
|--------------------------------------------------------------------------
| Reading does not create a Wishlist document.
| Populate current Product data only when requested.
|--------------------------------------------------------------------------
*/

const findWishlistByUserId = async (userId, options = {}) => {
  const { populateProducts = false } = options;

  let query = Wishlist.findOne({
    user: userId,
  });

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

      // Preserve the reference when the Product no longer exists.
      transform: (product, originalId) => product ?? originalId,
    });
  }

  return query;
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
