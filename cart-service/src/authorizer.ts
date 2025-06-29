import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  user: {
    id: string;
    role: string;
    company_id?: string;
    associate_company_ids?: string[];
  };
}

export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  try {
    const token = event.authorizationToken.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    return {
      principalId: decoded.user.id,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn,
          },
        ],
      },
      context: {
        userId: decoded.user.id,
        userRole: decoded.user.role,
        companyId: decoded.user.company_id || '',
        associateCompanyIds: JSON.stringify(decoded.user.associate_company_ids || []),
      },
    };
  } catch (err) {
    console.error('Authorization error:', err);
    return {
      principalId: 'unauthorized',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Deny',
            Resource: event.methodArn,
          },
        ],
      },
    };
  }
};