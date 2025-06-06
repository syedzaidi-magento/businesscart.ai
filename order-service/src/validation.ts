import { z } from 'zod';

export const createOrderSchema = z.object({
  entity: z.object({
    base_grand_total: z.number().min(0, 'Base grand total is required and must be non-negative'),
    grand_total: z.number().min(0, 'Grand total is required and must be non-negative'),
    customer_email: z.string().email('Invalid email address').min(1, 'Customer email is required'),
    billing_address: z.object({
      address_type: z.string().min(1, 'Address type is required'),
      city: z.string().min(1, 'City is required'),
      country_id: z.string().min(1, 'Country ID is required'),
      firstname: z.string().min(1, 'First name is required'),
      lastname: z.string().min(1, 'Last name is required'),
      postcode: z.string().min(1, 'Postal code is required'),
      telephone: z.string().min(1, 'Telephone is required'),
      street: z.array(z.string()).min(1, 'At least one street is required'),
    }),
    payment: z.object({
      account_status: z.string().min(1, 'Account status is required'),
      additional_information: z.array(z.string()).min(1, 'At least one additional information is required'),
      cc_last4: z.string().min(4, 'Last 4 digits of credit card are required'),
      method: z.string().min(1, 'Payment method is required'),
    }),
    items: z.array(
      z.object({
        sku: z.string().min(1, 'SKU is required'),
        name: z.string().min(1, 'Item name is required'),
        qty_ordered: z.number().min(1, 'Quantity ordered must be at least 1'),
        price: z.number().min(0, 'Price must be non-negative'),
        row_total: z.number().min(0, 'Row total must be non-negative'),
      })
    ).min(1, 'At least one item is required'),
    status_histories: z.array(
      z.object({
        comment: z.string().min(1, 'Comment is required'),
        is_customer_notified: z.number().int().min(0, 'Customer notified flag is required'),
        is_visible_on_front: z.number().int().min(0, 'Visible on front flag is required'),
        parent_id: z.number().int().min(0, 'Parent ID is required'),
      })
    ).optional(),
    company_id: z.string().min(1, 'Company ID is required'),
    user_id: z.string().min(1, 'User ID is required'),
  }),
});

export const updateOrderSchema = createOrderSchema.partial().extend({
  entity: z.object({
    base_grand_total: z.number().min(0, 'Base grand total must be non-negative').optional(),
    grand_total: z.number().min(0, 'Grand total must be non-negative').optional(),
    customer_email: z.string().email('Invalid email address').optional(),
    billing_address: z.object({
      address_type: z.string().optional(),
      city: z.string().optional(),
      country_id: z.string().optional(),
      firstname: z.string().optional(),
      lastname: z.string().optional(),
      postcode: z.string().optional(),
      telephone: z.string().optional(),
      street: z.array(z.string()).optional(),
    }).optional(),
    payment: z.object({
      account_status: z.string().optional(),
      additional_information: z.array(z.string()).optional(),
      cc_last4: z.string().min(4).optional(),
      method: z.string().optional(),
    }).optional(),
    items: z.array(
      z.object({
        sku: z.string().optional(),
        name: z.string().optional(),
        qty_ordered: z.number().min(1).optional(),
        price: z.number().min(0).optional(),
        row_total: z.number().min(0).optional(),
      })
    ).optional(),
    status_histories: z.array(
      z.object({
        comment: z.string().optional(),
        is_customer_notified: z.number().int().min(0).optional(),
        is_visible_on_front: z.number().int().min(0).optional(),
        parent_id: z.number().int().min(0).optional(),
      })
    ).optional(),
    company_id: z.string().optional(),
    user_id: z.string().optional(),
  }).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
