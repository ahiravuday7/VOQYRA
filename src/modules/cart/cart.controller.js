import {
  addCartItem,
  clearCart,
  deleteCartItem,
  getCart,
  updateCartItemQuantity,
} from "./cart.service.js";

import { toCartResponse } from "./cart.mapper.js";

/*
|--------------------------------------------------------------------------
| Get Customer Cart
|--------------------------------------------------------------------------
|
| GET
| /api/v1/cart
|--------------------------------------------------------------------------
*/

export const getCartController = async (request, response) => {
  const customerId = request.user._id;

  const cart = await getCart(customerId);

  return response.status(200).json({
    success: true,

    message: "Cart retrieved successfully",

    data: {
      cart: toCartResponse(cart),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Add Cart Item
|--------------------------------------------------------------------------
|
| POST
| /api/v1/cart/items
|--------------------------------------------------------------------------
*/

export const addCartItemController = async (request, response) => {
  const customerId = request.user._id;

  const cartItemData = request.validated.body;

  await addCartItem(customerId, cartItemData);

  /*
    |--------------------------------------------------------------------------
    | Reload Populated Cart
    |--------------------------------------------------------------------------
    */

  const cart = await getCart(customerId);

  const mappedCart = toCartResponse(cart);

  request.log?.info(
    {
      customerId: String(customerId),

      productId: cartItemData.productId,

      variantId: cartItemData.variantId,

      quantity: cartItemData.quantity,

      itemCount: mappedCart.itemCount,

      totalQuantity: mappedCart.totalQuantity,
    },
    "Cart item added",
  );

  return response.status(201).json({
    success: true,

    message: "Cart item added successfully",

    data: {
      cart: mappedCart,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Update Cart Item Quantity
|--------------------------------------------------------------------------
|
| PATCH
| /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
*/

export const updateCartItemController = async (request, response) => {
  const { itemId } = request.validated.params;

  const { quantity } = request.validated.body;

  const customerId = request.user._id;

  await updateCartItemQuantity(customerId, itemId, quantity);

  const cart = await getCart(customerId);

  const mappedCart = toCartResponse(cart);

  request.log?.info(
    {
      customerId: String(customerId),

      cartItemId: itemId,

      quantity,

      totalQuantity: mappedCart.totalQuantity,
    },
    "Cart item quantity updated",
  );

  return response.status(200).json({
    success: true,

    message: "Cart item updated successfully",

    data: {
      cart: mappedCart,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Delete Cart Item
|--------------------------------------------------------------------------
|
| DELETE
| /api/v1/cart/items/:itemId
|--------------------------------------------------------------------------
*/

export const deleteCartItemController = async (request, response) => {
  const { itemId } = request.validated.params;

  const customerId = request.user._id;

  await deleteCartItem(customerId, itemId);

  const cart = await getCart(customerId);

  const mappedCart = toCartResponse(cart);

  request.log?.info(
    {
      customerId: String(customerId),

      cartItemId: itemId,

      remainingItemCount: mappedCart.itemCount,
    },
    "Cart item deleted",
  );

  return response.status(200).json({
    success: true,

    message: "Cart item deleted successfully",

    data: {
      cart: mappedCart,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Clear Cart
|--------------------------------------------------------------------------
|
| DELETE
| /api/v1/cart
|--------------------------------------------------------------------------
*/

export const clearCartController = async (request, response) => {
  const customerId = request.user._id;

  await clearCart(customerId);

  /*
    |--------------------------------------------------------------------------
    | Reload
    |--------------------------------------------------------------------------
    |
    | If no Cart document exists, getCart() returns null and the mapper
    | converts that into the standard empty Cart response.
    |--------------------------------------------------------------------------
    */

  const cart = await getCart(customerId);

  const mappedCart = toCartResponse(cart);

  request.log?.info(
    {
      customerId: String(customerId),
    },
    "Cart cleared",
  );

  return response.status(200).json({
    success: true,

    message: "Cart cleared successfully",

    data: {
      cart: mappedCart,
    },
  });
};
