import { config } from 'dotenv';
config({ path: './.env' }); // Load .env from dist/

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { AuthService } from './services/auth-service';
import { connectDB } from './services/db-service';
import { User } from './models/user';
import { RefreshToken } from './models/refresh-token';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './validation';

// Validation schema for updating user company_id
export const updateUserSchema = z.object({
  company_id: z.string().min(1, 'Company ID is required'),
});

// Validation schema for associating a company
const associateCompanySchema = z.object({
  companyId: z.string().min(1, 'Company ID is required'),
});

// Validation schema for updating user
const updateUserFullSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  email: z.string().email('Invalid email').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
  role: z.enum(['admin', 'company', 'customer']).optional(),
  phoneNumber: z.string().min(10, 'Phone number must be at least 10 digits').optional(),
  company_id: z.string().min(1, 'Company ID is required').optional(),
});

// Validation schema for getting users
const getUsersSchema = z.object({});

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
      const data = refreshSchema.parse(parsedBody);
      const refreshTokenDoc = await RefreshToken.findOne({ token: data.refreshToken });
      if (!refreshTokenDoc || refreshTokenDoc.expiresAt < new Date()) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Invalid or expired refresh token' }),
        };
      }
      const user = await User.findById(refreshTokenDoc.userId);
      if (!user) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'User not found' }),
        };
      }
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

    if (path === '/users' && httpMethod === 'GET') {
  try {
    getUsersSchema.parse(parsedBody);
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
    }
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string; company_id?: string; associate_company_ids?: string[] } };
    let users;
    if (decoded.user.role === 'admin') {
      users = await User.find().select('-password');
    } else if (decoded.user.role === 'company') {
      users = await User.find({
        $or: [
          { _id: decoded.user.id },
          { company_id: decoded.user.company_id },
          { associate_company_ids: decoded.user.company_id },
        ],
      }).select('-password');
    } else if (decoded.user.role === 'customer') {
      users = await User.find({ _id: decoded.user.id }).select('-password');
    } else {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(users),
    };
  } catch (error) {
    console.error('Get users error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch users' }) };
  }
}

if (httpMethod === 'GET' && path.match(/\/users\/[^/]+$/)) {
  const id = path.split('/').pop();
  try {
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
    }
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string; company_id?: string } };
    if (
      decoded.user.role !== 'admin' &&
      decoded.user.id !== id &&
      !(decoded.user.role === 'company' && decoded.user.company_id)
    ) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const user = await User.findById(id).select('-password');
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    };
  } catch (error) {
    console.error('Get user error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch user' }) };
  }
}

if (httpMethod === 'DELETE' && path.match(/\/users\/[^/]+$/)) {
  const id = path.split('/').pop();
  try {
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
    }
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string } };
    if (decoded.user.role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'User deleted successfully' }),
    };
  } catch (error) {
    console.error('Delete user error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to delete user' }) };
  }
}

if (httpMethod === 'PUT' && path.match(/\/users\/[^/]+$/)) {
  const id = path.split('/').pop();
  const data = updateUserFullSchema.parse(parsedBody);
  if (!accessToken) {
    return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
  }
  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string } };
    if (decoded.user.role !== 'admin' && decoded.user.id !== id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const updateData = { ...data };
    if (updateData.password) {
      updateData.password = await authService.hashPassword(updateData.password);
    } else {
      delete updateData.password;
    }
    const user = await User.findByIdAndUpdate(id, updateData, { new: true, select: '-password' });
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }
    const payload = {
      user: {
        id: user.id,
        role: user.role,
        company_id: user.company_id || undefined,
        associate_company_ids: user.associate_company_ids || [],
      },
    };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `token=${newAccessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
          process.env.NODE_ENV === 'production'
        }; Path=/`,
      },
      body: JSON.stringify({ user, accessToken: newAccessToken }),
    };
  } catch (error) {
    console.error('Update user error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update user' }) };
  }
}

    if (path === '/users/associate-company' && httpMethod === 'POST') {
    const data = associateCompanySchema.parse(parsedBody);
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
    }
    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string } };
      if (decoded.user.role !== 'customer') {
        return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized: Customer role required' }) };
      }

    const user = await User.findById(decoded.user.id);
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }

    if (!user.associate_company_ids) {
      user.associate_company_ids = [];
    }
    if (!user.associate_company_ids.includes(data.companyId)) {
      user.associate_company_ids.push(data.companyId);
      await user.save();
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role,
        company_id: user.company_id || undefined,
        associate_company_ids: user.associate_company_ids || [],
      },
    };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `token=${newAccessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
          process.env.NODE_ENV === 'production'
        }; Path=/`,
      },
      body: JSON.stringify({ accessToken: newAccessToken }),
    };
  } catch (error) {
    console.error('Associate company error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to associate company' }) };
  }
}

if (httpMethod === 'PATCH' && path.match(/\/users\/[^/]+$/)) {
      const id = path.split('/').pop();
      const data = updateUserSchema.parse(parsedBody);
      if (!accessToken) {
        return { statusCode: 401, body: JSON.stringify({ message: 'No token provided' }) };
      }
try {
  const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { user: { id: string; role: string } };
  if (decoded.user.id !== id || decoded.user.role !== 'company') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const user = await User.findByIdAndUpdate(
    id,
    { company_id: data.company_id },
    { new: true, select: '-password' },
  );

  console.log('Updated user:', user); // Add this line for debugging

  if (!user) {
    return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
  }

  const payload = { user: { id: user.id, role: user.role, company_id: user.company_id } };
  const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `token=${newAccessToken}; HttpOnly; Max-Age=${15 * 60}; Secure=${
        process.env.NODE_ENV === 'production'
      }; Path=/`,
    },
    body: JSON.stringify({ user, accessToken: newAccessToken }),
  };
} catch (error) {
  console.error('Update error:', error); // Log the error for debugging
  return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update user' }) };
}
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