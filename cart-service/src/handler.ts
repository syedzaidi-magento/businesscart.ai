import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { connectDB } from './services/db-service';
import { CartService } from './services/cart-service';
import { createCartItemSchema, updateCartItemSchema } from './validation';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE',
  };

  if (event.httpMethod === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }
  try {
    await connectDB();
    const userId = event.requestContext.authorizer?.userId;
    const userRole = event.requestContext.authorizer?.userRole || 'customer';
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'No token provided' }),
      };
    }

    const cartService = new CartService();
    const { httpMethod, pathParameters, body } = event;

    if (httpMethod === 'POST' && !pathParameters) {
      // Add item to cart
      let input;
      try {
        input = JSON.parse(body || '{}');
      } catch (error) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Invalid JSON body' }),
        };
      }
      const parsed = createCartItemSchema.safeParse(input);
      if (!parsed.success) {
        return {
          statusCode: 400,
          body: JSON.stringify({ errors: parsed.error.errors.map((e) => ({ message: e.message, path: e.path })) }),
        };
      }
      const cart = await cartService.createCartItem(parsed.data.entity, userId, userRole);
      return {
        statusCode: 200,
        body: JSON.stringify(cart),
      };
    }

    if (httpMethod === 'GET' && event.path === '/cart') {
      // Get cart
      try {
        const cart = await cartService.getCart(userId, userRole);
        return {
          statusCode: 200,
          body: JSON.stringify(cart),
        };
      } catch (error: any) {
        if (error.message === 'Cart not found') {
          return {
            statusCode: 200,
            body: JSON.stringify({ userId: userId, items: [] }),
          };
        }
        throw error; // Re-throw other errors
      }
    }

    if (httpMethod === 'PUT' && pathParameters?.itemId) {
      // Update item quantity
      const input = JSON.parse(body || '{}');
      const parsed = updateCartItemSchema.safeParse(input);
      if (!parsed.success) {
        return {
          statusCode: 400,
          body: JSON.stringify({ errors: parsed.error.errors.map((e) => ({ message: e.message, path: e.path })) }),
        };
      }
      const cart = await cartService.updateCartItem(pathParameters.itemId, parsed.data.entity, userId);
      return {
        statusCode: 200,
        body: JSON.stringify(cart),
      };
    }

    if (httpMethod === 'DELETE' && pathParameters?.itemId) {
      // Remove item from cart
      const cart = await cartService.deleteCartItem(pathParameters.itemId, userId);
      return {
        statusCode: 200,
        body: JSON.stringify(cart),
      };
    }

    if (httpMethod === 'DELETE' && !pathParameters) {
      // Clear cart
      const cart = await cartService.clearCart(userId);
      return {
        statusCode: 200,
        body: JSON.stringify(cart),
      };
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method not allowed' }),
      headers,
    };
  } catch (error: any) {
    console.error(error);
    let statusCode = 500;
    let message = error.message || 'Internal server error';

    if (message.includes('Unauthorized')) {
      statusCode = 403;
    } else if (message.includes('not found') || message.includes('Invalid')) {
      statusCode = 404;
    } else if (message.includes('Validation Error') || message.includes('required') || message.includes('must be')) {
      statusCode = 400;
    }

    return {
      statusCode,
      body: JSON.stringify({ message }),
      headers,
    };
  }
};