import { toCustomerOrder, toCustomerOrderSummary } from "./order.mapper.js";

import {
  createCustomerOrder,
  getCustomerOrderById,
  getCustomerOrders,
  cancelCustomerOrder,
} from "./order.service.js";

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

/*
|--------------------------------------------------------------------------
| Get Customer Orders
|--------------------------------------------------------------------------
|
| GET /api/v1/orders
|--------------------------------------------------------------------------
*/

export const getCustomerOrdersController = async (request, response) => {
  const customerId = request.user._id;

  const filters = request.validated.query;

  const { orders, pagination } = await getCustomerOrders(customerId, filters);

  return response.status(200).json({
    success: true,

    message: "Orders retrieved successfully",

    data: {
      orders: orders.map((order) => {
        return toCustomerOrderSummary(order);
      }),

      pagination,

      filters: {
        status: filters.status ?? null,

        paymentStatus: filters.paymentStatus ?? null,

        inventoryStatus: filters.inventoryStatus ?? null,

        sortBy: filters.sortBy,

        sortDirection: filters.sortDirection,
      },
    },
  });
};

/*
|--------------------------------------------------------------------------
| Get Customer Order by ID
|--------------------------------------------------------------------------
|
| GET /api/v1/orders/:orderId
|--------------------------------------------------------------------------
*/

export const getCustomerOrderController = async (request, response) => {
  const { orderId } = request.validated.params;

  const customerId = request.user._id;

  const order = await getCustomerOrderById(orderId, customerId);

  return response.status(200).json({
    success: true,

    message: "Order retrieved successfully",

    data: {
      order: toCustomerOrder(order),
    },
  });
};

/*
|--------------------------------------------------------------------------
| Cancel Customer Order
|--------------------------------------------------------------------------
|
| POST /api/v1/orders/:orderId/cancel
|--------------------------------------------------------------------------
*/

export const cancelCustomerOrderController = async (request, response) => {
  const { orderId } = request.validated.params;

  const cancellationData = request.validated.body;

  const customerId = request.user._id;

  const cancelledOrder = await cancelCustomerOrder(
    orderId,
    customerId,
    cancellationData,
  );

  const mappedOrder = toCustomerOrder(cancelledOrder);

  request.log?.info(
    {
      orderId: mappedOrder.id,

      orderNumber: mappedOrder.orderNumber,

      customerId: String(customerId),

      status: mappedOrder.status,

      inventoryStatus: mappedOrder.inventoryStatus,

      cancellationReason: mappedOrder.cancellation.reason,
    },
    "Customer Order cancelled",
  );

  return response.status(200).json({
    success: true,

    message: "Order cancelled successfully",

    data: {
      order: mappedOrder,
    },
  });
};
