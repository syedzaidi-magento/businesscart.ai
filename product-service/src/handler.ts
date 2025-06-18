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

    // Extract userId, userRole, and additional context from authorizer
    const userId = event.requestContext.authorizer?.userId;
    const userRole = event.requestContext.authorizer?.userRole;
    const company_id = event.requestContext.authorizer?.company_id; // Align with JWT's company_id
    const associateCompanyIds = event.requestContext.authorizer?.associateCompanyIds;

    if (!userId || !userRole) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized: Missing user context' }),
      };
    }

    const method = event.httpMethod;
    const path = event.path;
    const productId = event.pathParameters?.productId;

    // POST /products
    if (method === 'POST' && path === '/products') {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      let body: ProductInput;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (err) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Invalid JSON body' }),
        };
      }
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
      let products;
      if (userRole === 'admin') {
        products = await Product.find({});
      } else if (userRole === 'company') {
        products = await Product.find({ userId });
      } else if (userRole === 'customer') {
        let companyIds: string[] = [];
        try {
          companyIds = JSON.parse(associateCompanyIds || '[]');
        } catch (err) {
          return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid associate company IDs' }),
          };
        }
        products = await Product.find({ companyId: { $in: companyIds } });
      } else {
        return {
          statusCode: 403,
          body: JSON.stringify({ message: 'Unauthorized: Invalid role' }),
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify(products),
      };
    }

    // GET /products/{productId}
    if (method === 'GET' && path === `/products/${productId}` && productId) {
      try {
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
      } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            body: JSON.stringify({ message: 'Product not found' }),
          };
        }
        throw error;
      }
    }

    // PUT /products/{productId}
    if (method === 'PUT' && path === `/products/${productId}` && productId) {
      try {
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
      } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            body: JSON.stringify({ message: 'Product not found' }),
          };
        }
        throw error;
      }
    }

    // DELETE /products/{productId}
    if (method === 'DELETE' && path === `/products/${productId}` && productId) {
      try {
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
        console.log('Product deleted successfully'); // Add this log
        return {
          statusCode: 204,
          body: JSON.stringify({}), // Return an empty JSON object
        };
      } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
          return {
            statusCode: 404,
            body: JSON.stringify({ message: 'Product not found' }),
          };
        }
        throw error;
      }
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