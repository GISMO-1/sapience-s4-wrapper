import { SapAdapter, PurchaseOrderRequest, PurchaseOrderResult } from "./adapter";

export class FakeSapAdapter implements SapAdapter {
  async createPurchaseOrder(request: PurchaseOrderRequest): Promise<PurchaseOrderResult> {
    return {
      id: `PO-${Math.floor(Math.random() * 10000)}`,
      status: "created",
      sku: request.sku,
      quantity: request.quantity
    };
  }
}
