export type PurchaseOrderRequest = {
  sku: string;
  quantity: number;
};

export type PurchaseOrderResult = {
  id: string;
  status: string;
  sku: string;
  quantity: number;
};

export interface SapAdapter {
  createPurchaseOrder(request: PurchaseOrderRequest): Promise<PurchaseOrderResult>;
}
