import { useCopy } from '../lib/i18n';
import { ACCENTS, BACKGROUNDS, BORDERS, CORNERS, DEFAULT_LOOK, TONES } from '../lib/theme';

/**
 * The app's Look settings, on the page: a compact panel pinned to the corner that repaints
 * this page the way the settings screen repaints the app — the same thirteen accents, the same
 * three tones, the same rules underneath (`lib/theme.ts`).
 *
 * It ships `hidden`. Everything it does is JavaScript, and a page with none of it should not
 * carry a button that cannot do anything; `installThemePanel` is what puts it on screen.
 */
export function Look() {
  const c = useCopy();
  const group = (key: string, values: readonly string[], labels: Record<string, string>) => (
    <fieldset className="look__row" key={key}>
      <legend className="look__label">{labels.title}</legend>
      <span className="look__options">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="look__opt"
            data-set={`${key}:${value}`}
            aria-pressed={value === DEFAULT_LOOK[key as keyof typeof DEFAULT_LOOK]}
          >
            {labels[value]}
          </button>
        ))}
      </span>
    </fieldset>
  );

  return (
    <aside className="look" hidden>
      <button type="button" className="look__toggle" aria-expanded="false" aria-label={c.look.title}>
        <span className="look__dot" aria-hidden="true" />
        <span className="look__toggleLabel">{c.look.title}</span>
      </button>
      <div className="look__body" hidden>
        <p className="look__lead">{c.look.lead}</p>
        <fieldset className="look__row">
          <legend className="look__label">{c.look.accent}</legend>
          <span className="look__swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.name}
                type="button"
                className="look__swatch"
                data-set={`accent:${a.name}`}
                data-accent={a.name}
                data-hex={a.hex}
                data-alt={a.alt}
                style={{ '--swatch': a.hex } as React.CSSProperties}
                title={a.name}
                aria-label={a.name}
                aria-pressed={a.name === DEFAULT_LOOK.accent}
              />
            ))}
          </span>
        </fieldset>
        {group('tone', TONES, { title: c.look.tone, ...c.look.tones })}
        {group('background', BACKGROUNDS, { title: c.look.background, ...c.look.backgrounds })}
        {group('borders', BORDERS, { title: c.look.borders, ...c.look.borderNames })}
        {group('corners', CORNERS, { title: c.look.corners, ...c.look.cornerNames })}
        <p className="look__note">{c.look.note}</p>
      </div>
    </aside>
  );
}
