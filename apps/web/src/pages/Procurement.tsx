import { ShoppingCart } from "lucide-react";

export function ProcurementPage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Procurement</h2>
        <p className="text-sm text-gray-400 mt-0.5">Purchase orders, vendors, and inventory management</p>
      </div>
      <div className="card text-center py-12">
        <ShoppingCart size={40} className="text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500">Procurement features coming soon</p>
        <p className="text-xs text-gray-600 mt-1">Purchase order management, vendor catalog, and receiving workflows</p>
      </div>
    </div>
  );
}
