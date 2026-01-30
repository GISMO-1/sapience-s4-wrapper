export async function requestPurchaseOrder(
  baseUrl: string,
  payload: { sku: string; quantity: number },
  traceId?: string
) {
  const response = await fetch(`${baseUrl}/v1/purchase-orders/request`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-id": traceId ?? "" },
    body: JSON.stringify(payload)
  });
  return response.json();
}
