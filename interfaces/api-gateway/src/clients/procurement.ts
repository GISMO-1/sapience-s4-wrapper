export async function requestPurchaseOrder(baseUrl: string, payload: { sku: string; quantity: number }) {
  const response = await fetch(`${baseUrl}/v1/purchase-orders/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}
