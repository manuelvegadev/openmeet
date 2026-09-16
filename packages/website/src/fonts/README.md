# jetbrains-mono-box.woff2

The glyphs the terminal is drawn from: box drawing, block elements, geometric shapes, arrows
and the check mark — U+2190-2199, U+232B, U+2500-257F, U+2580-259F, U+25A0-25FF, U+2713-2714,
U+266A. 215 glyphs, 3.7 KB.

It is here because `@fontsource-variable/jetbrains-mono` ships language subsets and none of
them carries any of this, so `╭ ─ │ █ ●` fell through to whatever monospace the machine has.
That font's advance is not JetBrains Mono's — 0.60205 em against 0.600 — and a terminal is a
grid: a row of frame came out 3.6 px wider than a row of text and no two vertical edges lined
up. The whole point of exporting the room from the application is ruined by drawing it in two
fonts.

Built from the upstream family, which is OFL-1.1 (see OFL.txt — the same licence the
@fontsource package ships, since this is the same font):

    pyftsubset JetBrainsMono-Regular.ttf \
      --unicodes='U+2190-2199,U+232B,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2713-2714,U+266A' \
      --layout-features='' --no-hinting --desubroutinize --name-IDs='' \
      --drop-tables+=DSIG --flavor=woff2 --output-file=jetbrains-mono-box.woff2

Regular only: nothing in the room draws one of these bold. `TestWebsiteTerminal` in
`packages/go/internal/tui` fails the export if the room ever draws a character outside the
ranges above, so a new glyph cannot quietly arrive on the page in the wrong font.
