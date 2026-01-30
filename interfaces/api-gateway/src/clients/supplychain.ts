export async function fetchInventory(baseUrl: string, sku: string, traceId?: string) {
  const response = await fetch(`${baseUrl}/v1/inventory/${encodeURIComponent(sku)}`, {
    headers: { "x-trace-id": traceId ?? "" }
  });
  return response.json();
}
