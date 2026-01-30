export async function fetchInventory(baseUrl: string, sku: string) {
  const response = await fetch(`${baseUrl}/v1/inventory/${encodeURIComponent(sku)}`);
  return response.json();
}
