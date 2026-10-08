/**
 * The product's copyright notice, in the small type a footer uses.
 *
 * One component rather than a line per surface: a notice that differs between the staff app, the
 * sign-in screen and the customer portal invites the question of which one is correct. The year is
 * the current one rather than a constant — C7NTAX is released continuously, so a notice frozen at
 * the first release would be wrong within a month.
 */
export function AppFooter({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-gray-600 ${className}`}>
      © {new Date().getFullYear()} Cyber 7 Group, LLC
    </p>
  );
}
