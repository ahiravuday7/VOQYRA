import RecentlyViewed from "./recently-viewed.model.js";

/*
|--------------------------------------------------------------------------
| Find Recently Viewed By User
|--------------------------------------------------------------------------
| Returns an unpopulated document.
| Reading does not create history or refresh viewing times.
|--------------------------------------------------------------------------
*/

const findRecentlyViewedByUserId = async (userId) => {
  return RecentlyViewed.findOne({
    user: userId,
  });
};

/*
|--------------------------------------------------------------------------
| Find Or Create Recently Viewed
|--------------------------------------------------------------------------
| Uses the same upsert pattern as Wishlist.
| The unique user index enforces one history document per customer.
|--------------------------------------------------------------------------
*/

const findOrCreateRecentlyViewedByUserId = async (userId) => {
  return RecentlyViewed.findOneAndUpdate(
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
| Save Recently Viewed Document
|--------------------------------------------------------------------------
| The service updates viewing times, removes duplicates, and trims
| history to its maximum size before saving.
|--------------------------------------------------------------------------
*/

const saveRecentlyViewedDocument = async (history) => {
  return history.save();
};

export {
  findRecentlyViewedByUserId,
  findOrCreateRecentlyViewedByUserId,
  saveRecentlyViewedDocument,
};
