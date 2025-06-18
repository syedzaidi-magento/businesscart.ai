import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import mongoose from 'mongoose';
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

    // Post /orders
    if (path === '/orders' && httpMethod === 'POST') {
      if (userRole !== 'company' && userRole !== 'customer') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company or Customer role required' }),
        };
      }
      let parsedBody;
      try {
        parsedBody = body ? JSON.parse(body) : {};
      } catch (err) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid JSON body' }),
        };
      }
      const data = createOrderSchema.parse(parsedBody);
      if (data.entity.user_id !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: User ID mismatch' }),
        };
      }
      const order = await Order.create({
        ...data.entity,
        customer_id: userRole === 'customer' ? userId : undefined,
      });
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      };
    }

    // GET /orders
    if (path === '/orders' && httpMethod === 'GET') {
      let orders;
      if (userRole === 'admin') {
        orders = await Order.find({});
      } else if (userRole === 'company') {
        orders = await Order.find({ user_id: userId });
      } else if (userRole === 'customer') {
        orders = await Order.find({ customer_id: userId });
      } else {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Invalid role' }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orders),
      };
    }

    // GET /orders/{orderId}
    if (path.startsWith('/orders/') && httpMethod === 'GET' && pathParameters?.orderId) {
      const orderId = pathParameters.orderId;
      try {
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
      } catch (err) {
        if (err instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Order not found' }),
          };
        }
        throw err;
      }
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
      try {
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
        let parsedBody;
        try {
          parsedBody = body ? JSON.parse(body) : {};
        } catch (err) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Invalid JSON body' }),
          };
        }
        const data = updateOrderSchema.parse(parsedBody);
        Object.assign(order, data.entity);
        await order.save();
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order),
        };
      } catch (err) {
        if (err instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Order not found' }),
          };
        }
        throw err;
      }
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
      try {
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
      } catch (err) {
        if (err instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Order not found' }),
          };
        }
        throw err;
      }
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