export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface CustomerData {
  customerConfigs: CustomerCodeEntry[];
  attachedCompanies?: CompanyData[];
  customerAddresses?: CustomerAddress[];
}

export interface PartnerData {
  partnerCodeId?: string;
  partnerCode?: string;
  status: string;
}

// An account's OWN internal structure. Role-agnostic: a selling company, a
// buying customer and (later) a partner all describe themselves the same way,
// and neither side configures the other's. Never present on a b2c account.
export interface OrgGovernance {
  approval?: ApprovalPolicy;
}

export interface ApprovalPolicy {
  scope?: ApprovalScope;
  threshold?: number;
  quantityThreshold?: number;
  validityHours?: number;
  chain?: ApprovalStepConfig[];
}

// Standing inside an organisation, distinct from `role` which is standing on the
// platform. Labelled by side in the UI: a selling company's people are Staff, a
// buying organisation's are Company users.
export type OrgRole = 'owner' | 'admin' | 'user';

export interface Account {
  _id: string;
  name: string;
  email: string;
  // Mirrors the five roles the backend defines. 'b2c' was missing, which meant
  // TypeScript could not express "not a storefront shopper" — the exact check
  // that keeps a D2C customer out of organisation governance.
  role: 'admin' | 'company' | 'customer' | 'partner' | 'b2c';
  accountStatus: 'active' | 'pending' | 'suspended' | 'inactive';
  company?: CompanyData;
  customer?: CustomerData;
  partner?: PartnerData;
  governance?: OrgGovernance;
  // Organisation membership (Roadmap #21c). Absent parentAccountId means this
  // account IS the organisation; the invite code only ever exists on that root.
  parentAccountId?: string;
  orgInviteCode?: string;
  orgRole?: OrgRole;
  address?: Address;
  password?: string;
  // Ad-platform conversion credentials. Write-only: provider -> { field -> value }
  // (e.g. { meta: { pixel_id, access_token } }); the raw token is never returned.
  adConversions?: Record<string, Record<string, string>>;
  // Per-provider on/off switch (write). A provider only dispatches when true.
  adConversionsEnabled?: Record<string, boolean>;
  // Read-only masked status for the UI: provider -> masked, secret-free status.
  adConversionsInfo?: Record<string, { configured: boolean; enabled: boolean; pixelId?: string; customerId?: string; conversionActionId?: string; viewContentActionId?: string; addToCartActionId?: string; checkoutActionId?: string; tokenLast4?: string }>;
}

export interface Attribute {
  key: string;
  value: string;
  type?: 'filterable' | 'system';
}

export interface PriceTier {
  minQty: number;
  price: number;
}

export interface Review {
  name: string;
  email?: string;
  rating: number;
  title?: string;
  body: string;
  verified?: boolean;
  orderId?: string;
  date: string;
  createdAt?: string;
}

export interface RatingDistribution {
  star1?: number;
  star2?: number;
  star3?: number;
  star4?: number;
  star5?: number;
}

export interface Rating {
  count?: number;
  average?: number;
  distribution?: RatingDistribution;
  reviews?: Review[];
}

export interface FAQItem {
  question: string;
  answer: string;
  createdAt?: string;
}

// Merchant-authored product Q&A. `count` is recomputed server-side on every
// save, so anything sent from here is ignored.
export interface ProductFAQ {
  count?: number;
  items?: FAQItem[];
}

export interface CustomerGroup {
  id: string;
  name: string;
  groupPriceDiscount?: number;
}

export const MAX_CUSTOMER_GROUPS = 5;

export interface BlogPost {
  _id: string;
  sellerID: string;
  title: string;
  slug: string;
  excerpt?: string;
  body: string;
  featuredImage?: string;
  author: string;
  authorBio?: string;
  category: string;
  tags?: string[];
  mentionedProductIDs?: string[];
  metaTitle?: string;
  metaDescription?: string;
  active?: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  _id: string;
  name: string;
  description?: string;
  price: number;
  dealPrice?: number;
  cost?: number;
  dealStartDate?: string;
  dealEndDate?: string;
  discountedPrice?: number;
  sellerID: string;
  partnerId?: string;
  images?: string[];
  category?: string;
  googleProductCategory?: string;
  rating?: Rating;
  faq?: ProductFAQ;
  slug?: string;
  sku?: string;
  barcode?: string;
  stock?: number;
  active?: boolean;
  featured?: boolean;
  priceTiers?: PriceTier[];
  minOrderQty?: number;
  orderIncrement?: number;
  maxOrderQty?: number;
  // Package as shipped. Weight in pounds, dimensions in inches (fixed units).
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  // Shopping-feed campaign segmentation. Feed-only, never shown to shoppers.
  customLabel0?: string;
  customLabel1?: string;
  customLabel2?: string;
  customLabel3?: string;
  customLabel4?: string;
  groupIDs?: string[];
  // Who the product is marketed to on the public D2C storefront, and whether it
  // belongs in the consumer shopping feeds. Absent means 'retail', which is what
  // every product did before the field existed. Mirrors catalog-service
  // storage.Audience*; it does NOT gate B2B portal visibility (that is groupIDs).
  audience?: ProductAudience;
  attributes?: Attribute[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProductAudience = 'retail' | 'wholesale' | 'both';

export interface RefundItemAdjustment {
  productID: string;
  quantity: number;
  lineAmount: number;
}

export interface Refund {
  id: string;
  stripeRefundID: string;
  amount: number;
  reason?: string;
  itemAdjustments?: RefundItemAdjustment[];
  refundedAt: string;
  refundedBy?: string;
}

export interface Order {
  id: string;
  quoteId: string;
  accountId: string;
  sellerId: string;
  items: CartItem[];
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  grandTotal: number;
  promoCode?: string;
  promoDiscount?: number;
  transactionId?: string;
  createdAt: string;
  status: string;
  paymentMethod?: string;
  deliveryMethod?: string;
  pickupLocationId?: string;
  deliveryAddressId?: string;
  deliveryAddress?: {
    recipientName?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    phoneNumber?: string;
  };
  customerEmail?: string;
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  shippedAt?: string;
  deliveredAt?: string;
  reviewRequestedAt?: string;
  updatedAt?: string;
  refunds?: Refund[];
}

export interface NewCartItem {
  productId: string;
  quantity: number;
  sellerId: string;
  partnerId?: string;
  name: string;
  price: number;
  discountedPrice?: number;
  image?: string;
  dealPrice?: number;
}

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  sellerId: string;
  partnerId?: string;
  name: string;
  price: number;
  discountedPrice?: number;
  lineItemTotal: number;
  image?: string;
  proposedPrice?: number;
}

export interface SavedList {
  name: string;
  items: CartItem[];
}

export interface Cart {
  id: string;
  accountId: string;
  sellerId: string;
  items: CartItem[];
  totalPrice: number;
  savedLists?: SavedList[];
}

export interface QuoteHistory {
  status: string;
  changedAt: string;
}

export interface Comment {
  id: string;
  accountId: string;
  text: string;
  createdAt: string;
}

export interface Quote {
  id: string;
  cartId: string;
  accountId: string;
  sellerId: string;
  items: CartItem[];
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  grandTotal: number;
  availablePaymentMethods: string[];
  availableDeliveryMethods: string[];
  availableShippingOutOptions: string[];
  companyLocations?: CompanyLocation[];
  customerAddresses?: CustomerAddress[];
  createdAt: string;
  expiresAt: string;
  quoteType: 'standard' | 'negotiable';
  status: 'draft' | 'open' | 'proposed' | 'pending_approval' | 'approved' | 'rejected' | 'ordered';
  history: QuoteHistory[];
  comments: Comment[];
  discountPercentage?: number;
  discountAmount?: number;
  notes?: string;
  leadTime?: number;
  approvalScope?: ApprovalScope;
  approvalThreshold?: number;
  approvalQuantityThreshold?: number;
  approvalExpiresAt?: string;
  approvalStage?: number;
  approvalChain?: ApprovalStep[];
  approvalDecisions?: ApprovalDecision[];
  // Whether the gate actually fired, as opposed to a policy merely being
  // attached. Chain presence alone is true for ordinary un-gated orders too.
  approvalRequired?: boolean;
}

export type DeliveryMethod = 'pickup' | 'dropoff' | 'shipping_out';
export type ShippingOutOption = 'standard' | 'express';

export interface CompanyData {
  _id?: string;
  name: string;
  logoUrl?: string;
  status: string;
  uniqueIdentifier?: string;
  saleRepresentative?: string;
  creditLimit?: number;
  shippingMethods?: string[] | null;
  paymentMethods?: string[];
  deliveryMethods?: DeliveryMethod[];
  shippingOutOptions?: ShippingOutOption[];
  companyLocations?: CompanyLocation[];
  leadTime?: number;
  maxOrderAmountLimit?: number;
  maxOrderQuantityLimit?: number;
  minOrderAmountLimit?: number;
  minOrderQuantityLimit?: number;
  monthlyOrderLimit?: number;
  yearlyOrderLimit?: number;
  taxableGoods?: boolean;
  taxRate?: number;
  shippingRate?: number;
  quotesAllowed?: boolean;
  couponsEnabled?: boolean;
  companyCodeId?: string;
  companyCode: string;
  partnerCode?: string;
  sellingArea: {
    radius: number;
    center: { lat: number; lng: number };
  };
  address: Address;
  d2c?: D2CConfig;
  customerGroups?: CustomerGroup[];
  feeds?: string[];
}

export interface D2CConfig {
  enabled: boolean;
  primaryColor: string;
  secondaryColor: string;
  contactEmail: string;
  contactPhone?: string;
  previewDomain?: string;
  customDomain?: string;
  heroTitle?: string;
  heroSlogan?: string;
  heroTextColor?: string;
  heroBgColor?: string;
  aboutText?: string;
  privacyText?: string;
  termsText?: string;
  shippingText?: string;
  shippingBadge?: string;
  returnsBadge?: string;
  feedGender?: string;
  feedAgeGroup?: string;
  whatsappNumber?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  tiktokUrl?: string;
}

export interface CustomerCodeEntry {
  codeId: string;
  customerCode: string;
  groupID?: string;
  configuration?: CustomerConfiguration;
}

export interface CompanyLocation {
  id: string;
  companyId: string;
  locationName: string;
  address: Address;
  contactPerson?: string;
  phoneNumber?: string;
  operatingHours?: string;
  capacity?: string;
  locationType: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  customerId: string;
  recipientName: string;
  address: Address;
  phoneNumber?: string;
  addressLabel?: string;
  isDefaultShipping: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'credit_card' | 'purchase_order' | 'on_account' | 'stripe_pay';

export interface CustomerConfiguration {
  company_id: string;
  discountPercentage?: number;
  paymentMethods?: PaymentMethod[];
  deliveryMethods?: DeliveryMethod[];
  shippingOutOptions?: ShippingOutOption[];
  quotesAllowed?: boolean;
  creditLimit?: number;
  minOrderAmountLimit?: number;
  maxOrderAmountLimit?: number;
  minOrderQuantityLimit?: number;
  maxOrderQuantityLimit?: number;
  monthlyOrderLimit?: number;
  yearlyOrderLimit?: number;
  taxableGoods?: boolean;
  taxRate?: number;
  shippingRate?: number;
  leadTime?: number;
  resaleCertificate?: ResaleCertificate;
  groupID?: string;
  groupPriceDiscount?: number;
}

export interface ResaleCertificate {
  state?: string;
  number?: string;
  type?: string;
  issueDate?: string;
  expiryDate?: string;
}

// Buyer-side order approval (Roadmap #21). Scope reuses the quoteType vocabulary
// so it can be compared directly against a quote's type.
export type ApprovalScope = 'none' | 'standard' | 'negotiable' | 'both';

export interface Approver {
  accountId: string;
  email?: string;
  name?: string;
}

// One tier of an approval chain. Several approvers may sit on a step and ANY ONE
// of them clears it, so an order does not stall when someone is on leave.
export interface ApprovalStepConfig {
  name?: string;
  // Optional on READ. The backend redacts the other organisation's levels down to
  // their existence and status (Roadmap #21d), so a step that is not yours comes
  // back with no approvers, no name and no note. Required when CONFIGURING a
  // policy, which the form enforces separately.
  approvers?: Approver[];
}

// One decision, recorded once and never rewritten (Roadmap #21f). The chain is
// live state and gets rebuilt whenever the gate re-fires; this outlives it, so a
// withdraw-and-reinstate can no longer erase who approved what. Each entry
// carries the total at the time, because the money changes between runs.
export interface ApprovalDecision {
  side?: 'seller' | 'buyer';
  level: number;
  stepName?: string;
  decision: 'approved' | 'rejected' | 'released';
  // Absent on the other organisation's entries: who signed off inside a business,
  // and what they wrote, is not the counterparty's to see.
  by?: Approver;
  at: string;
  note?: string;
  grandTotal?: number;
}

export interface ApprovalStep extends ApprovalStepConfig {
  // Which organisation owns this level (Roadmap #21d). The seller's levels run
  // first, before the quote is put to the buyer at all. Absent means buyer: that
  // is what every quote written before #21d carries.
  side?: 'seller' | 'buyer';
  status?: 'pending' | 'approved' | 'rejected' | 'released';
  decidedBy?: Approver;
  decidedAt?: string;
  note?: string;
}



export interface DecodedUser {

  id: string;

  // The organisation this account acts within (Roadmap #21c). Equal to id until
  // the account joins one, so callers may use it unconditionally.
  org_id?: string;

  // Seniority inside that organisation (Roadmap #35g). Absent on platform-admin
  // tokens and on any token minted before it shipped, so ABSENT means
  // unrestricted, never "user". The backend applies the same rule and is the
  // authority; these checks only keep the UI honest.
  org_role?: 'owner' | 'admin' | 'user';

  email: string;

  role: 'admin' | 'company' | 'customer' | 'partner';

  associate_company_ids: string[];

  configurations?: CustomerConfiguration[];

}



export interface CreateQuoteRequest {
  sellerId: string;
  accountId?: string;
  quotesAllowed: boolean;
  paymentMethods: string[];
  deliveryMethods: string[];
  shippingOutOptions: string[];
  companyLocations: CompanyLocation[];
  customerAddresses: CustomerAddress[];
  configurations?: CustomerConfiguration[];
  quoteType?: 'standard' | 'negotiable';
  status?: 'draft' | 'open' | 'proposed' | 'approved' | 'rejected' | 'ordered';
  creditLimit?: number;
  minOrderAmountLimit?: number;
  maxOrderAmountLimit?: number;
  minOrderQuantityLimit?: number;
  maxOrderQuantityLimit?: number;
  monthlyOrderLimit?: number;
  yearlyOrderLimit?: number;
  taxableGoods?: boolean;
  taxRate?: number;
  shippingRate?: number;
  leadTime?: number;
  // Sales-rep path only (Roadmap #21). Honoured by the backend solely when the
  // caller is company/admin drafting for another account; a buyer's own request
  // is resolved from their signed JWT instead.
  // The buyer's address, which the backend cannot infer when the caller is the
  // seller. The approval policy itself is never sent: it belongs to the buyer and
  // reaches checkout through their own signed claim.
  buyerEmail?: string;
}