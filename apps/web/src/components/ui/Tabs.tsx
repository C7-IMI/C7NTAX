/**
 * The segmented control the settings screens use to put long pages behind a tab strip.
 *
 * It is a tab list in the accessibility tree rather than a row of buttons: the tabs are one choice,
 * and a screen reader should say which of them is chosen. The page owns the choice — usually in the
 * URL, so a tab can be linked to and survives a reload — which is why `onChange` hands the id back
 * instead of this component holding the state.
 */
export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  /** Shown beside the label — how many rows are behind the tab, for instance. */
  count?: number;
}

export function Tabs<Id extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: ReadonlyArray<TabItem<Id>>;
  value: Id;
  onChange: (id: Id) => void;
  /** Names the group for assistive technology: "Customer portal sections", for instance. */
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex items-center gap-1 p-0.5 rounded-lg bg-surface-lighter ${className}`}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            value === item.id ? "bg-cyber-600/20 text-cyber-300" : "text-gray-400 hover:text-white"
          }`}
        >
          {item.label}
          {item.count !== undefined && (
            <span className={`ml-1.5 tabular-nums ${value === item.id ? "text-gray-400" : "text-gray-600"}`}>{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
