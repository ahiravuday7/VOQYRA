import OrderReturnReplacement from "./order-return-replacement.model.js";

/*
|--------------------------------------------------------------------------
| Create Order Return Replacement
|--------------------------------------------------------------------------
*/

export const createOrderReturnReplacementDocument = async (
  replacementData,
  { session = null } = {},
) => {
  const replacement = new OrderReturnReplacement(replacementData);

  return replacement.save({
    session,
  });
};

/*
|--------------------------------------------------------------------------
| Find Replacement by Return Request
|--------------------------------------------------------------------------
*/

export const findOrderReturnReplacementByReturnRequest = (
  returnRequestId,
  { session = null } = {},
) => {
  const query = OrderReturnReplacement.findOne({
    returnRequest: returnRequestId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

/*
|--------------------------------------------------------------------------
| Save Replacement
|--------------------------------------------------------------------------
*/

export const saveOrderReturnReplacementDocument = (
  replacement,
  { session = null } = {},
) => {
  return replacement.save({
    session,
  });
};
