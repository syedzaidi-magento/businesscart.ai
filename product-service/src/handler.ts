import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { Product } from './models/product';
import { connectDB } from './services/db-service';

interface ProductInput {
  name: string;
  price: number;
  companyId: string;
  description?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    await connectDB();

    // Extract userId and userRole from authorizer context
    const userId = event.requestContext.authorizer?.userId;
    const userRole = event.requestContext.authorizer?.userRole;

    if (!userId || !userRole) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized: Missing user context' }),
      };
    }

    if (userRole !== 'company') {
      return {
        statusCode: 403,
        body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
      };
    }

    const method = event.httpMethod;
    const path = event.path;
    const productId = event.pathParameters?.productId;

    // POST /products
    if (method === 'POST' && path === '/products') {
      const body: ProductInput = JSON.parse(event.body || '{}');
      const { name, price, companyId, description } = body;

      if (!name || !price || !companyId) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Validation failed',
            errors: [
              !name && { message: 'Name is required' },
              !price && { message: 'Price is required' },
              !companyId && { message: 'Company ID is required' },
            ].filter(Boolean),
          }),
        };
      }

      const product = new Product({
        name,
        price,
        companyId,
        userId,
        description,
      });

      await product.save();

      return {
        statusCode: 201,
        body: JSON.stringify(product),
      };
    }

    // GET /products
    if (method === 'GET' && path === '/products') {
      const products = await Product.find({ userId });
      return {
        statusCode: 200,
        body: JSON.stringify(products),
      };
    }

    // GET /products/{productId}
    if (method === 'GET' && path === `/products/${productId}` && productId) {
      const product = await Product.findById(productId);
      if (!product) {
        return {
          statusCode: 404,
          body: JSON.stringify({ message: 'Product not found' }),
        };
      }
      if (product.userId !== userId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: 'Unauthorized access to product' }),
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify(product),
      };
    }

    // PUT /products/{productId}
    if (method === 'PUT' && path === `/products/${productId}` && productId) {
      const body: Partial<ProductInput> = JSON.parse(event.body || '{}');
      const product = await Product.findById(productId);
      if (!product) {
        return {
          statusCode: 404,
          body: JSON.stringify({ message: 'Product not found' }),
        };
      }
      if (product.userId !== userId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: 'Unauthorized access to product' }),
        };
      }
      Object.assign(product, body);
      await product.save();
      return {
        statusCode: 200,
        body: JSON.stringify(product),
      };
    }

    // DELETE /products/{productId}
    if (method === 'DELETE' && path === `/products/${productId}` && productId) {
      const product = await Product.findById(productId);
      if (!product) {
        return {
          statusCode: 404,
          body: JSON.stringify({ message: 'Product not found' }),
        };
      }
      if (product.userId !== userId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: 'Unauthorized access to product' }),
        };
      }
      await product.deleteOne();
      return {
        statusCode: 204,
        body: '',
      };
    }

    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Route not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};