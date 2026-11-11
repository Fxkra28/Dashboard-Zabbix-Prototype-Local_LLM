import { useState } from 'react';

/**
 * The HCML logo.
 *
 * The ink measures #2B5584: 7.68:1 on white but 2.02:1 on the sidebar's chrome, so the file as drawn
 * needs a white plate wherever it sits on the chrome (DESIGN.md section 8). Since 26 October 2026 the
 * expanded sidebar shows `lockup-white` instead: the same artwork in white, made from the file's own
 * transparency, which reads at 15.54:1 on the chrome with no plate (DESIGN.md section 10). The sign-in
 * card keeps the original on its plate.
 *
 * The rail has its own variant, because the supplied artwork is a stacked lockup that does not survive being
 * shrunk: "Husky-CNOOC" and "Madura Limited" are a third and a sixth the height of "HCML", so in a
 * 40px rail they render at 4px and turn to grey texture. The rail gets the square H icon, the
 * favicon's crop of the same file (DESIGN.md section 9).
 *
 * Falls back to the monogram when the image will not load, as on any deploy that drops the asset: a
 * broken-image glyph in the chrome of a wall display is worse than a monogram nobody looks at
 * twice.
 */
export default function BrandMark({
  variant = 'lockup',
  alt = '',
}: {
  /** `lockup` is the full three-line logo on its plate, `lockup-white` the same in white for the chrome, `icon` the square H alone. */
  variant?: 'lockup' | 'lockup-white' | 'icon';
  /**
   * Empty wherever the name is already written beside the logo, so a screen
   * reader does not say "HCML" twice. The rail hides that text, so it passes a
   * real name instead.
   */
  alt?: string;
}) {
  const src = variant === 'icon' ? '/logo-icon.png' : variant === 'lockup-white' ? '/logo-white.png' : '/logo.png';
  // Per file: the rail toggles the variant in place, and the other file may
  // load; one that failed is not asked for again, which flashed an empty plate.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const missing = failed.has(src);

  return (
    <div
      className={`brand-mark brand-mark-${variant}`}
      // The monogram is two letters of the name; the name itself goes to the screen reader.
      {...(missing && alt ? { role: 'img', 'aria-label': alt } : {})}
    >
      {missing ? (
        <span className="brand-mark-fallback" aria-hidden="true">
          HC
        </span>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed((f) => new Set(f).add(src))} />
      )}
    </div>
  );
}
