export async function requestInvoiceReview(baseUrl: string, payload: { invoiceId: string; amount: number }) {
  const response = await fetch(`${baseUrl}/v1/invoices/review-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}
