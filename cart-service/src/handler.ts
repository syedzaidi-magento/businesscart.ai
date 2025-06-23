import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { connectDB } from './services/db-service';
import { CartService } from './services/cart-service';
import { createCartItemSchema, updateCartItemSchema } from './validation';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    await connectDB();
    const userId = event.requestContext.authorizer?.userId;
    const userRole = event.requestContext.authorizer?.userRole || 'customer';
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const cartService = new CartService();
    const { httpMethod, pathParameters, body } = event;

    if (httpMethod === 'POST' && !pathParameters) {
      // Add item to cart
      const input = JSON.parse(body || '{}');
      const parsed = createCartItemSchema.safeParse(input);
      if (!parsed.success) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: parsed.error.errors.map((e) => e.message).join(', ') }),
        };
      }
      const cart = await cartService.createCartItem(parsed.data.entity, userId);
      return {
        statusCode: 201,
        body: JSON.stringify(cart),
      };
    }

    if (httpMethod === 'GET' && !pathParameters) {
      // Get cart
      const cart = await cartService.getCart(userId, userRole);
      return {
        statusCode: 200,
        body: JSON.stringify(cart),
      };
    }

    if (httpMethod === 'PUT' && pathParameters?.itemId) {
      // Update item quantity
      const input = JSON.parse(body || '{}');
      const parsed = updateCartItemSchema.safeParse(input);
      if (!parsed.success) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: parsed.error.errors.map((e) => e.message).join(', ') }),
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

    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error: any) {
    console.error(error);
    return {
      statusCode: error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Unauthorized') ? 400 : 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};