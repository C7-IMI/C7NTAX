import { useEffect, useRef, useState } from "react";
import api from "../api";
import { Search, X, Package } from "lucide-react";

/** The catalog fields a caller can price or describe a line from. */
export interface PickedProduct {
  id: string;
  sku: string;
  name: string;
  productType: string;
  unit: string;
  billingPeriod: string;
  sellPrice: number;
  costPrice?: number;
  taxable?: boolean;
}

interface Props {
  /** The text in the box — a product name, or anything typed for an ad-hoc line. */
  value: string;
  onValueChange: (text: string) => void;
  onPick: (product: PickedProduct) => void;
  /** The price a row shows and the caller prefills: what the client pays, or what we pay. */
  priceBasis?: "sell" | "cost";
  placeholder?: string;
  /** Set once a row has been picked, so the box can show which catalog entry it came from. */
  pickedSku?: string | null;
  autoFocus?: boolean;
  required?: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * A search-as-you-type box over the product catalog. Typing anything is allowed — the catalog
 * is a convenience, not a gate — so picking a row is optional and only fills in the extra
 * fields (SKU, price) a free-text description cannot carry.
 */
export function ProductPicker({ value, onValueChange, onPick, priceBasis = "sell", placeholder = "Search the catalog or type a description", pickedSku, autoFocus, required }: Props) {
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const term = value.trim();
    if (term === searched) return;
    const handle = setTimeout(() => {
      setBusy(true);
      api.get(`/products?active=true&limit=20&search=${encodeURIComponent(term)}`)
        .then(r => { setResults(r.data?.data || []); setSearched(term); setActive(0); })
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [value, open, searched]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const priceOf = (p: PickedProduct) => (priceBasis === "cost" ? p.costPrice ?? p.sellPrice : p.sellPrice);
  const choose = (p: PickedProduct) => { onPick(p); setOpen(false); };

  return (
    <div className="relative" ref={box}>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input-field pl-8 pr-8"
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          required={required}
          onChange={e => { onValueChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active]!); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {value && (
          <button type="button" onClick={() => { onValueChange(""); setOpen(true); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      {pickedSku && (
        <p className="mt-1 text-[11px] text-cyber-400 flex items-center gap-1"><Package size={10} /> Catalog item {pickedSku}</p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-surface-border bg-navy-800 shadow-xl">
          {busy && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No catalog match — what you type is kept as a one-off description.</p>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === active ? "bg-cyber-600/15" : ""}`}
              >
                <span className="font-mono text-[10px] text-gray-500 w-28 truncate shrink-0">{p.sku}</span>
                <span className="flex-1 text-xs text-white truncate">{p.name}</span>
                {p.billingPeriod !== "none" && <span className="text-[10px] text-cyber-400 shrink-0">/{p.billingPeriod === "monthly" ? "mo" : p.billingPeriod === "annual" ? "yr" : "qtr"}</span>}
                <span className="text-xs text-gray-300 shrink-0">
                  {money(priceOf(p))}
                  {priceBasis === "cost" && p.costPrice === undefined && <span className="text-[10px] text-gray-500"> list</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default ProductPicker;
