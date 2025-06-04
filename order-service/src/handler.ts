import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { Order } from './models/order';
import { connectDB } from './services/db-service';
import { createOrderSchema, updateOrderSchema } from './validation';

interface AuthorizerContext {
  userId?: string;
  userRole?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    await connectDB();
    const { httpMethod, path, body, pathParameters, requestContext } = event;

    const authorizer: AuthorizerContext = requestContext.authorizer || {};
    const userId = authorizer.userId;
    const userRole = authorizer.userRole;

    if (!userId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Unauthorized: User ID required' }),
      };
    }

    // POST /orders
    if (path === '/orders' && httpMethod === 'POST') {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const data = createOrderSchema.parse(body ? JSON.parse(body) : {});
      if (data.entity.user_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: User ID mismatch' }),
        };
      }
      const order = await Order.create(data.entity);
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      };
    }

    // GET /orders
    if (path === '/orders' && httpMethod === 'GET') {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const orders = await Order.find({ user_id: userId });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orders),
      };
    }

    // GET /orders/{orderId}
    if (path.startsWith('/orders/') && httpMethod === 'GET' && pathParameters?.orderId) {
      const orderId = pathParameters.orderId;
      const order = await Order.findById(orderId);
      if (!order) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Order not found' }),
        };
      }
      if (userRole === 'company' && order.user_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to order' }),
        };
      }
      if (userRole === 'customer' && order.customer_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to order' }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      };
    }

    // PUT /orders/{orderId}
    if (path.startsWith('/orders/') && httpMethod === 'PUT' && pathParameters?.orderId) {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const orderId = pathParameters.orderId;
      const order = await Order.findById(orderId);
      if (!order) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Order not found' }),
        };
      }
      if (order.user_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to order' }),
        };
      }
      const data = updateOrderSchema.parse(body ? JSON.parse(body) : {});
      Object.assign(order, data.entity);
      await order.save();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      };
    }

    // DELETE /orders/{orderId}
    if (path.startsWith('/orders/') && httpMethod === 'DELETE' && pathParameters?.orderId) {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const orderId = pathParameters.orderId;
      const order = await Order.findById(orderId);
      if (!order) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Order not found' }),
        };
      }
      if (order.user_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to order' }),
        };
      }
      await Order.deleteOne({ _id: orderId });
      return {
        statusCode: 204,
        headers: { 'Content-Type': 'application/json' },
        body: '',
      };
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Route not found' }),
    };
  } catch (err) {
    console.error('Handler error:', err);
    if (err instanceof z.ZodError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors: err.errors }),
      };
    }
    if (err instanceof Error) {
      return {
        statusCode: err.message.includes('not found') ? 404 : err.message.includes('Unauthorized') ? 403 : 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: err.message }),
      };
    }
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
