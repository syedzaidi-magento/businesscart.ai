import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { Company } from './models/company';
import { connectDB } from './services/db-service';
import { createCompanySchema, updateCompanySchema, addCustomerSchema } from './validation';

interface AuthorizerContext {
  userId?: string;
  userRole?: string;
  company_id?: string | null;
  associateCompanyIds?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    await connectDB();
    const { httpMethod, path, body, pathParameters, requestContext } = event;

    // JSON parsing wrapper
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

    // Extract authorizer context
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

    // POST /companies
    if (path === '/companies' && httpMethod === 'POST') {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const existingCompany = await Company.findOne({ userId });
      if (existingCompany) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'User can only create one company' }),
        };
      }
      const data = createCompanySchema.parse(parsedBody);
      const company = await Company.create({
        ...data,
        userId,
      });
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // GET /companies
    if (path === '/companies' && httpMethod === 'GET') {
      let companies;
      if (userRole === 'admin') {
        companies = await Company.find({});
      } else if (userRole === 'company') {
        companies = await Company.find({ userId });
      } else if (userRole === 'customer') {
        let associateCompanyIds: string[] = [];
        try {
          associateCompanyIds = JSON.parse(authorizer.associateCompanyIds || '[]');
        } catch (err) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Invalid associate company IDs' }),
          };
        }
        companies = await Company.find({ _id: { $in: associateCompanyIds } });
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
        body: JSON.stringify(companies),
      };
    }

    // GET /companies/{companyId}
    if (path.startsWith('/companies/') && httpMethod === 'GET' && pathParameters?.companyId) {
      const id = pathParameters.companyId;
      const company = await Company.findById(id);
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Company not found' }),
        };
      }
      if (userRole === 'company' && company.userId !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to company' }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // PUT /companies/{companyId}
    if (path.startsWith('/companies/') && httpMethod === 'PUT' && pathParameters?.companyId) {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const id = pathParameters.companyId;
      const company = await Company.findById(id);
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Company not found' }),
        };
      }
      if (company.userId !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to company' }),
        };
      }
      const data = updateCompanySchema.parse(parsedBody);
      Object.assign(company, data);
      await company.save();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // DELETE /companies/{companyId}
    if (path.startsWith('/companies/') && httpMethod === 'DELETE' && pathParameters?.companyId) {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const id = pathParameters.companyId;
      const company = await Company.findById(id);
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Company not found' }),
        };
      }
      if (company.userId !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to company' }),
        };
      }
      await Company.deleteOne({ _id: id });
      return {
        statusCode: 204,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      };
    }

    // POST /companies/{companyId}/customers
    if (pathParameters?.companyId && httpMethod === 'POST' && path.endsWith('/customers')) {
      if (userRole !== 'company') {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized: Company role required' }),
        };
      }
      const companyId = pathParameters.companyId;
      const company = await Company.findById(companyId);
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Company not found' }),
        };
      }
      if (company.userId !== userId) {
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unauthorized access to company' }),
        };
      }
      const customerData = addCustomerSchema.parse(parsedBody);
      company.customers = company.customers || [];
      if (!company.customers.includes(customerData.customerId)) {
        company.customers.push(customerData.customerId);
        await company.save();
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // GET /companies/customers/{customerId}
    if (path.includes('/companies/customers/') && httpMethod === 'GET' && pathParameters?.customerId) {
      const customerId = pathParameters.customerId;
      const companies = await Company.find({ customers: customerId });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companies),
      };
    }

    // POST /companies/code
    if (path === '/companies/code' && httpMethod === 'POST') {
      const data = z.object({ code: z.string().min(1, 'Code is required') }).parse(parsedBody);
      const company = await Company.findOne({ companyCode: data.code });
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid company code' }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // GET /companies/code/{code}
    if (path.startsWith('/companies/code/') && httpMethod === 'GET' && pathParameters?.code) {
      const code = pathParameters.code;
      const company = await Company.findOne({ companyCode: code });
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid company code' }),
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      };
    }

    // POST /companies/code/{code}/customers
    if (path.startsWith('/companies/code/') && path.includes('/customers') && httpMethod === 'POST' && pathParameters?.code) {
      const code = pathParameters.code;
      const company = await Company.findOne({ companyCode: code });
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid company code' }),
        };
      }
      if (!company.customers.includes(userId)) {
        company.customers.push(userId);
        await company.save();
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
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
        statusCode: err.message.includes('not found') || err.message.includes('Invalid company code') ? 404 : err.message.includes('Unauthorized') ? 403 : 400,
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