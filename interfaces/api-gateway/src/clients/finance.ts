export async function requestInvoiceReview(
  baseUrl: string,
  payload: { invoiceId: string; amount: number },
  traceId?: string
) {
  const response = await fetch(`${baseUrl}/v1/invoices/review-request`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(traceId ? { "x-trace-id": traceId } : {}) },
    body: JSON.stringify(payload)
  });
  return response.json();
}
