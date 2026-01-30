export async function fetchInventory(baseUrl: string, sku: string, traceId?: string) {
  const response = await fetch(`${baseUrl}/v1/inventory/${encodeURIComponent(sku)}`, {
    headers: traceId ? { "x-trace-id": traceId } : undefined
  });
  return response.json();
}
