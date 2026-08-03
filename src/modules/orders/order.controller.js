import { toCustomerOrder } from "./order.mapper.js";

import { createCustomerOrder } from "./order.service.js";

/*
|--------------------------------------------------------------------------
| Create Customer Order
|--------------------------------------------------------------------------
|
| POST
| /api/v1/orders
|--------------------------------------------------------------------------
*/

export const createCustomerOrderController = async (request, response) => {
  const orderData = request.validated.body;

  const customerId = request.user._id;

  const order = await createCustomerOrder(orderData, customerId);

  const mappedOrder = toCustomerOrder(order);

  request.log?.info(
    {
      orderId: mappedOrder.id,

      orderNumber: mappedOrder.orderNumber,

      customerId: String(customerId),

      itemCount: mappedOrder.items.length,

      grandTotal: mappedOrder.totals.grandTotal,

      paymentMethod: mappedOrder.payment.method,

      inventoryStatus: mappedOrder.inventoryStatus,
    },
    "Customer Order created",
  );

  return response.status(201).json({
    success: true,

    message: "Order created successfully",

    data: {
      order: mappedOrder,
    },
  });
};
