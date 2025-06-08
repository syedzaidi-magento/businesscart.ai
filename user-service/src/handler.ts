import { config } from 'dotenv';
config({ path: './.env' }); // Load .env from dist/

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { AuthService } from './services/auth-service';
import { connectDB } from './services/db-service';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './validation';

// Initialize services
const authService = new AuthService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    await connectDB();
    const { httpMethod, path, body, headers } = event;

    // Sanitize body input
    let parsedBody: any = {};
    if (body) {
      try {
        parsedBody = JSON.parse(body);
      } catch (err) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid JSON body' }),
        };
      }
    }

    // Extract accessToken from Cookie, Authorization header, or body
    const cookieToken = headers['Cookie']?.match(/token=([^;]+)/)?.[1];
    const authHeaderToken = headers['Authorization']?.replace('Bearer ', '');
    const accessToken = cookieToken || authHeaderToken || parsedBody.accessToken;

    if (path === '/users/register' && httpMethod === 'POST') {
      const data = registerSchema.parse(parsedBody);
      const { accessToken, refreshToken } = await authService.register(data);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `token=${accessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
            process.env.NODE_ENV === 'production'
          }; Path=/`,
        },
        body: JSON.stringify({ accessToken, refreshToken }),
      };
    }

    if (path === '/users/login' && httpMethod === 'POST') {
      const data = loginSchema.parse(parsedBody);
      const { accessToken, refreshToken } = await authService.login(data);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `token=${accessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
            process.env.NODE_ENV === 'production'
          }; Path=/`,
        },
        body: JSON.stringify({ accessToken, refreshToken }),
      };
    }

    if (path === '/users/refresh' && httpMethod === 'POST') {
      const data = refreshSchema.parse(parsedBody);
      const accessToken = await authService.refresh(data.refreshToken);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `token=${accessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
            process.env.NODE_ENV === 'production'
          }; Path=/`,
        },
        body: JSON.stringify({ accessToken }),
      };
    }

    if (path === '/users/logout' && httpMethod === 'POST') {
      const data = logoutSchema.parse({ refreshToken: parsedBody.refreshToken, accessToken });
      await authService.logout(data.refreshToken, data.accessToken);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `token=; HttpOnly; Max-Age=0; Secure=${
            process.env.NODE_ENV === 'production'
          }; Path=/`,
        },
        body: JSON.stringify({ message: 'Logged out successfully' }),
      };
    }

    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Route not found' }),
    };
  } catch (err) {
    console.error('Error:', {
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
      path: event.path,
      method: event.httpMethod,
    });
    if (err instanceof z.ZodError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors: err.errors }),
      };
    }
    if (err instanceof Error) {
      const clientErrors = [
        'User already exists',
        'Invalid credentials',
        'Invalid or expired refresh token',
        'Invalid refresh token',
      ];
      if (clientErrors.includes(err.message)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: err.message }),
        };
      }
    }
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Server error' }),
    };
  }
};