import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  companyCode: z.string().min(1, 'Company code is required'),
  address: z
    .object({
      street: z.string().min(1, 'Street is required'),
      city: z.string().min(1, 'City is required'),
      state: z.string().min(1, 'State is required'),
      zip: z.string().min(1, 'Zip is required'),
      coordinates: z
        .object({
          lat: z.number({ required_error: 'Latitude is required' }),
          lng: z.number({ required_error: 'Longitude is required' }),
        })
        .optional(),
    })
    .optional(),
  sellingArea: z
    .object({
      radius: z.number().min(0, 'Radius must be non-negative'),
      center: z
        .object({
          lat: z.number({ required_error: 'Center latitude is required' }),
          lng: z.number({ required_error: 'Center longitude is required' }),
        })
        .optional(),
    })
    .optional(),
  paymentMethods: z
    .array(z.enum(['cash', 'credit_card']))
    .min(1, 'At least one payment method is required')
    .default(['cash']),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  companyCode: z.string().min(1, 'Company code is required').optional(),
  address: z
    .object({
      street: z.string().min(1, 'Street is required'),
      city: z.string().min(1, 'City is required'),
      state: z.string().min(1, 'State is required'),
      zip: z.string().min(1, 'Zip is required'),
      coordinates: z
        .object({
          lat: z.number({ required_error: 'Latitude is required' }),
          lng: z.number({ required_error: 'Longitude is required' }),
        })
        .optional(),
    })
    .optional(),
  sellingArea: z
    .object({
      radius: z.number().min(0, 'Radius must be non-negative'),
      center: z.object({
        lat: z.number({ required_error: 'Center latitude is required' }),
        lng: z.number({ required_error: 'Center longitude is required' }),
      }),
    })
    .optional(),
  paymentMethods: z
    .array(z.enum(['cash', 'credit_card']))
    .min(1, 'At least one payment method is required')
    .optional(),
});

export const addCustomerSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type AddCustomerInput = z.infer<typeof addCustomerSchema>;