import type { MerchantMpesaConfig, MpesaTransaction } from "@/lib/types";

/** Daraja sandbox paybill used in platform dev mode. */
export const DEV_MPESA_SHORTCODE = "174379";

export const DEV_MERCHANT_MPESA_CONFIG: MerchantMpesaConfig = {
  id: "dev-sandbox",
  account_id: "dev",
  shortcode: "5575731",
  shortcode_type: "till",
  account_number: "DEVSHOP",
  is_configured: true,
};

export const DEV_MPESA_TRANSACTIONS: MpesaTransaction[] = [
  {
    id: "dev-txn-001",
    phone_number: "254708374149",
    amount: 2500,
    account_reference: "DEVSHOP",
    transaction_desc: "Order pay",
    status: "success",
    result_code: 0,
    result_desc: "The service request is processed successfully.",
    mpesa_receipt_number: "QJK7ABC123",
    merchant_request_id: "dev-mr-001",
    checkout_request_id: "dev-co-001",
    completed_at: new Date(Date.now() - 2.25 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 2.26 * 60 * 60 * 1000).toISOString(),
    transaction_account: "DEVSHOP",
    payout_destination_shortcode: "5575731",
    payout_destination_type: "till",
    payout_status: "success",
    payout_shortcode: "5575731",
    payout_shortcode_type: "till",
    payout_amount: 2500,
    payout_receipt_number: "B2B9XYZ456",
    payout_result_desc: "The service request is processed successfully.",
    payout_completed_at: new Date(Date.now() - 2.2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "dev-txn-002",
    phone_number: "254712345678",
    amount: 850,
    account_reference: "INV-0048",
    transaction_desc: "Balance",
    status: "pending",
    result_code: null,
    result_desc: "STK push sent. Awaiting customer PIN.",
    mpesa_receipt_number: null,
    merchant_request_id: "dev-mr-002",
    checkout_request_id: "dev-co-002",
    completed_at: null,
    created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: "dev-txn-003",
    phone_number: "254722334455",
    amount: 1200,
    account_reference: "ORD-000139",
    transaction_desc: "Order pay",
    status: "failed",
    result_code: 1,
    result_desc: "Insufficient balance for the transaction.",
    mpesa_receipt_number: null,
    merchant_request_id: "dev-mr-003",
    checkout_request_id: "dev-co-003",
    completed_at: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 27.03 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "dev-txn-004",
    phone_number: "254733445566",
    amount: 499,
    account_reference: "WALK-IN",
    transaction_desc: "POS sale",
    status: "cancelled",
    result_code: 1032,
    result_desc: "Request cancelled by user.",
    mpesa_receipt_number: null,
    merchant_request_id: "dev-mr-004",
    checkout_request_id: "dev-co-004",
    completed_at: new Date(Date.now() - 53 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 53.02 * 60 * 60 * 1000).toISOString(),
  },
];

export function isDevSampleTransaction(id: string): boolean {
  return id.startsWith("dev-txn-");
}
