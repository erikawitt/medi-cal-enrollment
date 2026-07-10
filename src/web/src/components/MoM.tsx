/**
 * Renders the MoM abbreviation so parent `text-transform: uppercase`
 * (micro-labels, segmented controls, tooltip rows) cannot turn it into "MOM".
 */
export function MoM() {
  return (
    <>
      M<span className="mom-o">o</span>M
    </>
  );
}
