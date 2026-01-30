export async function fetchPurchaseOrder(baseUrl: string, id: string) {
  const response = await fetch(`${baseUrl}/v1/sap/purchase-orders/${encodeURIComponent(id)}`);
  return response.json();
}
