import { useRef, type KeyboardEvent } from "react";

/**
 * The segmented control the settings screens use to put long pages behind a tab strip.
 *
 * It is a tab list in the accessibility tree rather than a row of buttons: the tabs are one choice,
 * and a screen reader should say which of them is chosen. The page owns the choice — usually in the
 * URL, so a tab can be linked to and survives a reload — which is why `onChange` hands the id back
 * instead of this component holding the state.
 *
 * The strip is drawn to look like something you press: a bordered group, the chosen tab on the
 * primary-button fill, and counts as pills rather than loose numbers.
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
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  /*
   * Arrow keys move the choice, which is what a tab list is expected to do: the mouse is not the
   * only way in. Only the chosen tab carries a tab stop, so Tab leaves the group rather than
   * walking through every tab in it.
   */
  const move = (index: number) => {
    const wrapped = (index + items.length) % items.length;
    const next = items[wrapped];
    if (!next) return;
    onChange(next.id);
    refs.current[wrapped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex(item => item.id === value);
    if (index < 0) return;
    if (event.key === "ArrowRight") move(index + 1);
    else if (event.key === "ArrowLeft") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex items-stretch gap-1 p-1 rounded-xl bg-surface-lighter border border-surface-border ${className}`}
    >
      {items.map((item, index) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            ref={element => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
              selected ? "tab-active font-semibold" : "font-medium text-gray-300 hover:bg-surface-border/70 hover:text-white"
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={`min-w-[1.35rem] px-1.5 py-px rounded-full text-center text-[11px] font-semibold tabular-nums ${
                  selected ? "bg-black/30" : "bg-surface-border text-gray-300"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
